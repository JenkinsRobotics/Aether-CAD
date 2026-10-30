// Design inputs only. Every feature uses CAD's validated program adapter.
const ref = (id) => ({ $ref: id + ".feature_id" });
const path = (points) => ({
  type: "path",
  start: points[0],
  segments: [...points.slice(1), points[0]].map((end) => ({
    type: "line",
    end,
  })),
});
const circle = (radius, center = [0, 0]) => ({
  type: "circle",
  center,
  radius,
});
function drawing(contours) {
  return {
    type: "drawing",
    contours,
    constraints: contours.flatMap((c, i) =>
      c.type === "circle"
        ? [
            {
              id: "center-" + i,
              kind: "fix",
              a: { contour: i, kind: "point", index: 0 },
              point: c.center,
            },
            {
              id: "diameter-" + i,
              kind: "diameter",
              a: { contour: i, kind: "circle" },
              value: c.radius * 2,
            },
          ]
        : [
            {
              id: "datum-" + i,
              kind: "fix",
              a: { contour: i, kind: "contour" },
              fixedGeometry: structuredClone(c),
            },
          ],
    ),
  };
}
class Part {
  constructor(key, name, color, description) {
    Object.assign(this, {
      key,
      name,
      color,
      description,
      steps: [],
      body: key + "-solid",
    });
  }
  add(name, feature) {
    const id = "f" + this.steps.length;
    this.steps.push({
      id,
      tool: "aether_cad_feature_add",
      arguments: { feature_json: { ...feature, name, suppressed: false } },
    });
    return id;
  }
  profile(name, contours, z = 0, plane = "XY") {
    return this.add(name, {
      type: "profile",
      plane,
      offsetMillimeters: z,
      profile: drawing(contours),
    });
  }
  revolve(name, contour) {
    const p = this.profile(
      name + " — constrained meridian",
      [contour],
      0,
      "XZ",
    );
    this.solid = this.add(name, {
      type: "revolve",
      profileFeatureId: ref(p),
      axis: "Z",
      angleDegrees: 360,
      operation: "new",
      bodyId: this.body,
    });
    return this;
  }
  ring(name, outer, inner, z, depth, operation = "new") {
    return this.pad(
      name,
      [circle(outer), ...(inner ? [circle(inner)] : [])],
      z,
      depth,
      operation,
      "XY",
      false,
      inner ? [(outer + inner) / 2, 0] : undefined,
    );
  }
  pad(
    name,
    contours,
    z,
    depth,
    operation = "new",
    plane = "XY",
    reversed = false,
    point,
  ) {
    const p = this.profile(name + " — sketch", contours, z, plane);
    const id = "f" + this.steps.length;
    const args = {
      name,
      profile_id: ref(p),
      depth_mm: depth,
      operation,
      ...(operation === "new"
        ? {}
        : { target_body_id: { $ref: this.solid + ".body_id" } }),
      ...(reversed ? { reversed: true } : {}),
      ...(point
        ? { profile_point_mm: point }
        : contours.length > 1
          ? { all_regions: true }
          : {}),
    };
    this.steps.push({ id, tool: "aether_cad_extrude", arguments: args });
    if (operation === "new") this.solid = id;
    return this;
  }
  holes(name, count, pitch, r, z, depth, phase = 0) {
    return this.pad(
      name,
      Array.from({ length: count }, (_, i) =>
        circle(r, [
          pitch * Math.cos(phase + (i * 2 * Math.PI) / count),
          pitch * Math.sin(phase + (i * 2 * Math.PI) / count),
        ]),
      ),
      z,
      depth,
      "cut",
    );
  }
  finish(name, r, z, type = "chamfer") {
    this.add(name, {
      type,
      radiusMillimeters: r,
      targetBodyId: { $ref: this.solid + ".body_id" },
      edgePlane: { plane: "XY", offsetMillimeters: z },
    });
    return this;
  }
}
const parts = [];
const make = (...a) => {
  const p = new Part(...a);
  parts.push(p);
  return p;
};
const alloy = "#adb8be",
  dark = "#27343b",
  rubber = "#172026",
  glass = "#365e74",
  steel = "#89969e";
