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
}
export default {
  id: "scifirobot",
  name: "Scifirobot Detailed",
  description:
    "A spherical inspection robot with two shell halves, optical assembly, cooling ducts, seals, fasteners and service covers.",
  tags: ["Extrude", "Revolve", "Pocket", "Fillet", "Chamfer"],
  parts,
  instances,
  recipe: assemblyRecipe,
};
