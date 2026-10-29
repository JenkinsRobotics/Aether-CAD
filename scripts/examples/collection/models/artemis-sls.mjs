import {
  Model,
  polygon,
  rounded,
  rectangle,
  circle,
  qx,
  qy,
  qz,
  radial,
  rotate,
} from "../model-kit.mjs";
import { finishes, bell, ogive, useParts, multiply } from "./space/common.mjs";
const m = new Model(
  "artemis-sls",
  "Artemis SLS Block 1 and Orion",
  "A 1:100 display-scale SLS Block 1 launch stack plus a separate Orion spacecraft assembly with deployed, rotating solar wings. Shared editable Parts include the capsule, service module and array panels.",
);
m.tags = ["Revolve", "Extrude", "Sweep", "Hole Wizard", "Multiple assemblies"];
m.sources = [
  {
    title: "NASA SLS reference",
    url: "https://www.nasa.gov/reference/space-launch-system/",
  },
  {
    title: "NASA Orion service module",
    url: "https://www.nasa.gov/reference/european-service-module/",
  },
  {
    title: "ESA solar wings",
    url: "https://www.esa.int/Science_Exploration/Human_and_Robotic_Exploration/Orion/European_Service_Module_Power",
  },
];
m.configurationName = "Launch configuration";
const core = m.part("sls-core", "SLS core stage shell", finishes.foam).revolve(
  "Core stage shell meridian",
  polygon([
    [40, 0],
    [42.03, 12],
    [42.03, 625],
    [39, 646],
    [36.8, 646],
    [39.8, 625],
    [39.8, 12],
    [37.8, 0],
  ]),
);
m.place("Core stage — grounded", core);
const engineBay = m
  .part("core-engine-section", "Core engine section", finishes.foam)
  .ring("Engine-section reinforcement", 42.8, 41.9, 0, 45)
  .holes("Engine-section bolt circle", radial(16, 42.35), 0.45, 45, 3);
m.place("Core engine section", engineBay);
const ring = m
  .part("core-band", "Stage flange", "aluminum")
  .ring("Stage flange section", 42.7, 41.9, 0, 2);
for (const z of [45, 390, 445, 625, 643])
  m.place(`Core stage flange ${z}`, ring, [0, 0, z]);
const rib = m
  .part("core-intertank-rib", "Core intertank rib", finishes.foam)
  .pad("Longitudinal rib", [rounded(1.4, 1.8, 0.4)], 0, 55);
for (let i = 0; i < 32; i++) {
  const a = (i * Math.PI) / 16;
  m.place(
    `Core intertank rib ${i + 1}`,
    rib,
    [42.5 * Math.cos(a), 42.5 * Math.sin(a), 390],
    qz(a),
  );
}
const feed = m
  .part("core-feedline", "Core external line", finishes.foam)
  .sweep("External line sweep", circle(1.5), {
    type: "path",
    start: [0, 0],
    segments: [
      { type: "line", end: [0, 320] },
      { type: "arc", middle: [1.5, 324], end: [5, 326] },
      { type: "line", end: [5, 355] },
    ],
  });
m.place("Core external line", feed, [0, -44, 50]);
const rs25 = bell(m, "rs25", "RS-25 display nozzle", 12, 27);
for (const [i, p] of [
  [-16, -16],
  [16, -16],
  [-16, 16],
  [16, 16],
].entries())
  m.place(`RS-25 ${i + 1}`, rs25, [...p, 3]);
const skirt = m
  .part("sls-booster-skirt", "Five-segment booster aft skirt", finishes.white)
  .revolve(
    "Booster aft skirt",
    polygon([
      [23, 0],
      [23, 22],
      [18.55, 35],
      [16.8, 35],
      [21, 21],
      [21, 0],
    ]),
  );
const segment = m
  .part("sls-booster-segment", "SLS booster segment", finishes.white)
  .ring("Hollow segment case", 18.55, 16.8, 0, 85);
const joint = m
  .part("sls-booster-joint", "SLS booster joint band", finishes.tile)
  .ring("Joint band", 19.05, 18.5, 0, 3);