// All dimensions are mm. Pads and cuts create real mating geometry; placements
// below use these same datums, with each child mated to its physical parent.
const Q = Math.SQRT1_2;
const back = [0, 1, 0, 0];
const polar = (r, t) => [r * Math.sin(t), r * Math.cos(t)];
function rotate(q, [a, b, c]) {
  const [x, y, z, w] = q;
  const tx = 2 * (y * c - z * b),
    ty = 2 * (z * a - x * c),
    tz = 2 * (x * b - y * a);
  return [
    a + w * tx + y * tz - z * ty,
    b + w * ty + z * tx - x * tz,
    c + w * tz + x * ty - y * tx,
  ];
}
function product([x, y, z, w], [u, v, s, t]) {
  return [
    w * u + x * t + y * s - z * v,
    w * v - x * s + y * t + z * u,
    w * s + x * v - y * u + z * t,
    w * t - x * u - y * v - z * s,
  ];
}
const inverse = ([x, y, z, w]) => [-x, -y, -z, w];
function radial(v) {
  const n = v.map((x) => x / Math.hypot(...v));
  const q = [-n[1], n[0], 0, 1 + n[2]],
    l = Math.hypot(...q);
  return { n, q: q.map((x) => x / l) };
}
const sensors = [-63, 63].flatMap((x) =>
  [-96, 96].map((y) => ({
    name: `Sensor ${x} ${y}`,
    ...radial([x, y, 77]),
  })),
);
const ducts = [-1, 1].flatMap((s) =>
  [-34, 0, 34].map((y, i) => ({
    name: `${s < 0 ? "Left" : "Right"} cooling duct ${i + 1}`,
    ...radial([s * 110, y, 88]),
  })),
);
const vent = radial([0, 136, -40]),
  antenna = radial([-78, 116, -25]);
// A port is a fused flat boss and a genuine through bore, normal to the shell.
function mountedPad(
  p,
  name,
  outer,
  inner,
  start,
  end,
  port,
  operation = "add",
) {
  const index = p.steps.length;
  p.ring(name, outer, inner, start, Math.abs(end - start), operation);
  p.steps[index].arguments.feature_json.frame = {
    originMillimeters: port.n.map((x) => x * start),
    xDirection: rotate(port.q, [1, 0, 0]),
    normal: port.n,
  };
  return p;
}
function port(p, name, spec, outer, bore, base = 136, face = 143) {
  mountedPad(p, name + " — mounting boss", outer, bore, base, face, spec);
  // Start beyond the spherical envelope, including when a hub seat is recessed.
  mountedPad(
    p,
    name + " — passage",
    bore,
    0,
    Math.max(face + 1, 145),
    base - 2,
    spec,
    "cut",
  );
}
function hemisphere(positive) {
  const begin = positive ? Math.acos(100 / 142) : Math.PI / 2;
  const end = positive ? Math.PI / 2 : Math.PI;
  const innerBegin = positive ? Math.acos(100 / 139) : Math.PI / 2;
  return {
    type: "path",
    start: polar(142, begin),
    segments: [
      {
        type: "arc",
        middle: polar(142, (begin + end) / 2),
        end: polar(142, end),
      },
      { type: "line", end: polar(139, end) },
      {
        type: "arc",
        middle: polar(139, (innerBegin + end) / 2),
        end: polar(139, innerBegin),
      },
      { type: "line", end: polar(142, begin) },
    ],
  };
}
const front = make(
  "01-front-shell",
  "Front shell",
  alloy,
  "3 mm spherical wall with machined optical collar, split hub seats and radial sensor/duct mounting bosses.",
);
front
  .revolve("Front spherical wall", hemisphere(true))
  .ring("Optical collar — flat seating face at 110", 102, 94, 99, 11, "add");
