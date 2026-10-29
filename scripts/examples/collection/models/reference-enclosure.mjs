import { Model, rounded, rectangle, circle, ref } from "../model-kit.mjs";
const m = new Model(
  "reference-enclosure",
  "Reference Electronics Enclosure",
  "SolidCraft’s 80 × 60 × 30 mm enclosure, with a real 2 mm shell, USB wall opening and four bored screw bosses. A separate fitted lid makes it a reusable assembly.",
);
m.tags = ["Extrude", "Shell", "Hole Wizard", "Reference comparison"];
const box = m
  .part("case", "Enclosure case", "blue")
  .pad("Rounded case outline", [rounded(80, 60, 6)], 0, 30);
box.add("Shell — 2 mm walls", {
  type: "shell",
  targetBodyId: ref(box.solid, "body_id"),
  thicknessMillimeters: 2,
  removedFaces: [{ plane: "XY", offsetMillimeters: 30 }],
});
box.pad("USB side opening", [rectangle(12, 7, 0, 12)], 41, 4, "cut", "YZ");
box.pad(
  "Four screw bosses",
  [
    circle(3.5, [-30, -20]),
    circle(3.5, [30, -20]),
    circle(3.5, [30, 20]),
    circle(3.5, [-30, 20]),
  ],
  2,
  12,
  "add",
);
box.holes(
  "Boss pilot holes",
  [
    [-30, -20],
    [30, -20],
    [30, 20],
    [-30, 20],
  ],
  2.5,
  14,
  12,
);
m.place("Case", box);
const lid = m
  .part("lid", "Fitted lid", "ivory")
  .pad("Lid cover", [rounded(80, 60, 6)], 0, 2)
  .pad(
    "Locating lip",
    [rounded(75.6, 55.6, 3.8), rounded(73.2, 53.2, 2.6)],
    -2,
    2,
    "add",
    "XY",
    false,
    [37, 0],
  )
  .holes(
    "Lid screw holes",
    [
      [-30, -20],
      [30, -20],
      [30, 20],
      [-30, 20],
    ],
    3,
    2,
    2,
    { through: true },
  );
m.place("Lid", lid, [0, 0, 30]);
m.reference = {
  source: "examples/demo/enclosure_steps.json",
  sourceSha256:
    "0030b9368aad46eee29f76731a54e28d6b8467e8f833ed16ae5add4ba6f5dc68",
  checks: [{ part: "case", bounds: [80, 60, 30] }],
  differences: [
    "Matches the source at its initial 80 mm width, before its final 100 mm parameter demonstration.",
    "A fitted lid is added; four boss bores use Hole Wizard. The rounded outline is authored as exact arcs before Shell.",
  ],
};
export default m;