const boosterNose = ogive(
  m,
  "sls-booster-nose",
  "SLS booster forward assembly",
  18.55,
  80,
);
const boosterNozzle = bell(
  m,
  "sls-booster-nozzle",
  "SLS booster display nozzle",
  14,
  15,
);
const strut = m
  .part("sls-booster-attachment", "Booster attachment pin", "steel")
  .ring("Attachment pin", 3, 0, 0, 25);
for (const side of [-1, 1]) {
  const x = side * 63;
  m.place(`Booster ${side} skirt`, skirt, [x, 0, 0]);
  m.place(`Booster ${side} nozzle`, boosterNozzle, [x, 0, 10]);
  for (let j = 0; j < 5; j++) {
    m.place(`Booster ${side} segment ${j + 1}`, segment, [x, 0, 35 + j * 85]);
    m.place(`Booster ${side} joint ${j + 1}`, joint, [x, 0, 35 + j * 85]);
  }
  m.place(`Booster ${side} forward assembly`, boosterNose, [x, 0, 460]);
  for (const z of [45, 425])
    m.place(
      `Booster ${side} attachment ${z}`,
      strut,
      [side * 40, 0, z],
      qy((side * Math.PI) / 2),
    );
}
const adapter = m
  .part(
    "launch-vehicle-adapter",
    "Launch vehicle stage adapter",
    finishes.white,
  )
  .revolve(
    "Stage adapter cone",
    polygon([
      [42, 0],
      [25, 68],
      [23.2, 68],
      [40.2, 0],
    ]),
  );
m.place("Launch vehicle stage adapter", adapter, [0, 0, 646]);
const upper = m
  .part("icps-stage", "Interim cryogenic propulsion stage", finishes.white)
  .revolve(
    "ICPS tank shell",
    polygon([
      [25, 0],
      [25, 92],
      [22, 108],
      [20.5, 108],
      [23.5, 92],
      [23.5, 0],
    ]),
  );
m.place("ICPS upper stage", upper, [0, 0, 714]);
const icpsBand = m
  .part("icps-band", "ICPS insulation band", finishes.tile)
  .ring("Upper-stage band", 25.3, 24.9, 0, 12);
m.place("ICPS dark band", icpsBand, [0, 0, 730]);
const osa = m
  .part("orion-adapter", "Orion stage adapter", finishes.white)
  .revolve(
    "Orion adapter shell",
    polygon([
      [22, 0],
      [25, 27],
      [23.7, 27],
      [20.7, 0],
    ]),
  );
m.place("Orion stage adapter", osa, [0, 0, 822]);
// Orion common native Parts are reused by both assemblies.
const service = m
  .part("orion-service", "Orion European service module", "aluminum")
  .revolve(
    "Service module shell",
    polygon([
      [20, 0],
      [20, 35],
      [24.6, 40],
      [23.2, 40],
      [18.6, 35],
      [18.6, 0],
    ]),
  );
const thermal = m
  .part("orion-thermal", "Service module thermal blanket", finishes.gold)
  .ring("Thermal blanket band", 20.5, 19.9, 0, 29);
const deck = m
  .part("orion-deck", "Service module equipment deck", "aluminum")
  .ring("Equipment deck", 19.9, 4, 0, 1.8)
  .holes("Equipment mounting holes", radial(12, 16), 1.4, 1.8, 1.8, {
    through: true,
  });
const heat = m
  .part("orion-heat-shield", "Orion heat shield", finishes.tile)
  .revolve("Heat shield meridian", {
    type: "path",
    start: [0, 0],
    segments: [
      { type: "arc", middle: [17, 0.6], end: [25.15, 3] },
      { type: "line", end: [25.15, 5] },
      { type: "line", end: [0, 5] },
      { type: "line", end: [0, 0] },
    ],
  });
const capsule = m
  .part("orion-capsule", "Orion crew module shell", "aluminum")
  .revolve(
    "Crew module conical shell",
    polygon([
      [25.15, 0],
      [10, 29],
      [8, 32],
      [0, 32],
      [0, 30.7],
      [7.4, 30.7],
      [8.9, 28],
      [23.7, 0],
    ]),
  );
