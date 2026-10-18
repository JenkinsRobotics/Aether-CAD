import { createCenterRectangleSketch } from "../sketch/index";
import partFormat from "./part-format.json";
import {
  LEGACY_PART_DOCUMENT_FORMAT,
  PART_DOCUMENT_FORMAT,
  PART_DOCUMENT_VERSION,
  validatePartDocument,
  type PartDocument,
} from "./part-document";

export function serializePartDocument(document: PartDocument): string {
  validatePartDocument(document);
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function parsePartDocument(text: string): PartDocument {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("The selected file is not valid JSON.");
  }
  const migrated = migratePartDocument(value);
  validatePartDocument(migrated);
  return migrated;
}

export function migratePartDocument(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const format =
    record.format === LEGACY_PART_DOCUMENT_FORMAT
      ? PART_DOCUMENT_FORMAT
      : record.format;
  if (format !== PART_DOCUMENT_FORMAT) return value;
  if (typeof record.formatVersion !== "number" || !partFormat.readable.includes(record.formatVersion)) {
    throw new Error(`Unsupported Part format version: ${String(record.formatVersion ?? "missing")}. Update Aether CAD to open newer Part files.`);
  }
  // v2/v3 already use the feature graph. Retain all authored values and unknown
  // metadata; only the header advances. Reading does not write the source file.
  if (record.formatVersion !== 1) return { ...record, format, formatVersion: PART_DOCUMENT_VERSION };
  const features = Array.isArray(record.features)
    ? record.features.map((feature) => {
        if (!feature || typeof feature !== "object") return feature;
        const item = feature as Record<string, unknown>;
        if (item.type !== "sketch") return feature;
        const profile = item.profile as Record<string, unknown> | undefined;
        if (
          !profile ||
          typeof item.id !== "string" ||
          typeof profile.widthMillimeters !== "number" ||
          typeof profile.heightMillimeters !== "number"
        ) {
          return feature;
        }
        return {
          ...createCenterRectangleSketch(
            item.id,
            item.plane === "XZ" || item.plane === "YZ" ? item.plane : "XY",
            profile.widthMillimeters,
            profile.heightMillimeters,
            true,
          ),
          name: typeof item.name === "string" ? item.name : "Sketch 1",
          suppressed:
            typeof item.suppressed === "boolean" ? item.suppressed : false,
        };
      })
    : record.features;
  return {
    ...record,
    format,
    formatVersion: PART_DOCUMENT_VERSION,
    features,
  };
}
