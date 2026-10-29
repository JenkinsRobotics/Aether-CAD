import {
  Model,
  polygon,
  rounded,
  circle,
  qx,
  qz,
  radial,
  rotate,
} from "../model-kit.mjs";
import { finishes, bell, ogive, useParts, multiply } from "./space/common.mjs";
const m = new Model(
  "space-shuttle",
  "Space Shuttle — Launch and Orbiter",
  "A 1:100 display-scale Shuttle with an external tank, four-segment boosters, detailed orbiter and a separate orbital assembly with opening payload doors.",
);
m.tags = ["Loft", "Revolve", "Extrude", "Hole Wizard", "Multiple assemblies"];
m.sources = [
  {
    title: "NASA Shuttle dimensions",
    url: "https://www.nasa.gov/reference/the-space-shuttle/",
  },
  {
    title: "NASA recordation drawings",
    url: "https://www.nasa.gov/space-shuttle-recordation/recordation-drawings/",
  },
];
m.configurationName = "Launch configuration";
const tank = m
  .part("external-tank", "External tank shell", finishes.foam)
  .revolve("External tank meridian", {
    type: "path",
    start: [0, 80],
    segments: [
      { type: "arc", middle: [33, 90], end: [41.9, 115] },
      { type: "line", end: [41.9, 475] },
      { type: "arc", middle: [30, 522], end: [0.3, 549] },
      { type: "line", end: [0, 549] },
      { type: "line", end: [0, 546] },
      { type: "arc", middle: [28, 519], end: [39.4, 475] },
      { type: "line", end: [39.4, 115] },
      { type: "arc", middle: [31, 93], end: [0, 82.5] },
      { type: "line", end: [0, 80] },
    ],
  });
m.place("External tank — grounded", tank);
const intertank = m
  .part("tank-intertank", "External tank intertank band", finishes.foam)
  .ring("Intertank band", 42.3, 41.8, 0, 35);
m.place("Intertank band", intertank, [0, 0, 345]);
const rib = m
  .part("tank-rib", "Intertank stiffener", "aluminum")
  .pad("Stiffener section", [rounded(1.2, 1.4, 0.3)], 0, 34);
for (let i = 0; i < 28; i++) {
  const a = (i * Math.PI) / 14;
  m.place(
    `Intertank rib ${i + 1}`,
    rib,
    [42.4 * Math.cos(a), 42.4 * Math.sin(a), 345],
    qz(a),
  );
}
const line = m
  .part("tank-line", "External feed-line display tube", finishes.foam)
  .ring("Hollow pipe", 2, 1.3, 0, 300);
m.place("Tank feed line", line, [0, -44, 115]);
const fuselage = m
  .part("orbiter-fuselage", "Orbiter fuselage", finishes.white)
  // Ruled stations keep the thermal skin outside the fuselage between stations;
  // an unconstrained smooth interpolation overshoots the underside here.
  .loft(
    "Fuselage stations",
    [
      [0, rounded(53, 43, 16, 0, -2)],
      [40, rounded(58, 49, 17)],
      [230, rounded(54, 46, 18)],
      [290, rounded(45, 38, 16, 0, -3)],
      [342, rounded(27, 26, 11, 0, -10)],
      [372.3, rounded(1.8, 2.8, 0.8, 0, -14)],
    ],
    "XY",
    true,
  )
  .pad(
    "Open payload bay",
    [rounded(43, 184, 6, 0, 157)],
    -45,
    48,
    "cut",
    "XZ",
    true,
  )
  .holes(
    "Payload floor mounting holes",
    [
      [-14, 100],
      [14, 100],
      [-14, 212],
      [14, 212],
    ],
    2.4,
    -4,
    22,
    { plane: "XZ", through: true, reversed: true },
  );
const belly = m
  .part("orbiter-belly", "Orbiter thermal belly", finishes.tile)
  .loft("Belly thermal profile", [
    [0, rounded(50, 8, 3, 0, -22)],
    [60, rounded(56, 8, 3, 0, -23)],
    [225, rounded(53, 8, 3, 0, -22.5)],
    [300, rounded(39, 8, 3, 0, -21)],
    [349, rounded(16, 4, 1.5, 0, -20)],
  ]);
