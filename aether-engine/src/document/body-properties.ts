/** Saved visual finish and engineering material are distinct properties. */
export interface BodyAppearance {
  color?: string;
  opacity?: number;
  roughness?: number;
  metalness?: number;
  emissiveColor?: string;
  emissiveIntensity?: number;
}
export interface BodyProperties {
  name: string;
  visible: boolean;
  description?: string;
  category?: string;
  appearance?: BodyAppearance;
  material?: { name: string; densityKgPerM3: number };
}
export function validateBodyProperties(value: BodyProperties): void {
  if (
    !value ||
    typeof value.name !== "string" ||
    !value.name.trim() ||
    typeof value.visible !== "boolean"
  )
    throw Error("Bodies need a name and visibility state.");
  if (value.material !== undefined) {
    const material = value.material;
    if (
      !material ||
      typeof material.name !== "string" ||
      !material.name.trim() ||
      !Number.isFinite(material.densityKgPerM3) ||
      material.densityKgPerM3 <= 0
    )
      throw Error("A material needs a name and positive density in kg/m³.");
  }
  if (value.appearance !== undefined) {
    const appearance = value.appearance;
    if (
      !appearance ||
      typeof appearance !== "object" ||
      Array.isArray(appearance)
    )
      throw Error("Invalid body appearance.");
    for (const key of ["color", "emissiveColor"] as const)
      if (
        appearance[key] !== undefined &&
        !/^#[0-9a-f]{6}$/i.test(appearance[key]!)
      )
        throw Error("Appearance colors must use six-digit hex values.");
    for (const key of [
      "opacity",
      "roughness",
      "metalness",
      "emissiveIntensity",
    ] as const) {
      const n = appearance[key];
      if (
        n !== undefined &&
        (typeof n !== "number" ||
          !Number.isFinite(n) ||
          n < 0 ||
          n > (key === "emissiveIntensity" ? 5 : 1))
      )
        throw Error(`Invalid body appearance ${key}.`);
    }
  }
}
