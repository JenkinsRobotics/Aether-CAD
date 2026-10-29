import { polygon, materials } from "../../model-kit.mjs";

// Exhibition scale: one model millimetre represents 100 flight-vehicle mm.
// Internal wall, hinge and surface details are illustrative CAD construction.
export const finishes = {
  white: {
    ...materials.ivory,
    name: "White thermal blanket",
    color: "#eeeae2",
    roughness: 0.7,
    metalness: 0.03,
  },
  tile: {
    ...materials.plastic,
    name: "Black thermal protection tile",
    color: "#222832",
    roughness: 0.82,
  },
  foam: {
    ...materials.plastic,
    name: "Orange insulation finish",
    color: "#bb6b32",
    roughness: 0.9,
  },
  gold: {
    ...materials.brass,
    name: "Gold multilayer insulation finish",
    color: "#b38b3e",
    roughness: 0.48,
  },
  solar: {
    ...materials.glass,
    name: "Solar cell display finish",
    color: "#153b7c",
    roughness: 0.22,
    metalness: 0.5,
    opacity: 1,
  },
  window: {
    ...materials.glass,
    name: "Cockpit glazing",
    color: "#173242",
    roughness: 0.12,
    opacity: 0.96,
  },
};
export function bell(model, key, name, radius, length) {
  return model.part(key, name, "steel").revolve(
    "Hollow nozzle display section",
    polygon([
      [radius, -length],
      [radius * 0.92, -length * 0.7],
      [radius * 0.6, -length * 0.34],
      [radius * 0.34, -length * 0.08],
      [radius * 0.34, 0],
      [radius * 0.27, 0],
      [radius * 0.27, -length * 0.08],
      [radius * 0.53, -length * 0.34],
      [radius * 0.85, -length * 0.7],
      [radius * 0.93, -length],
    ]),
  );
}
export function ogive(
  model,
  key,
  name,
  radius,
  height,
  finish = finishes.white,
) {
  return model.part(key, name, finish).revolve("Rounded nose meridian", {
    type: "path",
    start: [0, 0],
    segments: [
      { type: "line", end: [radius, 0] },
      {
        type: "arc",
        middle: [radius * 0.68, height * 0.62],
        end: [0.25, height],
      },
      { type: "line", end: [0, height] },
      { type: "line", end: [0, 0] },
    ],
  });
}
export function multiply(a, b) {
  const [x, y, z, w] = a,
    [X, Y, Z, W] = b;
  return [
    w * X + x * W + y * Z - z * Y,
    w * Y - x * Z + y * W + z * X,
    w * Z + x * Y - y * X + z * W,
    w * W - x * X - y * Y - z * Z,
  ];
}
export function useParts(config, source) {
  config.parts = source.parts;
  return config;
}
