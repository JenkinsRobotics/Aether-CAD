import {
  Model,
  polygon,
  rounded,
  rectangle,
  circle,
  radial,
  qx,
  qy,
  materials,
} from "../model-kit.mjs";
const m = new Model(
  "roadster",
  "Studio Roadster",
  "A 320 mm sports-car study with a lofted body, separate hood and cabin, wheels with real bores, drilled brake rotors and swept exhausts.",
);
m.tags = [
  "Loft",
  "Sweep",
  "Extrude",
  "Revolve",
  "Hole Wizard",
  "Fillet",
  "Chamfer",
];
const shell = m.part(
  "body",
  "Roadster body",
  "red",
  "Lofted exterior with open cockpit, wheel wells and panel recesses.",
);
shell
  .loft(
    "Body loft",
    [
      [-160, rounded(98, 24, 9, 0, 43)],
      [-120, rounded(138, 37, 15, 0, 44)],
      [0, rounded(144, 42, 15, 0, 46)],
      [110, rounded(138, 39, 15, 0, 45)],
      [155, rounded(114, 26, 10, 0, 43)],
    ],
    "YZ",
  )
  .pad("Cabin pocket", [rounded(92, 102, 13, 12, 0)], 95, 58, "cut")
  .pad(
    "Wheel arches",
    [circle(31, [-102, 28]), circle(31, [101, 28])],
    -90,
    180,
    "cut",
    "XZ",
    true,
  )
  .pad("Hood panel recess", [rounded(69, 104, 8, -104, 0)], 80, 23, "cut")
  .pad("Rear deck recess", [rounded(41, 101, 7, 121, 0)], 80, 23, "cut");
m.place("Body shell", shell);
const chassis = m
  .part("chassis", "Floor chassis", "aluminum")
  .pad("Floor plate", [rounded(255, 107, 8)], 0, 4)
  .holes(
    "Chassis screw counterbores",
    [
      [-112, -42],
      [-112, 42],
      [112, -42],
      [112, 42],
    ],
    3.2,
    4,
    4,
    {
      through: true,
      cutType: "counterbore",
      counterDiameter: 5.5,
      counterDepth: 1.6,
    },
  );
m.place("Chassis", chassis, [0, 0, 20]);
const hood = m
  .part("hood", "Hood panel", "red")
  .pad("Hood skin", [rounded(67, 102, 7)], 0, 2.5)
  .pad(
    "Hood vent slots",
    Array.from({ length: 5 }, (_, i) => rounded(25, 2.5, 1.2, 5, -16 + i * 8)),
    2.5,
    2.5,
    "cut",
  );
m.place("Hood", hood, [-104, 0, 57]);
const deck = m
  .part("deck", "Rear deck panel", "red")
  .pad("Rear deck", [rounded(39, 99, 6)], 0, 2.5);
m.place("Rear deck", deck, [121, 0, 57]);
const tire = m.part("tire", "Performance tire", "rubber").revolve(
  "Tire section",
  polygon([
    [18, 0],
    [26, 0],
    [28, 2],
    [28, 21],
    [26, 23],
    [18, 23],
  ]),
);
for (const z of [4.5, 10.5, 16.5])
  tire.ring(`Tread circumferential groove ${z}`, 28.2, 27, z, 1.3, "cut");
const wheel = m
  .part("wheel", "Five-spoke alloy wheel", "aluminum")
  .ring("Wheel barrel", 18, 15, 0, 22)
  .ring("Front wheel web", 16, 3.2, 18.5, 3.5, "add")
  .holes("Wheel mounting counterbores", radial(5, 7), 2.5, 22, 3.5, {
    through: true,
    cutType: "counterbore",
    counterDiameter: 3.8,
    counterDepth: 1.3,
  })
  .pad(
    "Five spoke windows",
    radial(5, 0).map((_, i) => {
      const t = (i * 2 * Math.PI) / 5;
      return polygon(
        [
          [10, -2.2],
          [14.6, -3.4],
          [14.6, 3.4],
          [10, 2.2],
        ].map(([x, y]) => [
          x * Math.cos(t) - y * Math.sin(t),
          x * Math.sin(t) + y * Math.cos(t),
        ]),
      );
    }),
    22,
    3.5,
    "cut",
  )
  .finish("Rim bevel", 0.5, 22);
const rotor = m
  .part("rotor", "Ventilated brake rotor", "steel")
  .ring("Brake disk", 14.3, 3.4, 0, 1.4)
  .holes("Drilled rotor holes", radial(18, 11.5), 1.2, 1.4, 1.4, {
    through: true,
  });