const rear = make(
  "02-rear-shell",
  "Rear shell",
  alloy,
  "Rear spherical wall with service, grille and antenna mounting seats; 1.2 mm equatorial seal gap.",
);
rear.revolve("Rear spherical wall", hemisphere(false));
for (const shell of [front, rear]) {
  for (const s of [-1, 1]) {
    const spec = { n: [s, 0, 0], q: [0, s * Q, 0, Q] };
    // The hub axes are through the equator, so the two shell bosses are split
    // along the same gasket faces as the hemispheres.
    port(shell, `${s < 0 ? "Left" : "Right"} hub`, spec, 74, 69, 115, 128);
  }
}
for (const s of sensors) port(front, s.name, s, 16.5, 8);
for (const d of ducts) port(front, d.name, d, 13.5, 9.3);
port(rear, "Top grille", vent, 32.5, 26.5, 134, 143);
port(rear, "Antenna", antenna, 9.5, 3, 136, 143);
port(rear, "Rear service", { n: [0, 0, -1], q: back }, 42, 30, 133, 145);
// Service fastener sockets lie behind the cover, on its actual bolt circle.
rear.pad(
  "Rear cover screw sockets",
  Array.from({ length: 4 }, (_, i) =>
    circle(2.4, [
      35 * Math.cos((i * Math.PI) / 2),
      35 * Math.sin((i * Math.PI) / 2),
    ]),
  ),
  -145,
  8,
  "cut",
  "XY",
  true,
);
const large = path([
  [-200, -200],
  [200, -200],
  [200, 200],
  [-200, 200],
]);
front.pad("Front gasket seating plane", [large], 0.6, 200, "cut");
rear.pad("Rear gasket seating plane", [large], -0.6, 200, "cut", "XY", true);
const seal = make(
  "03-shell-seal",
  "Equatorial shell seal",
  rubber,
  "One connected 1.2 mm gasket arc; two occurrences seal the equator between the hub openings.",
);
const outerEnd = Math.sqrt(142.3 ** 2 - 70 ** 2),
  innerEnd = Math.sqrt(138.5 ** 2 - 70 ** 2);
seal.pad(
  "Continuous gasket arc",
  [
    {
      type: "path",
      start: [outerEnd, 70],
      segments: [
        { type: "arc", middle: [0, 142.3], end: [-outerEnd, 70] },
        { type: "line", end: [-innerEnd, 70] },
        { type: "arc", middle: [0, 138.5], end: [innerEnd, 70] },
        { type: "line", end: [outerEnd, 70] },
      ],
    },
  ],
  -0.6,
  1.2,
);

make(
  "04-optical-carrier",
  "Optical carrier",
  dark,
  "0.4 mm radial locating clearance, annular shoulder on the shell collar and a recessed optic seat.",
)
  .revolve(
    "Carrier turned section",
    path([
      [72, 0],
      [93.6, 0],
      [93.6, 10],
      [102, 10],
      [102, 15],
      [69, 15],
      [69, 25.2],
      [44.5, 25.2],
      [44.5, 23],
      [42, 23],
      [42, 11],
      [72, 11],
    ]),
  )
  .holes("Bezel mounting sockets", 8, 81, 2.4, 15, 10)
  .finish("Carrier front chamfer", 0.3, 25.2);
make(
  "05-lens-bezel",
  "Lens bezel",
  alloy,
  "Front trim with counterbores deep enough for the seated screw heads.",
)
  .ring("Bezel annulus", 102, 96.5, 0, 7.5)
  .ring("Inner mounting web", 98, 72, 0, 3.5, "add")
  .holes("Eight fixing holes", 8, 81, 2.4, 3.5, 3.5)
  .holes("Screw head recesses", 8, 81, 3.7, 3.5, 2.5)
  .finish("Bezel face chamfer", 0.4, 7.5);
