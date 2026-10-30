import { parts, instances, assemblyRecipe } from "./scifirobot-design.mjs";
import { materials } from "../model-kit.mjs";
for (const part of parts) {
  const base = /window/i.test(part.name)
    ? materials.glass
    : /seal|gasket|tip/i.test(part.name)
      ? materials.rubber
      : /screw|mast/i.test(part.name)
        ? materials.steel
        : materials.aluminum;
  part.material = { ...base, color: part.color };
  // Keep the concept's dark optical hardware instead of bright metal/blue glass.
  if (part.key === "16-sensor-window") {
    Object.assign(part.material, { color: "#10171b", opacity: 1, roughness: 0.3, metalness: 0.05 });
  } else if (part.key === "06-optical-window") {
    Object.assign(part.material, { opacity: 0.9, roughness: 0.18 });
  } else if (["04-optical-carrier", "15-sensor-housing"].includes(part.key)) {
    Object.assign(part.material, { roughness: 0.45, metalness: 0.15 });
  } else if (part.key === "13-cooling-duct") {
    Object.assign(part.material, { ...materials.steel, color: part.color, roughness: 0.3, metalness: 0.7 });
  } else if (part.color === "#c6c9c7") {
    Object.assign(part.material, { roughness: 0.42, metalness: 0.35 });
  }
}
export default {
  id: "scifirobot",
  name: "Scifirobot Detailed",
  description:
    "A spherical inspection robot with recessed forward-facing barrels, black sensors, stepped side panels, clearance-fit interfaces, optical assemblies and parent-child component mates.",
  tags: ["Extrude", "Revolve", "Pocket", "Fillet", "Chamfer"],
  parts,
  instances,
  recipe: assemblyRecipe,
};
