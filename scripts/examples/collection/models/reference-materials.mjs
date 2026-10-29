import { Model, materials } from "../model-kit.mjs";
const m = new Model(
  "reference-materials",
  "Reference Material Finishes",
  "Six exact radius-10 mm spheres reproducing SolidCraft’s material specimens with saved engineering material names, densities and illustrative finishes.",
);
m.tags = ["Revolve", "Materials", "Reference comparison"];
const specimens = [
  materials.steel,
  materials.aluminum,
  {
    name: "Copper",
    densityKgPerM3: 8960,
    color: "#b8734a",
    roughness: 0.2,
    metalness: 1,
    opacity: 1,
  },
  materials.plastic,
  {
    name: "PLA",
    densityKgPerM3: 1240,
    color: "#d9d4ca",
    roughness: 0.4,
    metalness: 0,
    opacity: 1,
  },
  {
    name: "Oak",
    densityKgPerM3: 700,
    color: "#926d42",
    roughness: 0.62,
    metalness: 0,
    opacity: 1,
  },
];
m.reference = {
  source: "examples/material-finishes.json",
  sourceSha256:
    "09b5c3a7ea110a7fb740f84bf79a9ade16dc007fae8a0cc6790b0370342a65d1",
  checks: [],
  differences: [
    "Uniform PBR finishes; no measured optical constants, grain or printed layers. Nominal densities are descriptive defaults.",
  ],
};
for (const [i, material] of specimens.entries()) {
  const part = m
    .part("specimen-" + i, material.name + " specimen", material)
    .revolve("Spherical specimen", {
      type: "path",
      start: [0, 0],
      segments: [
        { type: "arc", middle: [10, 10], end: [0, 20] },
        { type: "line", end: [0, 0] },
      ],
    });
  m.place(material.name, part, [(i % 3) * 30, Math.floor(i / 3) * 30, 0]);
  m.reference.checks.push({ part: part.key, volume: (4 * Math.PI * 1000) / 3 });
}
export default m;