const docking = m
  .part("orion-docking", "Orion docking collar", "steel")
  .ring("Docking collar", 8, 5.4, 0, 3)
  .holes("Docking ring bolt holes", radial(12, 6.7), 0.65, 3, 3, {
    through: true,
  });
const hatch = m
  .part("orion-hatch", "Crew access hatch", finishes.white)
  .pad("Hatch profile", [rounded(8, 11, 2)], 0, 0.65)
  .holes(
    "Hatch fixing holes",
    [
      [-2.6, -3.7],
      [2.6, -3.7],
      [-2.6, 3.7],
      [2.6, 3.7],
    ],
    0.55,
    0.65,
    0.65,
    { through: true },
  );
const glazing = m
  .part("orion-window", "Orion observation window", finishes.window)
  .pad("Window aperture glazing", [rounded(3.5, 4.5, 0.8)], 0, 0.6);
const mainBell = bell(
  m,
  "orion-main-nozzle",
  "Orion main engine display",
  5,
  12,
);
const smallBell = bell(
  m,
  "orion-rcs-nozzle",
  "Orion auxiliary display nozzle",
  1.4,
  3.3,
);
const arrayFrame = m
  .part("orion-solar-frame", "Solar wing panel frame", "aluminum")
  .pad("Panel backing", [rectangle(19.8, 20)], 0, 0.55)
  .pad("Panel inset", [rectangle(18.6, 18.8)], 0.55, 0.25, "cut");
const arrayCells = m
  .part("orion-solar-cells", "Solar cell panel", finishes.solar)
  .pad("Cell substrate", [rectangle(18.5, 18.7)], 0, 0.22);
// The linework is real shallow cut geometry rather than a screenshot texture.
arrayCells.pad(
  "Cell column channels",
  Array.from({ length: 5 }, (_, i) => rectangle(0.12, 18.7, (i - 2) * 3.1, 0)),
  0.22,
  0.08,
  "cut",
);
arrayCells.pad(
  "Cell row channels",
  Array.from({ length: 7 }, (_, i) => rectangle(18.5, 0.12, 0, (i - 3) * 2.4)),
  0.22,
  0.08,
  "cut",
);
const boom = m
  .part("orion-array-boom", "Solar wing root boom", "steel")
  .pad("Root boom", [rectangle(15, 1.6, 2.5, 0)], -0.5, 1)
  .holes("Root pivot bore", [[1.5, 0]], 0.8, 0.5, 1, { through: true });
const hinge = m
  .part("orion-array-hinge", "Solar panel hinge", "steel")
  .ring("Panel hinge pin", 0.7, 0, 0, 20);