const wings = [];
for (const side of [-1, 1]) {
  const label = side < 0 ? "Port" : "Starboard";
  const outline = polygon(
    [
      [24, 26],
      [119, 26],
      [119, 53],
      [56, 157],
      [25, 232],
    ].map(([x, z]) => [side * x, z]),
  );
  const wing = m
    .part(`wing-${side}`, `${label} delta wing`, finishes.white)
    .pad("Double-delta wing profile", [outline], 16, 4, "new", "XZ");
  const thermal = m
    .part(`wing-tile-${side}`, `${label} wing thermal panel`, finishes.tile)
    .pad("Underside thermal layer", [outline], 20, 1, "new", "XZ");
  wings.push({ label, wing, thermal });
}
const fin = m.part("tail-fin", "Vertical stabilizer", finishes.white).pad(
  "Swept fin profile",
  [
    polygon([
      [15, 18],
      [76, 24],
      [73, 55],
      [18, 112],
    ]),
  ],
  -1.8,
  3.6,
  "new",
  "YZ",
);
const rudder = m.part("rudder", "Split rudder outline", finishes.tile).pad(
  "Rudder trailing surface",
  [
    polygon([
      [20, 12],
      [76, 20],
      [76, 24],
      [15, 18],
    ]),
  ],
  -2,
  4,
  "new",
  "YZ",
);
const nose = m
  .part("nose-cap", "Reinforced nose cap", finishes.tile)
  .loft("Rounded nose cap", [
    [350, rounded(20, 19, 8, 0, -11.7)],
    [366, rounded(8, 10, 3.5, 0, -13.6)],
    [373, rounded(1.2, 2, 0.5, 0, -14)],
  ]);
const windows = [];
for (const side of [-1, 1]) {
  const glazing = m
    .part(
      `window-${side}`,
      `${side < 0 ? "Port" : "Starboard"} cockpit windows`,
      finishes.window,
    )
    .pad(
      "Cockpit glazing",
      [
        polygon(
          [
            [2, 291],
            [19, 291],
            [14, 310],
            [2, 318],
          ].map(([x, z]) => [side * x, z]),
        ),
      ],
      -17,
      1.2,
      "new",
      "XZ",
    );
  windows.push(glazing);
}
const nozzle = bell(m, "main-nozzle", "Orbiter main engine bell", 10.5, 24);
const oms = m
  .part("oms-pod", "Orbital maneuvering pod", finishes.white)
  .loft("OMS pod stations", [
    [0, rounded(16, 19, 6)],
    [24, rounded(19, 22, 7)],
    [55, rounded(9, 10, 4)],
  ]);
const omsBell = bell(m, "oms-nozzle", "Orbital engine bell", 4.5, 10);
const doorParts = [];
for (const side of [-1, 1]) {
  const s = -side;
  const door = m
    .part(
      `door-${side}`,
      `${side < 0 ? "Port" : "Starboard"} payload door`,
      finishes.white,
    )
    .pad(
      "Curved payload door",
      [
        {
          type: "path",
          start: [0, 0],
          segments: [
            { type: "arc", middle: [s * 6.7365, 16.2635], end: [s * 23, 23] },
            { type: "line", end: [s * 23, 21.8] },
            { type: "arc", middle: [s * 7.585, 15.415], end: [s * 1.2, 0] },
            { type: "line", end: [0, 0] },
          ],
        },
      ],
      0,
      184,
    );
  const radiator = m
    .part(
      `radiator-${side}`,
      `${side < 0 ? "Port" : "Starboard"} door radiator`,
      "aluminum",
    )
    .pad(
      "Radiator backing",
      [rounded(15, 174, 1.5, s * 11.5, 92)],
      -12,
      1,
      "new",
      "XZ",
    );
  doorParts.push({ side, door, radiator });
}
const hinge = m
  .part("door-hinge", "Payload door hinge pin", "steel")
  .ring("Hinge pin", 1.1, 0, 0, 184);
const bayRib = m.part("bay-rib", "Payload bay frame", "aluminum").pad(
  "U frame",
  [
    polygon([
      [-21, 0],
      [-21, 9],
      [-19, 9],
      [-19, 2],
      [19, 2],
      [19, 9],
      [21, 9],
      [21, 0],
    ]),
  ],
  0,
  2,
);
const payload = m
  .part("payload", "Science payload housing", "aluminum")
  .ring("Payload housing", 12, 10.8, 0, 95)
  .ring("End closure", 12, 0, 0, 2, "add")
  .holes("Payload end fasteners", radial(8, 8), 1.5, 2, 2, { through: true });
const payloadCap = m
  .part("payload-cap", "Payload end cover", finishes.gold)
  .ring("Cover", 12, 0, 0, 2);
const mount = m
  .part("orbiter-mount", "Orbiter tank attachment strut", "steel")
  .ring("Attachment strut", 2.7, 0, 0, 31);
const segment = m
  .part("shuttle-booster-segment", "Four-segment booster case", finishes.white)
  .ring("Hollow booster case", 18.55, 16.8, 0, 79);
const band = m
  .part("shuttle-booster-band", "Booster field-joint band", finishes.tile)
  .ring("Field joint", 19, 18.45, 0, 3);
