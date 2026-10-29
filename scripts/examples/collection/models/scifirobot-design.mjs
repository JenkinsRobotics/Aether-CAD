// Design inputs only. Every feature is committed through CAD's MCP runprogram.
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
const a = 0.72,
  polar = (r, t) => [r * Math.sin(t), r * Math.cos(t)];
const front = {
  type: "path",
  start: polar(142, a),
  segments: [
    { type: "arc", middle: polar(142, (a + Math.PI / 2) / 2), end: [142, 0] },
    { type: "line", end: [139, 0] },
    {
      type: "arc",
      middle: polar(139, (a + Math.PI / 2) / 2),
      end: polar(139, a),
    },
    { type: "line", end: polar(142, a) },
  ],
};
const rear = {
  type: "path",
  start: [142, 0],
  segments: [
    { type: "arc", middle: polar(142, Math.PI * 0.75), end: [0, -142] },
    { type: "line", end: [0, -139] },
    { type: "arc", middle: polar(139, Math.PI * 0.75), end: [139, 0] },
    { type: "line", end: [142, 0] },
  ],
};
make(
  "01-front-shell",
  "Front shell",
  alloy,
  "284 mm envelope; exact concentric arcs, 3 mm wall, optical seating lip and side hub openings.",
)
  .revolve("Front spherical wall", front)
  .ring("Optical rabbet", 94.4, 0, 110, 7, "cut")
  .pad("Right hub aperture", [circle(69, [0, -6])], 145, 50, "cut", "YZ")
  .pad("Left hub aperture", [circle(69, [0, -6])], -145, 50, "cut", "YZ", true)
  .pad(
    "Top ventilation aperture",
    [circle(26.5, [0, -5])],
    -145,
    15,
    "cut",
    "XZ",
    true,
  );
make(
  "02-rear-shell",
  "Rear shell",
  alloy,
  "Separate removable rear hemisphere, 3 mm wall, hub ports and rear service opening.",
)
  .revolve("Rear spherical wall", rear)
  .pad("Right hub aperture", [circle(69, [0, -6])], 145, 50, "cut", "YZ")
  .pad("Left hub aperture", [circle(69, [0, -6])], -145, 50, "cut", "YZ", true)
  .pad(
    "Top ventilation aperture",
    [circle(26.5, [0, -5])],
    -145,
    15,
    "cut",
    "XZ",
    true,
  )
  .ring("Service opening", 30, 0, -145, 15, "cut", "XY");
// Reverse the rear service cut toward the center of the shell.
parts.at(-1).steps.at(-1).arguments.reversed = true;
make(
  "03-shell-seal",
  "Equatorial shell seal",
  rubber,
  "1.2 mm thick annular interface between front and rear shells.",
).ring("Seal annulus", 142.3, 138.5, -0.6, 1.2);
make(
  "04-optical-carrier",
  "Optical carrier",
  dark,
  "Stepped revolved annular carrier with actual optical passage and screw clearance holes.",
)
  .revolve(
    "Carrier turned section",
    path([
      [72, 0],
      [93.6, 0],
      [93.6, 10],
      [95, 10],
      [95, 15],
      [69, 15],
      [69, 23],
      [46, 23],
      [46, 11],
      [72, 11],
    ]),
  )
  .holes("Bezel mounting holes", 8, 81, 2.4, 15, 15)
  .finish("Carrier front chamfer", 0.5, 23);
make(
  "05-lens-bezel",
  "Lens bezel",
  alloy,
  "Annular front trim with counterbored mounting holes and edge breaks.",
)
  .ring("Bezel annulus", 95, 89.5, 0, 7.5)
  .ring("Inner mounting web", 91, 72, 0, 2, "add")
  .holes("Eight fixing holes", 8, 81, 2.4, 2, 2)
  .holes("Screw head recesses", 8, 81, 3.7, 2, 1)
  .finish("Bezel face chamfer", 0.4, 7.5);
make(
  "06-optical-window",
  "Optical window",
  glass,
  "Exact curved glass crown with a seating skirt; separate Part.",
).revolve("Optical crown", {
  type: "path",
  start: [0, 15],
  segments: [
    { type: "arc", middle: [32.5, 10.8], end: [44, 0] },
    { type: "line", end: [44, -2] },
    { type: "line", end: [0, -2] },
    { type: "line", end: [0, 15] },
  ],
});
make(
  "07-lens-gasket",
  "Lens gasket",
  rubber,
  "Compression ring beneath the optic retaining flange.",
).ring("Optic seal", 46.3, 43.5, 0, 1.2);
make(
  "08-lens-retainer",
  "Lens retaining ring",
  alloy,
  "Machined annular retainer, eight spanner recesses and front bevel.",
)
  .ring("Retainer blank", 49, 43.8, 0, 3.5)
  .holes("Spanner recesses", 8, 46.5, 0.8, 3.5, 1.3)
  .finish("Retainer front bevel", 0.35, 3.5);
