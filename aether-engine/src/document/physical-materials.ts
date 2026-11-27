import type { PartDocument } from "./part-document";
import { validateBodyProperties } from "./body-properties";

/** Engineering physical material card (SolidCraft's `material.*` & `material.properties.*`). */
export interface PhysicalMaterialCard {
  id: string;
  name: string;
  category: "metal" | "polymer" | "composite" | "wood" | "ceramic" | "custom";
  densityKgPerM3: number;
  youngsModulusGPa?: number;
  /** Optional orthotropic directional moduli [Ex, Ey, Ez] in GPa. */
  orthotropicModuliGPa?: [number, number, number];
  /** Optional orthotropic shear moduli [Gxy, Gxz, Gyz] in GPa. */
  shearModuliGPa?: [number, number, number];
  /** Optional orthotropic Poisson ratios [nuXY, nuXZ, nuYZ]. */
  orthotropicPoisson?: [number, number, number];
  poissonRatio?: number;
  yieldStrengthMPa?: number;
  thermalConductivityWPerMK?: number;
  colorHex?: string;
}

export const PHYSICAL_MATERIAL_LIBRARY: readonly PhysicalMaterialCard[] = [
  { id: "steel-1018", name: "Mild Steel 1018", category: "metal", densityKgPerM3: 7870, youngsModulusGPa: 205, poissonRatio: 0.29, yieldStrengthMPa: 370, thermalConductivityWPerMK: 51.9, colorHex: "#8c96a0" },
  { id: "stainless-304", name: "Stainless Steel 304", category: "metal", densityKgPerM3: 8000, youngsModulusGPa: 193, poissonRatio: 0.29, yieldStrengthMPa: 215, thermalConductivityWPerMK: 16.2, colorHex: "#b8c0c8" },
  { id: "aluminum-6061", name: "Aluminum 6061-T6", category: "metal", densityKgPerM3: 2700, youngsModulusGPa: 68.9, poissonRatio: 0.33, yieldStrengthMPa: 276, thermalConductivityWPerMK: 167, colorHex: "#cfd6dc" },
  { id: "aluminum-7075", name: "Aluminum 7075-T6", category: "metal", densityKgPerM3: 2810, youngsModulusGPa: 71.7, poissonRatio: 0.33, yieldStrengthMPa: 503, thermalConductivityWPerMK: 130, colorHex: "#c6ced6" },
  { id: "brass-c360", name: "Brass C360", category: "metal", densityKgPerM3: 8490, youngsModulusGPa: 97, poissonRatio: 0.31, yieldStrengthMPa: 310, thermalConductivityWPerMK: 115, colorHex: "#d4af52" },
  { id: "copper-c110", name: "Copper C110", category: "metal", densityKgPerM3: 8960, youngsModulusGPa: 117, poissonRatio: 0.34, yieldStrengthMPa: 220, thermalConductivityWPerMK: 388, colorHex: "#c9744d" },
  { id: "titanium-6al4v", name: "Titanium Ti-6Al-4V", category: "metal", densityKgPerM3: 4430, youngsModulusGPa: 113.8, poissonRatio: 0.342, yieldStrengthMPa: 880, thermalConductivityWPerMK: 6.7, colorHex: "#9aa0a6" },
  { id: "cast-iron", name: "Gray Cast Iron", category: "metal", densityKgPerM3: 7200, youngsModulusGPa: 110, poissonRatio: 0.26, yieldStrengthMPa: 150, thermalConductivityWPerMK: 50, colorHex: "#5d6166" },
  { id: "abs", name: "ABS Plastic", category: "polymer", densityKgPerM3: 1040, youngsModulusGPa: 2.3, poissonRatio: 0.35, yieldStrengthMPa: 42, thermalConductivityWPerMK: 0.17, colorHex: "#d9d4c7" },
  { id: "petg", name: "PETG", category: "polymer", densityKgPerM3: 1270, youngsModulusGPa: 2.1, poissonRatio: 0.38, yieldStrengthMPa: 50, thermalConductivityWPerMK: 0.2, colorHex: "#7db8d6" },
  { id: "pla", name: "PLA", category: "polymer", densityKgPerM3: 1240, youngsModulusGPa: 3.5, poissonRatio: 0.36, yieldStrengthMPa: 60, thermalConductivityWPerMK: 0.13, colorHex: "#e6e2d8" },
  { id: "polycarbonate", name: "Polycarbonate (PC)", category: "polymer", densityKgPerM3: 1200, youngsModulusGPa: 2.4, poissonRatio: 0.37, yieldStrengthMPa: 62, thermalConductivityWPerMK: 0.2, colorHex: "#dceaf2" },
  { id: "nylon-pa66", name: "Nylon PA66", category: "polymer", densityKgPerM3: 1140, youngsModulusGPa: 2.8, poissonRatio: 0.39, yieldStrengthMPa: 75, thermalConductivityWPerMK: 0.25, colorHex: "#e8e3d5" },
  { id: "acetal-delrin", name: "Acetal (Delrin / POM)", category: "polymer", densityKgPerM3: 1410, youngsModulusGPa: 3.1, poissonRatio: 0.35, yieldStrengthMPa: 69, thermalConductivityWPerMK: 0.31, colorHex: "#f0f0ec" },
  { id: "oak-wood", name: "White Oak (Orthotropic)", category: "wood", densityKgPerM3: 750, orthotropicModuliGPa: [12.3, 1.1, 0.7], shearModuliGPa: [0.9, 0.7, 0.25], orthotropicPoisson: [0.37, 0.43, 0.3], colorHex: "#b3834f" },
] as const;