const boosterSkirt = m
  .part("shuttle-booster-skirt", "Booster aft skirt", finishes.white)
  .revolve(
    "Aft skirt section",
    polygon([
      [23, 0],
      [23, 18],
      [18.55, 32],
      [16.8, 32],
      [21, 18],
      [21, 0],
    ]),
  );
const boosterNose = ogive(
  m,
  "shuttle-booster-nose",
  "Booster forward assembly",
  18.55,
  100,
);
const boosterBell = bell(
  m,
  "shuttle-booster-nozzle",
  "Booster nozzle display",
  14,
  12,
);
for (const side of [-1, 1]) {
  const x = side * 63;
  m.place(`Booster ${side} aft skirt`, boosterSkirt, [x, 0, 0]);
  m.place(`Booster ${side} nozzle`, boosterBell, [x, 0, 10]);
  for (let i = 0; i < 4; i++) {
    m.place(`Booster ${side} segment ${i + 1}`, segment, [x, 0, 32 + i * 79]);
    m.place(`Booster ${side} joint ${i + 1}`, band, [x, 0, 32 + i * 79]);
  }
  m.place(`Booster ${side} nose`, boosterNose, [x, 0, 348]);
  m.place(
    `Orbiter attachment ${side}`,
    mount,
    [side * 19, -44, 115],
    qx(Math.PI / 2),
  );
}
function orbiter(config, shift, open) {
  const start = config.instances.length;
  const at = ([x, y, z]) => [x + shift[0], y + shift[1], z + shift[2]];
  config.place("Orbiter fuselage", fuselage, at([0, 0, 0]));
  config.place("Thermal belly", belly, at([0, 0, 0]));
  config.place("Vertical stabilizer", fin, at([0, 0, 0]));
  config.place("Rudder", rudder, at([0, 0, 0]));
  config.place("Nose cap", nose, at([0, 0, 0]));
  windows.forEach((p, i) =>
    config.place(`Cockpit glazing ${i + 1}`, p, at([0, 0, 0])),
  );
  for (const { label, wing, thermal } of wings) {
    config.place(`${label} wing`, wing, at([0, 0, 0]));
    config.place(`${label} wing tiles`, thermal, at([0, 0, 0]));
  }
  [
    [-13, -6, 0],
    [13, -6, 0],
    [0, 14, 0],
  ].forEach((p, i) => config.place(`Main engine ${i + 1}`, nozzle, at(p)));
  for (const side of [-1, 1]) {
    config.place(`OMS pod ${side}`, oms, at([side * 27, 14, 0]));
    config.place(`OMS engine ${side}`, omsBell, at([side * 27, 14, 0]));
  }
  for (const { side, door, radiator } of doorParts) {
    const name = `${side < 0 ? "Port" : "Starboard"} payload door`,
      rotation = qz(open ? -side * 2.05 : 0);
    config.place(name, door, at([side * 23, 0, 65]), rotation);
    config.mate(name, open ? "revolute" : "fastened", "Orbiter fuselage");
    config
      .place(name + " radiator", radiator, at([side * 23, 0, 65]), rotation)
      .mate(name + " radiator", "fastened", name);
    config
      .place(name + " hinge", hinge, at([side * 23, 0, 65]))
      .mate(name + " hinge", "fastened", "Orbiter fuselage");
  }
  for (let i = 0; i < 6; i++)
    config.place(
      `Payload bay frame ${i + 1}`,
      bayRib,
      at([0, -2, 73 + i * 32]),
    );
  config.place("Science payload", payload, at([0, 11, 105]));
  config.place("Payload end cover", payloadCap, at([0, 11, 200]));
  // Every orbiter component follows its fuselage in each configuration.
  for (const instance of config.instances) {
    if (
      instance.key !== "Orbiter fuselage" &&
      !config.joints.has(instance.key) &&
      instance.key.match(
        /Thermal|Vertical|Rudder|Nose|Cockpit|wing|Main engine|OMS|Payload|Science/,
      )
    )
      config.mate(instance.key, "fastened", "Orbiter fuselage");
  }
  // The orbiter's belly faces the tank; its bay and fin face away from it.
  if (!open)
    for (const instance of config.instances.slice(start)) {
      const turn = qz(Math.PI);
      instance.position_mm = rotate(
        turn,
        instance.position_mm.map((v, k) => v - shift[k]),
      ).map((v, k) => v + shift[k]);
      instance.rotation_xyzw = multiply(turn, instance.rotation_xyzw);
    }
}
orbiter(m, [0, -77, 60], false);
const orbit = useParts(
  new Model("orbiter", "Orbiter — payload bay open", "Orbital configuration"),
  m,
);
orbiter(orbit, [0, 0, 0], true);
m.alternates = [orbit];
m.motion =
  "The orbital assembly has two revolute payload-door hinges; the launch stack is fixed.";
export default m;