make(
  "09-socket-screw",
  "Socket screw",
  steel,
  "Reusable plain-shank display fastener with recessed hex drive; no modeled thread.",
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
  "Stepped hollow bearing-style housing, seal recess and six mounting holes.",
)
  .revolve(
    "Hub turned section",
    path([
      [42, 0],
      [68.5, 0],
      [68.5, 24],
      [59, 24],
      [59, 39],
      [57, 39],
      [57, 40],
      [45, 40],
      [45, 26],
      [35, 26],
      [35, 20],
      [42, 20],
    ]),
  )
  .holes("Hub mounting clearance", 6, 53, 2.4, 39, 15)
  .finish("Hub rim chamfer", 0.5, 40);
make(
  "11-hub-cover",
  "Side hub cover",
  alloy,
  "Recessed cap with six radial ventilation pockets and center disk.",
)
  .ring("Cover blank", 44, 0, 0, 8)
  .ring("Front recess", 32, 0, 8, 2, "cut")
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
    8,
    3,
    "cut",
  )
  .finish("Cover chamfer", 0.4, 8);
make("12-hub-seal", "Side hub seal", rubber, "Separate hub rim seal.").ring(
  "Hub seal",
  58,
  44.2,
  0,
  1.2,
);
make(
  "13-cooling-duct",
  "Cooling duct",
  steel,
  "Ventilation tube with driving OD 18 mm and ID 12.4 mm, mounting flange, outlet lip and two outside relief grooves.",
)
  .ring("Main duct — OD 18 ID 12.4", 9, 6.2, 0, 63)
  .ring("Mounting flange", 13, 6.2, 0, 4, "add")
  .ring("Outlet lip", 10.5, 6.2, 59, 4, "add")
  .ring("Lower relief groove", 9.2, 8.3, 26, 2, "cut")
  .ring("Upper relief groove", 9.2, 8.3, 48, 2, "cut")
  .holes("Flange mounting holes", 3, 10.5, 0.9, 4, 4)
  .finish("Outlet edge break", 0.4, 63);
make(
  "14-duct-screen",
  "Cooling duct screen",
  dark,
  "Thin protective perforated end screen for the cooling passage.",
)
  .ring("Screen disk", 6.1, 0, 0, 1.2)
  .holes("Six airflow holes", 6, 3.5, 1.1, 1.2, 1.2)
  .ring("Center airflow hole", 1.1, 0, 1.2, 1.2, "cut");
make(
  "15-sensor-housing",
  "Auxiliary sensor housing",
  dark,
  "Stepped sensor bezel with blind electronics recess and two fixing holes.",
)
  .ring("Housing base", 15, 0, 0, 7)
  .ring("Sensor face", 12, 0, 7, 3, "add")
  .ring("Window pocket", 10.2, 0, 10, 4, "cut")
  .holes("Sensor fastener recesses", 2, 13, 1, 7, 2)
  .finish("Sensor bezel chamfer", 0.4, 10);
make(
  "16-sensor-window",
  "Auxiliary sensor window",
  glass,
  "Separate domed optical insert with flat seated rear surface.",
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
  "Flanged vent surround with a seat for the slotted grille.",
)
  .revolve(
    "Vent frame section",
    path([
      [26.8, 0],
      [32, 0],
      [32, 3],
      [29, 3],
      [29, 5],
      [26.8, 5],
    ]),
  )
  .holes("Grille screw holes", 4, 30, 0.9, 3, 3)
  .finish("Vent rim break", 0.3, 5);
make(
  "18-top-grille",
  "Top vent grille",
  dark,
  "Connected grille disk with nine genuine through slots and an uncut perimeter.",
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
  "Stepped mounting pedestal with blind socket and two mounting recesses.",
)
  .ring("Base flange", 9, 0, 0, 3)
  .ring("Pedestal", 6, 0, 3, 8, "add")
  .ring("Mast socket", 3.6, 0, 11, 7, "cut")
  .holes("Base screw pockets", 2, 7.4, 0.8, 3, 1.5);
