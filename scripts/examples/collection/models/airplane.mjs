import {
  Model,
  polygon,
  rounded,
  rectangle,
  circle,
  radial,
  qx,
  qy,
  qz,
  materials,
} from "../model-kit.mjs";
const m = new Model(
  "airplane",
  "Propeller Airplane",
  "A detailed display aircraft with lofted fuselage and airfoil wings, cockpit, separate control surfaces, propeller and landing gear.",
);
m.tags = ["Loft", "Sweep", "Extrude", "Revolve", "Hole Wizard", "Chamfer"];
const body = m.part(
  "fuselage",
  "Fuselage",
  "ivory",
  "Five exact loft stations, an open cockpit pocket and wing mounting holes.",
);
body
  .loft(
    "Fuselage stations",
    [
      [-135, rounded(20, 22, 8, 0, 55)],
      [-90, rounded(38, 44, 15, 0, 55)],
      [0, rounded(44, 50, 18, 0, 55)],
      [100, rounded(24, 26, 9, 0, 55)],
      [170, rounded(4, 6, 1.8, 0, 55)],
    ],
    "YZ",
  )
  .pad("Cockpit opening", [rounded(70, 28, 10, 12, 0)], 90, 45, "cut")
  .holes(
    "Wing mount counterbores",
    [
      [-40, -15],
      [-40, 15],
      [0, -15],
      [0, 15],
    ],
    3,
    83,
    34,
    { cutType: "counterbore", counterDiameter: 5.5, counterDepth: 5 },
  );
m.place("Fuselage", body);
const airfoil = (chord, thick, shift = 0) => ({
  type: "path",
  start: [shift + chord / 2, 0],
  segments: [
    {
      type: "arc",
      middle: [shift - chord * 0.1, thick * 0.62],
      end: [shift - chord / 2, 0],
    },
    {
      type: "arc",
      middle: [shift - chord * 0.1, -thick * 0.28],
      end: [shift + chord / 2, 0],
    },
  ],
});
const wing = m
  .part("wing", "Tapered main wing", "blue")
  .loft(
    "Airfoil loft",
    [
      [0, airfoil(84, 12)],
      [95, airfoil(72, 9, 7)],
      [190, airfoil(40, 5, 24)],
    ],
    "XZ",
  )
  .holes(
    "Wing root fixing",
    [
      [-20, -12],
      [20, -12],
    ],
    3.2,
    8,
    16,
    { through: true },
  );
const rightWing = m
  .part("right-wing", "Starboard main wing", "blue")
  .loft(
    "Starboard airfoil loft",
    [
      [0, airfoil(84, 12)],
      [-95, airfoil(72, 9, 7)],
      [-190, airfoil(40, 5, 24)],
    ],
    "XZ",
  )
  .holes(
    "Starboard wing root fixing",
    [
      [-20, 12],
      [20, 12],
    ],
    3.2,
    8,
    16,
    { through: true },
  );
m.place("Port wing", wing, [-25, 0, 51]);
m.place("Starboard wing", rightWing, [-25, 0, 51]);
const aileron = m.part("aileron", "Aileron", "ivory").pad(
  "Tapered aileron",
  [
    polygon([
      [-11, 0],
      [11, 0],
      [5, 100],
      [-9, 100],
    ]),
  ],
  0,
  3.4,
);
m.place("Port aileron", aileron, [32, -170, 49]);
m.place("Starboard aileron", aileron, [32, 70, 49]);
const tail = m
  .part("tail", "Horizontal stabilizer", "blue")
  .pad(
    "Tail planform",
    [
      polygon([
        [-26, -76],
        [15, -76],
        [37, 0],
        [15, 76],
        [-26, 76],
        [-4, 0],
      ]),
    ],
    0,
    3.8,
  )
  .finish("Tail perimeter bevel", 0.7, 3.8);
m.place("Horizontal stabilizer", tail, [126, 0, 57]);
const fin = m.part("fin", "Vertical stabilizer", "blue").pad(
  "Fin profile",
  [
    polygon([
      [-34, 0],
      [27, 0],
      [14, 54],
      [-5, 60],
    ]),
  ],
  -1.6,
  3.2,
  "new",
  "XZ",
);
m.place("Vertical fin", fin, [125, 0, 63]);
const canopy = m
  .part("canopy", "Cockpit canopy", {
    ...materials.glass,
    color: "#3886a5",
    opacity: 0.6,
  })
  .loft("Canopy crown", [
    [0, rounded(67, 27, 10)],
    [12, rounded(50, 24, 9)],
    [20, rounded(24, 12, 5)],
  ]);
