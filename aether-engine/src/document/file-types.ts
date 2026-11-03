/** Aether CAD has one document file. What it holds (part, assembly, drawing or
 * mixed) is metadata inside the archive, never an extension. */
export const AETHER_CAD_EXTENSION = ".aethercad" as const;
export type DocumentKind = "part" | "assembly" | "drawing" | "mixed";
export const isAetherCADFile = (name: string) => name.toLowerCase().endsWith(AETHER_CAD_EXTENSION);
/** `Wrench` and `Wrench.aethercad` both name the file `Wrench.aethercad`. */
export const aetherCADFileName = (stem: string) => {
  const base = stem.trim().replace(/\.aethercad$/i, "").trim();
  if (!base) throw new Error("Enter a document name.");
  return base + AETHER_CAD_EXTENSION;
};