make(
  "06-optical-window",
  "Optical window",
  glass,
  "Domed optic with a flat flange captured between gasket and retaining ring.",
).revolve("Optical crown", {
  type: "path",
  start: [0, 15],
  segments: [
    { type: "arc", middle: [30, 10.8], end: [42, 0] },
    { type: "line", end: [44, 0] },
    { type: "line", end: [44, -2] },
    { type: "line", end: [0, -2] },
    { type: "line", end: [0, 15] },
  ],
});
make(
  "07-lens-gasket",
  "Lens gasket",
  rubber,
  "1.2 mm optic gasket on a real annular shoulder.",
).ring("Optic seal", 44, 42, 0, 1.2);
make(
  "08-lens-retainer",
  "Lens retaining ring",
  alloy,
  "Spigoted retaining ring captures the optic flange without intersecting the dome.",
)
  .revolve(
    "Retainer section",
    path([
      [44.1, -3],
      [44.4, -3],
      [44.4, 1],
      [49, 1],
      [49, 4.5],
      [42.2, 4.5],
      [42.2, 0],
      [44.1, 0],
    ]),
  )
  .holes("Spanner recesses", 8, 46.5, 0.8, 4.5, 1.3)
  .finish("Retainer front bevel", 0.35, 4.5);
make(
  "09-socket-screw",
  "Socket screw",
  steel,
  "Plain 4.4 mm shank and 7 mm head; simplified fastener without modeled threads.",
)
  .ring("Shank", 2.2, 0, 0, 7)
  .ring("Head", 3.5, 0, 7, 2.5, "add")
  .pad(
    "Hex socket",
    [
      path(
        Array.from({ length: 6 }, (_, i) => [
          1.7 * Math.cos((i * Math.PI) / 3),
          1.7 * Math.sin((i * Math.PI) / 3),
        ]),
      ),
    ],
    9.5,
    1.6,
    "cut",
  )
  .finish("Head edge break", 0.25, 9.5);
make(
  "10-side-hub",
  "Side hub housing",
  alloy,
  "Locating spigot and broad mounting shoulder, with a flat cover gasket seat.",
)
  .revolve(
    "Hub turned section",
    path([
      [42, 0],
      [68.5, 0],
      [68.5, 17],
      [74, 17],
      [74, 24],
      [59, 24],
      [59, 40],
      [45, 40],
      [45, 26],
      [35, 26],
      [35, 20],
      [42, 20],
    ]),
  )
  .holes("Cover screw sockets", 6, 53, 2.4, 40, 12)
  .finish("Hub rim chamfer", 0.3, 40);
make(
  "11-hub-cover",
  "Side hub cover",
  alloy,
  "Flanged cover with a locating spigot, six through holes and recessed cooling details.",
)
  .ring("Cover flange", 59, 0, 0, 4)
  .ring("Locating spigot — 0.4 mm radial clearance", 44.6, 0, -4, 4, "add")
  .ring("Front recess", 32, 0, 4, 1.5, "cut")
  .holes("Cover fixing holes", 6, 53, 2.4, 4, 4)
  .pad(
    "Radial cooling pockets",
    Array.from({ length: 6 }, (_, i) => {
      const t = (i * Math.PI) / 3;
      return path(
        [
          [34, -2],
          [40, -2],
          [40, 2],
          [34, 2],
        ].map(([x, y]) => [
          x * Math.cos(t) - y * Math.sin(t),
          x * Math.sin(t) + y * Math.cos(t),
        ]),
      );
    }),
    4,
    1.5,
    "cut",
  )
  .finish("Cover chamfer", 0.4, 4);
make(
  "12-hub-seal",
  "Side hub seal",
  rubber,
  "Cover gasket with matching bolt clearances.",
)
  .ring("Hub seal", 58, 45.2, 0, 1.2)
  .holes("Seal bolt clearances", 6, 53, 2.6, 1.2, 1.2);
