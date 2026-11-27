/** Bounding Solid feature editor (uniform or independent 6-side margins around bodies). */
import { availableBodies } from "@aether/core/document";
import type { Controls, FeatureEditor, FeatureEditorContext } from "./shared";

export const boundingSolidEditor: FeatureEditor = {
  type: "bounding-solid",
  controls({ field, doc, feature }: FeatureEditorContext): Controls {
    const end = feature ? doc.features.findIndex((f) => f.id === feature.id) : doc.rollbackIndex ?? doc.features.length;
    const bodies = availableBodies({ ...doc, features: doc.features.slice(0, end), rollbackIndex: undefined });
    const target = field("Bodies (blank = all)", feature?.bodyIds?.[0] ?? "", ["", ...bodies.map((b) => b.id)]);
    for (const opt of (target as HTMLSelectElement).options) {
      opt.textContent = bodies.find((b) => b.id === opt.value)?.name ?? "All bodies";
    }
    const m = feature?.marginsMillimeters;
    return {
      bodyId: target,
      margin: field("Uniform margin (mm)", String(feature?.marginMillimeters ?? 0)),
      usePerSide: field("Independent 6-side margins", String(Boolean(m)), ["false", "true"]),
      negX: field("-X margin (mm)", String(m?.[0] ?? 0)),
      posX: field("+X margin (mm)", String(m?.[1] ?? 0)),
      negY: field("-Y margin (mm)", String(m?.[2] ?? 0)),
      posY: field("+Y margin (mm)", String(m?.[3] ?? 0)),
      negZ: field("-Z margin (mm)", String(m?.[4] ?? 0)),
      posZ: field("+Z margin (mm)", String(m?.[5] ?? 0)),
    };
  },
  validate(c) {
    if (!(Number.isFinite(Number(c.margin.value)) && Number(c.margin.value) >= 0)) return "Margin must be zero or positive.";
    if (c.usePerSide.value === "true") {
      for (const k of ["negX", "posX", "negY", "posY", "negZ", "posZ"] as const) {
        const n = Number(c[k].value);
        if (!Number.isFinite(n) || n < 0) return "Each per-side margin must be zero or positive.";
      }
    }
    return null;
  },
  serialize(v) {
    return {
      operation: "new" as const,
      ...(v.bodyId ? { bodyIds: [v.bodyId] } : {}),
      marginMillimeters: Number(v.margin),
      ...(v.usePerSide === "true"
        ? { marginsMillimeters: [Number(v.negX), Number(v.posX), Number(v.negY), Number(v.posY), Number(v.negZ), Number(v.posZ)] as [number, number, number, number, number, number] }
        : {}),
    };
  },
};
