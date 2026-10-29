import {
  Model,
  rectangle,
  circle,
  materials,
  qz,
  rotate,
} from "../model-kit.mjs";

const m = new Model(
  "reference-linkage",
  "Reference Chebyshev Linkage",
  "A grounded four-bar linkage with 20 mm crank, 40 mm base, 50 mm coupler and rocker, and a 100 mm tracer arm. Four revolute mates close the mechanism.",
);
m.tags = ["Extrude", "Revolute mates", "Motion", "Reference comparison"];
m.motion =
  "Drive Rotate Crank through a full turn. The grounded base stays fixed while the coupler and rocker follow the closed linkage.";
const ground = m
  .part("ground", "Grounded base", { ...materials.aluminum, color: "#526477" })
  .pad("Base plate", [rectangle(54, 16, 20, 0)], -6, 4);
ground.pad(
  "Fixed pivot posts",
  [circle(4, [0, 0]), circle(4, [40, 0])],
  -2,
  12,
  "add",
);
const crank = m
  .part("crank", "Crank", { ...materials.aluminum, color: "#328bd3" })
  .pad("20 mm crank", [rectangle(20, 6, 10, 0)], 0, 3);
crank.pad(
  "Crank bearing and pin",
  [circle(3), circle(3, [20, 0])],
  3,
  7,
  "add",
);
const coupler = m
  .part("coupler", "Extended coupler", { ...materials.brass, color: "#e3ab4b" })
  .pad("100 mm tracer arm", [rectangle(100, 5, 50, 0)], 3, 3);
coupler
  .pad("Coupler pivots", [circle(2.5), circle(2.5, [50, 0])], 6, 4, "add")
  .pad("Tracer tip", [circle(2, [100, 0])], 6, 4, "add");
const rocker = m
  .part("rocker", "Rocker", { ...materials.aluminum, color: "#3ea69b" })
  .pad("50 mm rocker", [rectangle(50, 6, 25, 0)], 0, 3);
rocker.pad(
  "Rocker bearing and pin",
  [circle(3), circle(3, [50, 0])],
  3,
  7,
  "add",
);
m.place("Ground", ground)
  .place("Crank", crank, [0, 0, 0], qz(Math.PI / 2))
  .place("Coupler", coupler, [0, 20, 0], qz(Math.atan2(30, 40)))
  .place("Rocker", rocker, [40, 0, 0], qz(Math.PI / 2));
m.mate("Crank", "revolute")
  .mate("Coupler", "revolute", "Crank")
  .mate("Rocker", "revolute");
const recipe = m.recipe.bind(m);
m.recipe = (documents) => {
  const value = recipe(documents),
    worldX = [1, 0, 0];
  const inverse = (q) => [-q[0], -q[1], -q[2], q[3]];
  value.mates.push({
    key: "Coupler to rocker",
    kind: "revolute",
    a: {
      instance: "Coupler",
      origin_mm: [50, 0, 0],
      z_axis: [0, 0, 1],
      x_axis: rotate(inverse(m.instances[2].rotation_xyzw), worldX),
    },
    b: {
      instance: "Rocker",
      origin_mm: [50, 0, 0],
      z_axis: [0, 0, 1],
      x_axis: rotate(inverse(m.instances[3].rotation_xyzw), worldX),
    },
  });
  return value;
};
m.reference = {
  source: "examples/chebyshev-motion-trace.json",
  sourceSha256:
    "8094e40acd9d50c25183b2f12a7eeeb9e42e1690dae3d18a37e36fc9c11a9892",
  checks: [],
  differences: [
    "Original linkage lengths and starting pin centers are retained. Each source component’s touching solids are united into one editable Part. Pins illustrate the reference mechanism; this is not a clearance-qualified production bearing design. Motion is recomputed with Aether’s native assembly solver.",
  ],
};
export default m;
