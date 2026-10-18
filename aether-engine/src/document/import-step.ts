/** Original interchange source is saved; tessellation is always disposable. */
export interface ImportSTEPFeature {
  id: string;
  type: "import-step";
  name: string;
  suppressed: boolean;
  operation: "new";
  bodyId: string;
  sourceName: string;
  dataBase64: string;
}

export function validateImportSTEP(feature: ImportSTEPFeature): void {
  if (feature.operation !== "new" || typeof feature.bodyId !== "string" || !feature.bodyId.trim())
    throw Error("STEP import needs a unique body identity.");
  if (typeof feature.sourceName !== "string" || !/\.(step|stp)$/i.test(feature.sourceName))
    throw Error("STEP import needs its source filename.");
  if (typeof feature.dataBase64 !== "string" || !feature.dataBase64.length || feature.dataBase64.length > 4 * 1024 * 1024 || (feature.dataBase64.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(feature.dataBase64) || /=/.test(feature.dataBase64.slice(0, -2)) || /=[^=]$/.test(feature.dataBase64)))
    throw Error("Invalid STEP source (maximum 3 MiB per import).");
}
