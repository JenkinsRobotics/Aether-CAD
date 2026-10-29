import { Model, rounded, materials } from "../model-kit.mjs";
const m = new Model(
  "reference-studio",
  "Reference Coating Study",
  "The four product solids from SolidCraft’s studio study, rebuilt from native sketches and revolves with their original dimensions and positions.",
);
m.tags = ["Extrude", "Revolve", "Materials", "Reference comparison"];
const dark = { ...materials.plastic, color: "#101318", roughness: 0.3 },
  chrome = {
    ...materials.steel,
    color: "#d5d9dd",
    roughness: 0.12,
    metalness: 1,
  };
const shell = m
  .part("shell", "Coated curved shell", dark)
  .pad(
    "Rounded hollow profile",
    [rounded(85, 65, 20, -42, 8), rounded(77, 57, 16, -42, 8)],
    35,
    65,
    "new",
    "XY",
    false,
    [-82.5, 8],
  );
m.place("Curved shell", shell);
const lid = m
  .part("lid", "Floating coated lid", dark)
  .pad("Lid outline", [rounded(85, 65, 20)], 0, 5);
m.place("Floating lid", lid, [-42, 8, 121]);
const sphere = m
  .part("sphere", "Chrome sphere", chrome)
  .revolve("Sphere meridian", {
    type: "path",
    start: [0, -29],
    segments: [
      { type: "arc", middle: [29, 0], end: [0, 29] },
      { type: "line", end: [0, -29] },
    ],
  });
m.place("Chrome sphere", sphere, [60, -3, 60]);
const puck = m
  .part("puck", "Chrome floating puck", chrome)
  .ring("Puck", 24, 0, 0, 7);
m.place("Chrome puck", puck, [63, 5, 112]);
m.reference = {
  source: "examples/studio/stage1.json",
  sourceSha256:
    "c62ccd8b4aa3d32b46ec86be580b7e03b7c5da2cad36476907003241caccca5b",
  checks: [
    { part: "shell", volume: 65805.30723760049 },
    { part: "lid", volume: 25908.18530717959 },
    { part: "sphere", volume: 102160.40430453529 },
    { part: "puck", volume: 12666.901579274047 },
  ],
  differences: [
    "The 3000 mm photographic floor and lighting rig are omitted from the product assembly. Original object positions and nominal geometry are retained.",
  ],
};
export default m;
