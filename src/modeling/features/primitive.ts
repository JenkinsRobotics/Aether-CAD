/** Direct 3D Solid Primitive feature editor (Box, Cylinder, Sphere, Cone, Torus). */
import { availableBodies, type PrimitiveKind } from "@aether/core/document";
import type { Controls, FeatureEditor, FeatureEditorContext } from "./shared";

const KINDS: PrimitiveKind[] = ["box", "cylinder", "sphere", "cone", "torus"];

export const primitiveEditor: FeatureEditor = {
  type: "primitive",
  controls({ field, doc, feature }: FeatureEditorContext): Controls {
    const end = feature ? doc.features.findIndex((f) => f.id === feature.id) : doc.rollbackIndex ?? doc.features.length;
    const bodies = availableBodies({ ...doc, features: doc.features.slice(0, end), rollbackIndex: undefined });
    const o = feature?.originMillimeters ?? [0, 0, 0];
    const target = field("Target body", feature?.targetBodyId ?? bodies[0]?.id ?? "", ["", ...bodies.map((b) => b.id)]);
    for (const opt of (target as HTMLSelectElement).options) {
      opt.textContent = bodies.find((b) => b.id === opt.value)?.name ?? "Auto / none";
    }
    return {
      kind: field("Primitive", feature?.kind ?? "box", KINDS),
      operation: field("Operation", feature?.operation ?? "new", ["new", "add", "cut", "intersect"]),
      targetBodyId: target,
      axis: field("Axis", feature?.axis ?? "Z", ["Z", "X", "Y"]),
      originX: field("Origin X (mm)", String(o[0])),
      originY: field("Origin Y (mm)", String(o[1])),
      originZ: field("Origin Z (mm)", String(o[2])),
      centered: field("Centered (box)", String(feature?.centered !== false), ["true", "false"]),
      width: field("Width X (mm)", String(feature?.widthMillimeters ?? 40)),
      depth: field("Depth Y (mm)", String(feature?.depthMillimeters ?? 30)),
      height: field("Height (mm)", String(feature?.heightMillimeters ?? 20)),
      radius: field("Radius (mm)", String(feature?.radiusMillimeters ?? 15)),
      bottomRadius: field("Bottom radius (mm)", String(feature?.bottomRadiusMillimeters ?? 15)),
      topRadius: field("Top radius (mm)", String(feature?.topRadiusMillimeters ?? 0)),
      majorRadius: field("Major radius (mm)", String(feature?.majorRadiusMillimeters ?? 20)),
      minorRadius: field("Minor radius (mm)", String(feature?.minorRadiusMillimeters ?? 5)),
    };
  },
  validate(c) {
    const k = c.kind.value as PrimitiveKind;
    for (const v of [c.originX.value, c.originY.value, c.originZ.value]) {
      if (!Number.isFinite(Number(v))) return "Origin coordinates must be finite numbers.";
    }
    if (k === "box") {
      if (!(Number(c.width.value) > 0 && Number(c.depth.value) > 0 && Number(c.height.value) > 0)) return "Box dimensions must be positive.";
    } else if (k === "cylinder") {
      if (!(Number(c.radius.value) > 0 && Number(c.height.value) > 0)) return "Cylinder radius and height must be positive.";
    } else if (k === "sphere") {
      if (!(Number(c.radius.value) > 0)) return "Sphere radius must be positive.";
    } else if (k === "cone") {
      const r0 = Number(c.bottomRadius.value), r1 = Number(c.topRadius.value);
      if (!(r0 >= 0 && r1 >= 0 && (r0 > 0 || r1 > 0) && Number(c.height.value) > 0)) return "Cone needs positive height and at least one positive radius.";
    } else if (k === "torus") {
      const maj = Number(c.majorRadius.value), min = Number(c.minorRadius.value);
      if (!(maj > 0 && min > 0 && min < maj)) return "Torus minor radius must be positive and less than major radius.";
    }
    return null;
  },
  serialize(v) {
    const kind = v.kind as PrimitiveKind;
    const base = {
      kind,
      operation: v.operation as "new" | "add" | "cut" | "intersect",
      ...(v.operation !== "new" && v.targetBodyId ? { targetBodyId: v.targetBodyId } : {}),
      axis: v.axis as "X" | "Y" | "Z",
      originMillimeters: [Number(v.originX), Number(v.originY), Number(v.originZ)] as [number, number, number],
    };
    if (kind === "box") {
      return { ...base, centered: v.centered !== "false", widthMillimeters: Number(v.width), depthMillimeters: Number(v.depth), heightMillimeters: Number(v.height) };
    }
    if (kind === "cylinder") {
      return { ...base, radiusMillimeters: Number(v.radius), heightMillimeters: Number(v.height) };
    }
    if (kind === "sphere") {
      return { ...base, radiusMillimeters: Number(v.radius) };
    }
    if (kind === "cone") {
      return { ...base, bottomRadiusMillimeters: Number(v.bottomRadius), topRadiusMillimeters: Number(v.topRadius), heightMillimeters: Number(v.height) };
    }
    return { ...base, majorRadiusMillimeters: Number(v.majorRadius), minorRadiusMillimeters: Number(v.minorRadius) };
  },
};