make(
  "20-antenna-mast",
  "Antenna mast",
  steel,
  "Turned mast with seating shoulder and a shallow retaining groove.",
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
  "Rounded cap with a blind mast socket.",
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
  .ring("Blind mast socket", 3.6, 0, 0, 5, "cut");
parts.at(-1).steps.at(-1).arguments.reversed = true;
make(
  "22-service-cover",
  "Rear service cover",
  alloy,
  "Rear maintenance flange with sealing seat, recessed center and four fixing holes.",
)
  .ring("Cover flange", 40, 0, 0, 4)
  .ring("Location spigot", 29.6, 0, -3, 3, "add")
  .ring("Recessed center", 28, 0, 4, 1.2, "cut")
  .holes("Service cover bolts", 4, 35, 2.4, 4, 4)
  .finish("Service cover edge break", 0.4, 4);
export { parts };

// Assembly uses Y up, Z forward, matching the original demonstration model.
const Q = Math.SQRT1_2,
  instances = [];
const add = (
  key,
  part,
  position = [0, 0, 0],
  rotation = [0, 0, 0, 1],
  grounded = false,
) =>
  instances.push({
    key,
    part,
    position_mm: position,
    rotation_xyzw: rotation,
    grounded,
  });
add("Front shell", "01-front-shell", [0, 0, 0], [0, 0, 0, 1], true);
add("Rear shell", "02-rear-shell");
add("Shell seal", "03-shell-seal");
add("Optical carrier", "04-optical-carrier", [0, 0, 105.5]);
add("Lens bezel", "05-lens-bezel", [0, 0, 120.5]);
add("Optical window", "06-optical-window", [0, 0, 131]);
add("Lens gasket", "07-lens-gasket", [0, 0, 128.5]);
add("Lens retainer", "08-lens-retainer", [0, 0, 133]);
for (let i = 0; i < 8; i++) {
  const t = (i * Math.PI) / 4;
  add("Optical screw " + (i + 1), "09-socket-screw", [
    81 * Math.cos(t),
    81 * Math.sin(t),
    114,
  ]);
}
for (const s of [-1, 1]) {
  const label = s < 0 ? "Left" : "Right",
    q = [0, s * Q, 0, Q];
  add(label + " hub", "10-side-hub", [s * 111, 0, -6], q);
  add(label + " hub seal", "12-hub-seal", [s * 150, 0, -6], q);
  add(label + " cover", "11-hub-cover", [s * 151, 0, -6], q);
  for (let i = 0; i < 6; i++) {
    const t = (i * Math.PI) / 3,
      xx = 53 * Math.cos(t),
      yy = 53 * Math.sin(t);
    add(
      label + " hub screw " + (i + 1),
      "09-socket-screw",
      [s * 143, yy, -6 - s * xx],
      q,
    );
  }
  for (let i = 0; i < 3; i++) {
    const pos = [s * 105, -25 + 23 * i, 59.5];
    add(label + " cooling duct " + (i + 1), "13-cooling-duct", pos);
    add(label + " duct screen " + (i + 1), "14-duct-screen", [
      pos[0],
      pos[1],
      120.5,
    ]);
  }
}
for (const x of [-63, 63])
  for (const y of [-96, 96]) {
    add("Sensor " + x + " " + y, "15-sensor-housing", [x, y, 77]);
    add("Sensor window " + x + " " + y, "16-sensor-window", [x, y, 84]);
  }
const up = [-Q, 0, 0, Q];
add("Top vent frame", "17-top-vent-frame", [0, 139, -5], up);
add("Top vent grille", "18-top-grille", [0, 142, -5], up);
add("Antenna pedestal", "19-antenna-base", [-78, 116, -25], up);
add("Antenna mast", "20-antenna-mast", [-78, 122, -25], up);
add("Antenna tip", "21-antenna-tip", [-78, 174, -25], up);
const back = [0, 1, 0, 0];
add("Rear service cover", "22-service-cover", [0, 0, -139], back);
for (let i = 0; i < 4; i++) {
  const t = (i * Math.PI) / 2;
  add(
    "Service screw " + (i + 1),
    "09-socket-screw",
    [-35 * Math.cos(t), 35 * Math.sin(t), -133],
    back,
  );
}
function rotate(q, v) {
  const [x, y, z, w] = q,
    [a, b, c] = v;
  const tx = 2 * (y * c - z * b),
    ty = 2 * (z * a - x * c),
    tz = 2 * (x * b - y * a);
  return [
    a + w * tx + y * tz - z * ty,
    b + w * ty + z * tx - x * tz,
    c + w * tz + x * ty - y * tx,
  ];
}
function product(a, b) {
  const [x, y, z, w] = a,
    [u, v, s, t] = b;
  return [
    w * u + x * t + y * s - z * v,
    w * v - x * s + y * t + z * u,
    w * s + x * v - y * u + z * t,
    w * t - x * u - y * v - z * s,
  ];
}
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
    mates: instances
      .slice(1)
      .map((i) => ({
        key: "Mount " + i.key,
        kind: "fastened",
        a: {
          instance: "Front shell",
          origin_mm: i.position_mm,
          z_axis: rotate(i.rotation_xyzw, [0, 0, 1]),
          x_axis: rotate(i.rotation_xyzw, [1, 0, 0]),
        },
        b: { instance: i.key },
      })),
  };
}
export { instances };