function orion(config, origin, deployed) {
  const at = ([x, y, z]) => [x + origin[0], y + origin[1], z + origin[2]];
  config.place("Orion service module", service, at([0, 0, 0]));
  for (const [name, part, pos] of [
    ["Service thermal blanket", thermal, [0, 0, 3]],
    ["Service equipment deck", deck, [0, 0, 0]],
    ["Crew module heat shield", heat, [0, 0, 39]],
    ["Crew module", capsule, [0, 0, 44]],
    ["Docking collar", docking, [0, 0, 76]],
    ["Orion main engine", mainBell, [0, 0, 0]],
  ])
    config
      .place(name, part, at(pos))
      .mate(name, "fastened", "Orion service module");
  config
    .place("Crew access hatch", hatch, at([0, -18, 56]), qx(Math.PI / 3))
    .mate("Crew access hatch", "fastened", "Orion service module");
  for (const side of [-1, 1])
    config
      .place(
        `Crew window ${side}`,
        glazing,
        at([side * 7, -14.4, 63]),
        qx(Math.PI / 3),
      )
      .mate(`Crew window ${side}`, "fastened", "Orion service module");
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    config
      .place(
        `Auxiliary nozzle ${i + 1}`,
        smallBell,
        at([16 * Math.cos(a), 16 * Math.sin(a), 0]),
      )
      .mate(`Auxiliary nozzle ${i + 1}`, "fastened", "Orion service module");
  }
  for (let wing = 0; wing < 4; wing++) {
    const a = Math.PI / 4 + (wing * Math.PI) / 2,
      turn = qz(a),
      root = [25 * Math.cos(a), 25 * Math.sin(a), 15];
    const base = `Solar wing ${wing + 1}`,
      q = deployed ? turn : multiply(turn, qy(-Math.PI / 2));
    config
      .place(base + " root", boom, at(root), q)
      .mate(
        base + " root",
        deployed ? "revolute" : "fastened",
        "Orion service module",
        [1, 0, 0],
      );
    const place = (name, part, local, r = q) => {
      const delta = rotate(q, local),
        p = root.map((v, k) => v + delta[k]);
      config.place(name, part, at(p), r).mate(name, "fastened", base + " root");
    };
    for (let panel = 0; panel < 3; panel++) {
      // Stowed panels form a compact stacked pack under the launch fairing.
      const c = deployed ? [20 + panel * 20, 0, 0] : [12, 0, panel * 0.95];
      place(base + ` panel ${panel + 1} frame`, arrayFrame, c);
      place(base + ` panel ${panel + 1} cells`, arrayCells, [
        c[0],
        c[1],
        c[2] + 0.32,
      ]);
      place(
        base + ` panel ${panel + 1} hinge`,
        hinge,
        [c[0] - 9.9, -10, c[2]],
        multiply(q, qx(-Math.PI / 2)),
      );
    }
  }
}
orion(m, [0, 0, 849], false);
const fairing = m
  .part("orion-fairing", "Orion service module fairing panel", finishes.white)
  .pad(
    "One-third fairing shell",
    [
      {
        type: "path",
        start: [25.7, 0],
        segments: [
          {
            type: "arc",
            middle: [12.85, 25.7 * Math.sin(Math.PI / 3)],
            end: [-12.85, 25.7 * Math.sin(Math.PI / 3)],
          },
          { type: "line", end: [-12.2, 24.4 * Math.sin(Math.PI / 3)] },
          {
            type: "arc",
            middle: [12.2, 24.4 * Math.sin(Math.PI / 3)],
            end: [24.4, 0],
          },
          { type: "line", end: [25.7, 0] },
        ],
      },
    ],
    0,
    43,
  );
for (let i = 0; i < 3; i++)
  m.place(
    `Service fairing ${i + 1}`,
    fairing,
    [0, 0, 849],
    qz((i * Math.PI * 2) / 3),
  );
const cover = m
  .part("orion-launch-cover", "Orion boost protective cover", finishes.white)
  .revolve(
    "Crew protective shell",
    polygon([
      [26, 0],
      [10.8, 30],
      [7.2, 35],
      [5.8, 35],
      [9.5, 29],
      [24.7, 0],
    ]),
  );
m.place("Boost protective cover", cover, [0, 0, 892]);
const tower = m
  .part("abort-tower", "Launch abort tower display", finishes.white)
  .revolve(
    "Tower outer profile",
    polygon([
      [7, 0],
      [7, 10],
      [4.8, 13],
      [4.8, 49],
      [2.1, 54],
      [0, 54],
      [0, 0],
    ]),
  );
m.place("Launch abort tower", tower, [0, 0, 927]);
const lasNozzle = bell(
  m,
  "abort-nozzle",
  "Abort tower display nozzle",
  2.2,
  5.5,
);
for (let i = 0; i < 4; i++) {
  const a = (i * Math.PI) / 2;
  m.place(
    `Abort nozzle ${i + 1}`,
    lasNozzle,
    [5.5 * Math.cos(a), 5.5 * Math.sin(a), 938],
    multiply(qz(a), qy(-Math.PI / 3)),
  );
}
const orbit = useParts(
  new Model(
    "orion",
    "Orion — solar arrays deployed",
    "Spacecraft configuration",
  ),
  m,
);
orion(orbit, [0, 0, 0], true);
m.alternates = [orbit];
m.motion =
  "Orion has four independently rotating solar-wing roots. Each wing’s three framed panels move together; the service module stays grounded.";
export default m;
