import { Model, polygon, ref } from "../model-kit.mjs";
const m = new Model(
  "reference-bracket",
  "Reference Mounting Bracket",
  "SolidCraft bracket recreated as an editable Aether Part: 40 × 60 × 30 mm, 6 mm legs, an R2 edge and two real Ø8 through holes.",
);
m.tags = ["Extrude", "Fillet", "Hole Wizard", "Reference comparison"];
const p = m.part("bracket", "Mounting bracket", "aluminum").pad(
  "L profile extrusion",
  [
    polygon([
      [0, 0],
      [40, 0],
      [40, -6],
      [6, -6],
      [6, -30],
      [0, -30],
    ]),
  ],
  0,
  60,
  "new",
  "XZ",
);
p.add("Outer edge fillet R2", {
  type: "fillet",
  radiusMillimeters: 2,
  targetBodyId: ref(p.solid, "body_id"),
  edges: [
    {
      kind: "curved-edge",
      sourceFeatureId: ref(p.solid),
      bodyId: ref(p.solid, "body_id"),
      label: "Outer long edge",
      midpointMillimeters: [40, -30, -6],
      lengthMillimeters: 60,
    },
  ],
});
p.holes(
  "Two mounting holes",
  [
    [25, -15],
    [25, -45],
  ],
  8,
  0,
  6,
  { through: true },
);
m.place("Bracket", p);
m.reference = {
  source: "examples/bracket.json",
  sourceSha256:
    "79dfc10932c808dc95888c5b001bdab440f7507e0c2ddcba0502cf521241785d",
  checks: [
    {
      part: "bracket",
      holeRemoval: 192 * Math.PI,
      volume: 384 * 60 - (4 - Math.PI) * 60 - 192 * Math.PI,
    },
  ],
  differences: [
    "Hole Wizard replaces the source’s circular extrusion cuts. Coordinate system and nominal dimensions are retained.",
  ],
};
export default m;