make(
  "13-cooling-duct",
  "Cooling duct",
  steel,
  "Short radial vent with a locating tube, mounting flange and a shouldered screen seat.",
)
  .ring("Locating tube and barrel", 9, 6.2, -4, 33)
  .ring("Mounting flange", 13, 6.2, 0, 3, "add")
  .ring("Outlet lip", 10.5, 6.2, 25, 4, "add")
  .ring("Screen seat", 6.3, 5.8, 25, 1, "add")
  .ring("Barrel relief groove", 9.2, 8.3, 18, 2, "cut")
  .holes("Flange mounting holes", 3, 10.5, 0.9, 3, 3)
  .finish("Outlet edge break", 0.4, 29);
make(
  "14-duct-screen",
  "Cooling duct screen",
  dark,
  "Perforated insert rests on the duct outlet shoulder.",
)
  .ring("Screen disk", 6.1, 0, 0, 1.2)
  .holes("Six airflow holes", 6, 3.5, 1.1, 1.2, 1.2)
  .ring("Center airflow hole", 1.1, 0, 1.2, 1.2, "cut");
make(
  "15-sensor-housing",
  "Auxiliary sensor housing",
  dark,
  "Radially mounted sensor on a flat shell boss; blind window seat and cable recess.",
)
  .ring("Housing base", 15, 0, 0, 7)
  .ring("Sensor face", 12, 0, 7, 3, "add")
  .ring("Window pocket", 10.2, 0, 10, 4, "cut")
  .pad("Cable recess", [circle(5)], 0, 3, "cut", "XY", true)
  .holes("Sensor fastener recesses", 2, 13, 1, 7, 2)
  .finish("Sensor bezel chamfer", 0.4, 10);
make(
  "16-sensor-window",
  "Auxiliary sensor window",
  glass,
  "Domed insert with its rear face seated at the bottom of the sensor pocket.",
).revolve("Small optical crown", {
  type: "path",
  start: [0, 3],
  segments: [
    { type: "arc", middle: [7.5, 2], end: [10, 0] },
    { type: "line", end: [10, -1] },
    { type: "line", end: [0, -1] },
    { type: "line", end: [0, 3] },
  ],
});
make(
  "17-top-vent-frame",
  "Top vent frame",
  alloy,
  "Flat flange with a recessed 0.3 mm radial-clearance grille pocket.",
)
  .revolve(
    "Vent frame section",
    path([
      [26.8, 0],
      [32, 0],
      [32, 3],
      [29, 3],
      [29, 5],
      [28.3, 5],
      [28.3, 3],
      [26.8, 3],
    ]),
  )
  .holes("Grille screw holes", 4, 30, 0.9, 3, 3)
  .finish("Vent rim break", 0.2, 5);
make(
  "18-top-grille",
  "Top vent grille",
  dark,
  "Slotted disk rests on the vent frame ledge; perimeter stays connected.",
)
  .ring("Grille disk", 28, 0, 0, 2)
  .pad(
    "Nine airflow slots",
    Array.from({ length: 9 }, (_, i) => {
      const x = (i - 4) * 5.3,
        h = Math.sqrt(25 ** 2 - x * x);
      return path([
        [x - 1.5, -h],
        [x + 1.5, -h],
        [x + 1.5, h],
        [x - 1.5, h],
      ]);
    }),
    2,
    2,
    "cut",
  );
make(
  "19-antenna-base",
  "Antenna pedestal",
  dark,
  "Radial pedestal on a shell boss; mast seats at the bottom of the socket.",
)
  .ring("Base flange", 9, 0, 0, 3)
  .ring("Pedestal", 6, 0, 3, 8, "add")
  .ring("Mast socket", 3.6, 0, 11, 7, "cut")
  .holes("Base screw pockets", 2, 7.4, 0.8, 3, 1.5);
