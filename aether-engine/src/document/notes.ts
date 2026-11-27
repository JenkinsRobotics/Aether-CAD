import type { PartDocument } from "./part-document";

/** Persisted 3D Note / PMI annotation on a PartDocument (SolidCraft's `note.*` + 3D PMI). */
export interface DocumentNote {
  id: string;
  text: string;
  /** Optional 3D world anchor point in mm (for 3D viewport callout notes & PMI). */
  positionMillimeters?: [number, number, number];
  targetBodyId?: string;
  category?: "note" | "pmi" | "callout" | "review";
  resolved?: boolean;
  createdAt?: string;
}

export function validateDocumentNotes(notes: unknown): void {
  if (notes === undefined) return;
  if (!Array.isArray(notes) || notes.length > 500)
    throw new Error("Document notes must be an array of at most 500 entries.");
  const ids = new Set<string>();
  for (const n of notes as DocumentNote[]) {
    if (!n || typeof n !== "object") throw new Error("Invalid document note.");
    if (typeof n.id !== "string" || !n.id.trim() || ids.has(n.id))
      throw new Error("Document notes need unique non-empty IDs.");
    ids.add(n.id);
    if (typeof n.text !== "string" || !n.text.trim() || n.text.length > 4000)
      throw new Error("Document note text must be 1–4000 characters.");
    if (n.positionMillimeters !== undefined) {
      if (!Array.isArray(n.positionMillimeters) || n.positionMillimeters.length !== 3 || !n.positionMillimeters.every((v) => typeof v === "number" && Number.isFinite(v)))
        throw new Error("Note 3D position must be finite [x, y, z] millimeters.");
    }
    if (n.category !== undefined && !["note", "pmi", "callout", "review"].includes(n.category))
      throw new Error("Unknown note category.");
    if (n.resolved !== undefined && typeof n.resolved !== "boolean")
      throw new Error("Note resolved state must be boolean.");
  }
}

export function addDocumentNote(
  doc: PartDocument,
  note: Omit<DocumentNote, "id"> & { id?: string },
): { document: PartDocument; note: DocumentNote } {
  const next = structuredClone(doc);
  const existing = next.notes ?? [];
  const used = new Set(existing.map((n) => n.id));
  let id = note.id?.trim() || `note-${existing.length + 1}`;
  while (used.has(id)) id += "-1";
  const created: DocumentNote = {
    id,
    text: note.text.trim(),
    ...(note.positionMillimeters ? { positionMillimeters: [...note.positionMillimeters] as [number, number, number] } : {}),
    ...(note.targetBodyId ? { targetBodyId: note.targetBodyId } : {}),
    ...(note.category ? { category: note.category } : {}),
    ...(note.resolved !== undefined ? { resolved: note.resolved } : {}),
    createdAt: note.createdAt ?? new Date().toISOString(),
  };
  next.notes = [...existing, created];
  validateDocumentNotes(next.notes);
  return { document: next, note: created };
}

export function updateDocumentNote(
  doc: PartDocument,
  id: string,
  changes: Partial<Omit<DocumentNote, "id">>,
): PartDocument {
  const next = structuredClone(doc);
  const index = (next.notes ?? []).findIndex((n) => n.id === id);
  if (index < 0) throw new Error(`Note "${id}" does not exist.`);
  next.notes![index] = { ...next.notes![index], ...changes, id };
  validateDocumentNotes(next.notes);
  return next;
}

export function deleteDocumentNote(doc: PartDocument, id: string): PartDocument {
  const next = structuredClone(doc);
  if (!(next.notes ?? []).some((n) => n.id === id)) throw new Error(`Note "${id}" does not exist.`);
  next.notes = next.notes!.filter((n) => n.id !== id);
  if (!next.notes.length) delete next.notes;
  return next;
}

export function listDocumentNotes(doc: PartDocument): DocumentNote[] {
  return structuredClone(doc.notes ?? []);
}