m.place("Canopy", canopy, [12, 0, 71]);
const seat = m
  .part("seat", "Pilot seat", "rubber")
  .pad("Seat cushion", [rounded(16, 18, 3)], 0, 5)
  .pad("Seat back", [rounded(4, 18, 1.5, 7, 0)], 5, 15, "add");
m.place("Pilot seat", seat, [13, 0, 45]);
const spinner = m.part("spinner", "Spinner", "blue").revolve("Spinner nose", {
  type: "path",
  start: [0, 27],
  segments: [
    { type: "arc", middle: [10, 19], end: [13, 0] },
    { type: "line", end: [0, 0] },
    { type: "line", end: [0, 27] },
  ],
});
m.place("Spinner", spinner, [-145, 0, 55], qy(-Math.PI / 2));
const hub = m
  .part("hub", "Propeller hub", "steel")
  .ring("Hub disk", 11, 3, 0, 6)
  .holes("Hub bolts", radial(3, 7), 2, 6, 6, { through: true });
m.place("Propeller hub", hub, [-145, 0, 55], qy(-Math.PI / 2));
const blade = m
  .part("blade", "Propeller blade", "plastic")
  .loft("Blade twist", [
    [0, rounded(14, 5, 2, 12, 0)],
    [35, rounded(18, 4, 1.8, 13, 0)],
    [70, rounded(8, 3, 1.3, 8, 0)],
  ]);
// Blade local Z is radial in the propeller disk; each blade has its own mate.
m.place("Upper propeller blade", blade, [-148, 0, 55]);
m.place("Lower propeller blade", blade, [-148, 0, 55], qx(Math.PI));
const gear = m
  .part("gear", "Bent landing strut", "steel")
  .sweep("Round strut sweep", circle(2.6), {
    type: "path",
    start: [0, 0],
    segments: [
      { type: "line", end: [0, -21] },
      { type: "arc", middle: [2, -28], end: [9, -32] },
      { type: "line", end: [19, -39] },
    ],
  });
m.place("Port landing strut", gear, [-30, -40, 55]);
m.place("Starboard landing strut", gear, [-30, 40, 55]);
const tire = m.part("tire", "Landing tire", "rubber").revolve(
  "Tire section",
  polygon([
    [7, 0],
    [15, 0],
    [17, 2],
    [17, 9],
    [15, 11],
    [7, 11],
  ]),
);
const rim = m
  .part("rim", "Landing wheel hub", "aluminum")
  .ring("Wheel rim", 7, 2.6, 0, 11)
  .holes("Hub lightening holes", radial(6, 4.7), 1.5, 11, 11, {
    through: true,
  });
for (const side of [-1, 1]) {
  m.place(
    `${side < 0 ? "Port" : "Starboard"} tire`,
    tire,
    [-11, side * 44, 17],
    qx((-side * Math.PI) / 2),
  );
  m.place(
    `${side < 0 ? "Port" : "Starboard"} wheel hub`,
    rim,
    [-11, side * 44, 17],
    qx((-side * Math.PI) / 2),
  );
}
const tailGear = m
  .part("tail-gear", "Tail skid", "steel")
  .sweep("Tail skid sweep", circle(1.7), {
    type: "path",
    start: [0, 0],
    segments: [
      { type: "line", end: [0, -20] },
      { type: "arc", middle: [3, -25], end: [9, -27] },
      { type: "line", end: [20, -27] },
    ],
  });
m.place("Tail skid", tailGear, [135, 0, 42]);
m.mate("Propeller hub", "revolute");
for (const name of [
  "Spinner",
  "Upper propeller blade",
  "Lower propeller blade",
])
  m.mate(name, "fastened", "Propeller hub");
for (const side of ["Port", "Starboard"]) {
  m.mate(side + " wheel hub", "revolute");
  m.mate(side + " tire", "fastened", side + " wheel hub");
}
m.motion =
  "Revolute propeller and landing wheels. The spinner and blades rotate together; the fuselage is grounded.";
export default m;