make(
  "20-antenna-mast",
  "Antenna mast",
  steel,
  "Turned mast with retaining shoulder and socket engagement at each end.",
).revolve(
  "Mast axial section",
  path([
    [0, 0],
    [3.5, 0],
    [3.5, 47],
    [4, 47],
    [4, 49],
    [3.5, 49],
    [3.5, 55],
    [0, 55],
  ]),
);
make(
  "21-antenna-tip",
  "Antenna tip",
  dark,
  "Rounded cap seats on the mast end, with 0.1 mm socket clearance.",
)
  .revolve("Rounded cap section", {
    type: "path",
    start: [0, 11],
    segments: [
      { type: "arc", middle: [5.3, 8.8], end: [7.5, 3.5] },
      { type: "line", end: [7.5, 0] },
      { type: "line", end: [0, 0] },
      { type: "line", end: [0, 11] },
    ],
  })
  .pad("Blind mast socket", [circle(3.6)], 0, 5, "cut", "XY", true);
make(
  "22-service-cover",
  "Rear service cover",
  alloy,
  "Rear flange rests on the shell service boss; spigot locates in its bore.",
)
  .ring("Cover flange", 40, 0, 0, 4)
  .ring("Location spigot", 29.6, 0, -3, 3, "add")
  .ring("Recessed center", 28, 0, 4, 1.2, "cut")
  .holes("Service cover bolts", 4, 35, 2.4, 4, 4)
  .finish("Service cover edge break", 0.4, 4);

const instances = [],
  parents = new Map();
function add(
  key,
  part,
  position = [0, 0, 0],
  rotation = [0, 0, 0, 1],
  parent = "Front shell",
) {
  instances.push({
    key,
    part,
    position_mm: position,
    rotation_xyzw: rotation,
    grounded: key === "Front shell",
  });
  parents.set(key, parent);
}
function child(key, part, parent, offset = [0, 0, 0]) {
  const p = instances.find((x) => x.key === parent),
    v = rotate(p.rotation_xyzw, offset);
  add(
    key,
    part,
    p.position_mm.map((x, i) => x + v[i]),
    p.rotation_xyzw,
    parent,
  );
}
add("Front shell", "01-front-shell");
add("Rear shell", "02-rear-shell");
add("Shell seal", "03-shell-seal");
add("Lower shell seal", "03-shell-seal", [0, 0, 0], [0, 0, 1, 0]);
add("Optical carrier", "04-optical-carrier", [0, 0, 100]);
child("Lens bezel", "05-lens-bezel", "Optical carrier", [0, 0, 15]);
child("Lens gasket", "07-lens-gasket", "Optical carrier", [0, 0, 23]);
child("Optical window", "06-optical-window", "Optical carrier", [0, 0, 26.2]);
child("Lens retainer", "08-lens-retainer", "Optical carrier", [0, 0, 26.2]);
for (let i = 0; i < 8; i++)
  child(`Optical screw ${i + 1}`, "09-socket-screw", "Lens bezel", [
    81 * Math.cos((i * Math.PI) / 4),
    81 * Math.sin((i * Math.PI) / 4),
    -6,
  ]);
for (const s of [-1, 1]) {
  const side = s < 0 ? "Left" : "Right",
    hub = side + " hub";
  add(hub, "10-side-hub", [s * 111, 0, 0], [0, s * Q, 0, Q]);
  child(side + " hub seal", "12-hub-seal", hub, [0, 0, 40]);
  child(side + " cover", "11-hub-cover", hub, [0, 0, 41.2]);
  for (let i = 0; i < 6; i++)
    child(`${side} hub screw ${i + 1}`, "09-socket-screw", side + " cover", [
      53 * Math.cos((i * Math.PI) / 3),
      53 * Math.sin((i * Math.PI) / 3),
      -3,
    ]);
}
for (const d of ducts) {
  add(
    d.name,
    "13-cooling-duct",
    d.n.map((x) => x * 143),
    d.q,
  );
  child(
    d.name.replace("cooling duct", "duct screen"),
    "14-duct-screen",
    d.name,
    [0, 0, 26],
  );
}
for (const s of sensors) {
  add(
    s.name,
    "15-sensor-housing",
    s.n.map((x) => x * 143),
    s.q,
  );
  child(
    s.name.replace("Sensor ", "Sensor window "),
    "16-sensor-window",
    s.name,
    [0, 0, 7],
  );
}
add(
  "Top vent frame",
  "17-top-vent-frame",
  vent.n.map((x) => x * 143),
  vent.q,
  "Rear shell",
);
child("Top vent grille", "18-top-grille", "Top vent frame", [0, 0, 3]);
add(
  "Antenna pedestal",
  "19-antenna-base",
  antenna.n.map((x) => x * 143),
  antenna.q,
  "Rear shell",
);
child("Antenna mast", "20-antenna-mast", "Antenna pedestal", [0, 0, 4]);
child("Antenna tip", "21-antenna-tip", "Antenna mast", [0, 0, 50]);
add("Rear service cover", "22-service-cover", [0, 0, -145], back, "Rear shell");
for (let i = 0; i < 4; i++)
  child(`Service screw ${i + 1}`, "09-socket-screw", "Rear service cover", [
    35 * Math.cos((i * Math.PI) / 2),
    35 * Math.sin((i * Math.PI) / 2),
    -3,
  ]);