for (const x of [-102, 101])
  for (const side of [-1, 1]) {
    const p = [x, side * 55, 28],
      q = qx((-side * Math.PI) / 2),
      name = `${x < 0 ? "Front" : "Rear"} ${side < 0 ? "left" : "right"}`;
    m.place(name + " tire", tire, p, q);
    m.place(name + " alloy wheel", wheel, p, q);
    m.place(name + " brake disk", rotor, [x, side * 57, 28], q);
  }
const axle = m
  .part("axle", "Wheel axle", "steel")
  .ring("Axle shaft", 3.1, 0, 0, 145)
  .ring("Center collar", 5, 0, 68, 9, "add");
for (const x of [-102, 101])
  m.place(
    `${x < 0 ? "Front" : "Rear"} axle`,
    axle,
    [x, 72.5, 28],
    qx(Math.PI / 2),
  );
const glass = m
  .part("windscreen", "Windshield", {
    ...materials.glass,
    color: "#457888",
    opacity: 0.58,
  })
  .loft("Curved windshield", [
    [0, rounded(4, 96, 1.5)],
    [26, rounded(3, 81, 1.4, 15, 0)],
  ]);
m.place("Windshield", glass, [-33, 0, 61]);
const seat = m
  .part("seat", "Bucket seat", "rubber")
  .pad("Cushion", [rounded(32, 34, 6)], 0, 8)
  .pad("Seat back", [rounded(8, 34, 3, 13, 0)], 8, 28, "add")
  .pad("Cushion relief", [rounded(24, 25, 4, -1, 0)], 8, 2, "cut");
m.place("Driver seat", seat, [7, -25, 25]);
m.place("Passenger seat", seat, [7, 25, 25]);
const rollbar = m.part("rollbar", "Roll hoop", "steel").sweep(
  "Bent roll hoop",
  circle(2),
  {
    type: "path",
    start: [0, 0],
    segments: [
      { type: "line", end: [0, 22] },
      { type: "arc", middle: [3, 29], end: [10, 32] },
      { type: "line", end: [58, 32] },
      { type: "arc", middle: [65, 29], end: [68, 22] },
      { type: "line", end: [68, 0] },
    ],
  },
  "YZ",
);
m.place("Roll hoop", rollbar, [45, -34, 56]);
const dash = m
  .part("dash", "Dashboard", "plastic")
  .pad("Dashboard", [rounded(10, 91, 3)], 0, 10);
m.place("Dashboard", dash, [-30, 0, 49]);
const lamp = m
  .part("lamp", "Headlamp lens", {
    ...materials.glass,
    color: "#d5e6ee",
    opacity: 0.9,
  })
  .pad("Headlamp", [rounded(5, 25, 2)], 0, 5);
for (const y of [-36, 36]) m.place(`Headlamp ${y}`, lamp, [-155, y, 46]);
const taillamp = m
  .part("tail-lamp", "Rear light lens", {
    ...materials.plastic,
    color: "#f33138",
    roughness: 0.17,
  })
  .pad("Rear light", [rounded(3, 32, 1.4)], 0, 4);
for (const y of [-33, 33]) m.place(`Rear light ${y}`, taillamp, [154, y, 47]);
const exhaust = m
  .part("exhaust", "Exhaust pipe", "steel")
  .sweep("Exhaust outer sweep", circle(4), {
    type: "path",
    start: [0, 0],
    segments: [
      { type: "line", end: [0, 5] },
      { type: "arc", middle: [1.5, 8.5], end: [5, 10] },
      { type: "line", end: [50, 10] },
    ],
  })
  .holes("Outlet bore", [[0, 10]], 5.8, 51, 20, { plane: "YZ" });
for (const y of [-32, 32]) m.place(`Exhaust ${y}`, exhaust, [112, y, 14]);
const mirror = m
  .part("mirror", "Door mirror", "plastic")
  .pad("Mirror housing", [rounded(17, 9, 3)], 0, 5)
  .pad("Mounting stem", [rectangle(4, 10, -4, -6)], 0, 3, "add");
for (const side of [-1, 1])
  m.place(`${side < 0 ? "Left" : "Right"} mirror`, mirror, [
    -28,
    side * 77,
    60,
  ]);
for (const x of ["Front", "Rear"])
  for (const side of ["left", "right"]) {
    const name = `${x} ${side}`;
    m.mate(name + " alloy wheel", "revolute");
    m.mate(name + " tire", "fastened", name + " alloy wheel");
    m.mate(name + " brake disk", "fastened", name + " alloy wheel");
  }
m.motion =
  "Four revolute wheel bearings; tires and brake disks rotate with their wheel. Grounded body and fastened chassis.";
export default m;
