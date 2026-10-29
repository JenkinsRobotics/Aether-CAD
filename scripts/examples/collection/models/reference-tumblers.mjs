import { Model, polygon, rounded, materials } from "../model-kit.mjs";
const m = new Model(
  "reference-tumblers",
  "Reference Glass Tumblers",
  "The two thick glass vessels from SolidCraft’s tumbler scene, with real revolved walls and bases. Both remain individually editable Parts.",
);
m.tags = ["Revolve", "Materials", "Reference comparison"];
const tall = m
  .part("tall", "Tall thick tumbler", {
    ...materials.glass,
    color: "#d8eaf0",
    opacity: 0.44,
  })
  .revolve(
    "Tall vessel meridian",
    polygon([
      [0, 0],
      [36, 0],
      [42, 112],
      [37.5, 112],
      [31.5, 9],
      [0, 9],
    ]),
  );
m.place("Tall tumbler", tall);
const short = m
  .part("short", "Short thick tumbler", {
    ...materials.glass,
    color: "#cadce3",
    opacity: 0.5,
  })
  .revolve(
    "Short vessel meridian",
    polygon([
      [0, 0],
      [37, 0],
      [43, 94],
      [38, 94],
      [32, 10],
      [0, 10],
    ]),
  );
m.place("Short tumbler", short, [115, 0, 0]);
const frustum = (a, b, h) => (Math.PI * h * (a * a + a * b + b * b)) / 3;
m.reference = {
  source: "examples/studio/tumblers.json",
  sourceSha256:
    "11011bcc1dea4e72b6aded735ff99f544ac2d6affbcda6d59961a35337c8abd1",
  checks: [
    { part: "tall", volume: frustum(36, 42, 112) - frustum(31.5, 37.5, 103) },
    { part: "short", volume: frustum(37, 43, 94) - frustum(32, 38, 84) },
  ],
  differences: [
    "Product vessels only: furniture, room and plant are excluded. Vessels are placed side by side at the assembly origin. Optical transparency is illustrative, not the source path-traced renderer.",
  ],
};
export default m;