export function assemblyRecipe(documents) {
  const world = [Q, 0, 0, Q];
  return {
    version: 1,
    parts: parts.map((p) => ({
      key: p.key,
      name: p.name,
      document: documents[p.key],
    })),
    instances: instances.map((i) => ({
      ...i,
      position_mm: rotate(world, i.position_mm).map(
        (x, k) => x + (k === 2 ? 142 : 0),
      ),
      rotation_xyzw: product(world, i.rotation_xyzw),
    })),
    mates: instances.slice(1).map((i) => {
      const p = instances.find((x) => x.key === parents.get(i.key)),
        inv = inverse(p.rotation_xyzw);
      const q = product(inv, i.rotation_xyzw);
      return {
        key: "Seat " + i.key,
        kind: "fastened",
        a: {
          instance: p.key,
          origin_mm: rotate(
            inv,
            i.position_mm.map((x, k) => x - p.position_mm[k]),
          ),
          z_axis: rotate(q, [0, 0, 1]),
          x_axis: rotate(q, [1, 0, 0]),
        },
        b: { instance: i.key },
      };
    }),
  };
}
// Explicit physical contacts, independent of mate transform coincidence.
export const seatingPairs = [
  ["Front shell", "Shell seal"],
  ["Rear shell", "Shell seal"],
  ["Front shell", "Lower shell seal"],
  ["Rear shell", "Lower shell seal"],
  ["Front shell", "Optical carrier"],
  ["Optical carrier", "Lens bezel"],
  ["Optical carrier", "Lens gasket"],
  ["Lens gasket", "Optical window"],
  ["Optical window", "Lens retainer"],
  ...[-1, 1].flatMap((s) => {
    const side = s < 0 ? "Left" : "Right";
    return [
      ["Front shell", side + " hub"],
      ["Rear shell", side + " hub"],
      [side + " hub", side + " hub seal"],
      [side + " hub seal", side + " cover"],
      ...Array.from({ length: 6 }, (_, i) => [
        side + " cover",
        `${side} hub screw ${i + 1}`,
      ]),
    ];
  }),
  ...Array.from({ length: 8 }, (_, i) => [
    "Lens bezel",
    `Optical screw ${i + 1}`,
  ]),
  ...ducts.flatMap((d) => [
    ["Front shell", d.name],
    [d.name, d.name.replace("cooling duct", "duct screen")],
  ]),
  ...sensors.flatMap((s) => [
    ["Front shell", s.name],
    [s.name, s.name.replace("Sensor ", "Sensor window ")],
  ]),
  ["Rear shell", "Top vent frame"],
  ["Top vent frame", "Top vent grille"],
  ["Rear shell", "Antenna pedestal"],
  ["Antenna pedestal", "Antenna mast"],
  ["Antenna mast", "Antenna tip"],
  ["Rear shell", "Rear service cover"],
  ...Array.from({ length: 4 }, (_, i) => [
    "Rear service cover",
    `Service screw ${i + 1}`,
  ]),
];
export { parts, instances };