export function findPhysicalMaterial(idOrName: string): PhysicalMaterialCard | undefined {
  const lower = idOrName.trim().toLowerCase();
  if (!lower) return undefined;
  const exact = PHYSICAL_MATERIAL_LIBRARY.find((m) => m.id.toLowerCase() === lower || m.name.toLowerCase() === lower);
  if (exact) return exact;
  const partial = PHYSICAL_MATERIAL_LIBRARY.filter((m) => m.id.toLowerCase().includes(lower) || m.name.toLowerCase().includes(lower));
  return partial.length === 1 ? partial[0] : undefined;
}

/** Persist a physical engineering material on a Part body (`material.assign`). */
export function assignBodyMaterial(
  doc: PartDocument,
  bodyId: string,
  material: { name: string; densityKgPerM3: number } | string,
): PartDocument {
  const resolved = typeof material === "string" ? findPhysicalMaterial(material) : material;
  if (!resolved) throw new Error(`Unknown physical material "${String(material)}".`);
  const next = structuredClone(doc);
  next.bodyProperties ??= {};
  const existing = next.bodyProperties[bodyId] ?? { name: bodyId, visible: true };
  existing.material = { name: resolved.name, densityKgPerM3: resolved.densityKgPerM3 };
  validateBodyProperties(existing);
  next.bodyProperties[bodyId] = existing;
  return next;
}

export function clearBodyMaterial(doc: PartDocument, bodyId: string): PartDocument {
  const next = structuredClone(doc);
  if (next.bodyProperties?.[bodyId]) {
    delete next.bodyProperties[bodyId].material;
  }
  return next;
}

export function materialForBody(doc: PartDocument, bodyId: string): { name: string; densityKgPerM3: number } | undefined {
  return doc.bodyProperties?.[bodyId]?.material;
}

export interface MaterialValidationReport {
  valid: boolean;
  errors: string[];
  derived?: {
    shearModulusGPa?: number;
    bulkModulusGPa?: number;
  };
}

/** Validate physical material card thermodynamic & elasticity bounds (`material.properties.validate`). */
export function validateMaterialCard(card: PhysicalMaterialCard): MaterialValidationReport {
  const errors: string[] = [];
  if (!card.name?.trim()) errors.push("Material name is required.");
  if (!Number.isFinite(card.densityKgPerM3) || card.densityKgPerM3 <= 0) errors.push("Density must be positive in kg/m³.");
  const derived: MaterialValidationReport["derived"] = {};
  if (card.youngsModulusGPa !== undefined) {
    if (!Number.isFinite(card.youngsModulusGPa) || card.youngsModulusGPa <= 0) errors.push("Young's modulus must be positive.");
    if (card.poissonRatio !== undefined) {
      if (!Number.isFinite(card.poissonRatio) || card.poissonRatio <= -1 || card.poissonRatio >= 0.5) {
        errors.push("Isotropic Poisson's ratio must satisfy -1 < nu < 0.5 for thermodynamic stability.");
      } else if (card.youngsModulusGPa > 0) {
        derived.shearModulusGPa = card.youngsModulusGPa / (2 * (1 + card.poissonRatio));
        derived.bulkModulusGPa = card.youngsModulusGPa / (3 * (1 - 2 * card.poissonRatio));
      }
    }
  }
  if (card.orthotropicModuliGPa) {
    if (card.orthotropicModuliGPa.some((e) => !Number.isFinite(e) || e <= 0)) errors.push("Orthotropic moduli must be positive.");
  }
  return { valid: errors.length === 0, errors, derived };
}

/** Compute directional elastic modulus E(d) along a unit 3D direction (`material.properties.directional`). */
export function directionalElasticModulus(card: PhysicalMaterialCard, direction: [number, number, number]): number {
  const len = Math.hypot(direction[0], direction[1], direction[2]);
  if (len < 1e-12) throw new Error("Direction vector must be non-zero.");
  const [l, m, n] = [direction[0] / len, direction[1] / len, direction[2] / len];
  if (!card.orthotropicModuliGPa) {
    if (card.youngsModulusGPa === undefined) throw new Error("Material card has no Young's modulus.");
    return card.youngsModulusGPa;
  }
  const [Ex, Ey, Ez] = card.orthotropicModuliGPa;
  const [Gxy, Gxz, Gyz] = card.shearModuliGPa ?? [Ex / 2.6, Ex / 2.6, Ey / 2.6];
  const [vxy, vxz, vyz] = card.orthotropicPoisson ?? [0.3, 0.3, 0.3];
  const invE =
    (l ** 4) / Ex + (m ** 4) / Ey + (n ** 4) / Ez +
    (1 / Gxy - (2 * vxy) / Ex) * l * l * m * m +
    (1 / Gxz - (2 * vxz) / Ex) * l * l * n * n +
    (1 / Gyz - (2 * vyz) / Ey) * m * m * n * n;
  if (!(invE > 0)) throw new Error("Orthotropic compliance matrix is not positive definite.");
  return 1 / invE;
}
