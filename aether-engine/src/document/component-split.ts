/** Splitting a Part document by body (SolidCraft's component.from_bodies /
 *  move_bodies / move_sketches): the features a chosen body or sketch needs,
 *  taken into a document of their own, and what the source keeps.
 *
 *  Pure over the document. A feature shared by a moved body and a staying one
 *  (a sketch both extrude from, a plane) is copied, not moved, so neither side
 *  loses a reference. Body ids embed the document id, so the extracted document
 *  keeps the source's documentId: ids stay valid in both halves. */
import { featureDependencies, bodyIDsForFeature, createdBodyIDs, availableBodies } from "./feature-history";
import { validatePartDocument, type PartDocument } from "./part-document";

/** Every feature id in the transitive dependency closure of the seeds. */
export function featureClosure(doc: PartDocument, seeds: Iterable<string>): Set<string> {
  const deps = featureDependencies(doc);
  const out = new Set<string>();
  const visit = (id: string) => {
    if (out.has(id) || !deps.has(id)) return;
    out.add(id);
    for (const ref of deps.get(id) ?? []) visit(ref);
  };
  for (const seed of seeds) visit(seed);
  return out;
}

/** Features that touch a body: its producer and every later feature that modifies
 *  or consumes it (a boolean eating two bodies belongs to both chains). */
const REFERENCE_TYPES = new Set(["sketch", "profile", "plane", "axis", "point", "curve3d"]);
export function featuresOfBody(doc: PartDocument, bodyId: string): string[] {
  const deps = featureDependencies(doc);
  const touching = new Set<string>();
  for (const f of doc.features) {
    if (createdBodyIDs(doc, f).includes(bodyId)) { touching.add(f.id); continue; }
    if (REFERENCE_TYPES.has(f.type) || createdBodyIDs(doc, f).length) continue;
    if ((deps.get(f.id) ?? []).some((ref) => touching.has(ref))) touching.add(f.id);
  }
  return [...touching];
}

export interface DocumentSplit { readonly extracted: PartDocument; readonly remaining: PartDocument }

/** Take the given bodies and sketches (feature ids of sketch/profile features) out
 *  of `doc`. `extracted` holds their closure in source order; `remaining` keeps
 *  everything the other bodies still need. */
export function splitDocument(doc: PartDocument, pick: { bodyIds?: readonly string[]; sketchIds?: readonly string[] }, name: string): DocumentSplit {
  const bodyIds = [...new Set(pick.bodyIds ?? [])], sketchIds = [...new Set(pick.sketchIds ?? [])];
  const known = new Set(availableBodies(doc).map((b) => b.id));
  for (const id of bodyIds) if (!known.has(id)) throw new Error(`No body ${id} in ${doc.name}.`);
  for (const id of sketchIds) { const f = doc.features.find((x) => x.id === id); if (!f || (f.type !== "sketch" && f.type !== "profile")) throw new Error(`No sketch ${id} in ${doc.name}.`); }
  if (!bodyIds.length && !sketchIds.length) throw new Error("Choose at least one body or sketch.");

  const seeds = [...sketchIds, ...bodyIds.flatMap((id) => featuresOfBody(doc, id))];
  const moving = featureClosure(doc, seeds);
  const staying = featureClosure(doc, availableBodies(doc).filter((b) => !bodyIds.includes(b.id)).flatMap((b) => featuresOfBody(doc, b.id)));
  // Features of the source not tied to any body (loose sketches, planes) stay unless picked.
  for (const f of doc.features) if (!moving.has(f.id) || (staying.has(f.id) && !sketchIds.includes(f.id))) staying.add(f.id);

  const keep = (ids: Set<string>, docName: string): PartDocument => {
    const features = doc.features.filter((f) => ids.has(f.id));
    const bodies = new Set(features.flatMap((f) => bodyIDsForFeature(doc, f)));
    const bodyProperties = Object.fromEntries(Object.entries(doc.bodyProperties ?? {}).filter(([id]) => bodies.has(id)));
    const next: PartDocument = { ...structuredClone(doc), name: docName, features: structuredClone(features), bodyProperties, rollbackIndex: undefined, organization: undefined };
    if (!Object.keys(bodyProperties).length) delete next.bodyProperties;
    delete next.rollbackIndex; delete next.organization;
    validatePartDocument(next);
    return next;
  };
  return { extracted: keep(moving, name), remaining: keep(staying, doc.name) };
}

/** Append another document's features to `target` (move_bodies into an existing
 *  component). Ids already present are skipped: a shared sketch arriving twice is one sketch. */
export function appendDocument(target: PartDocument, source: PartDocument): PartDocument {
  const present = new Set(target.features.map((f) => f.id));
  const next: PartDocument = { ...structuredClone(target), features: [...structuredClone(target.features), ...structuredClone(source.features.filter((f) => !present.has(f.id)))],
    bodyProperties: { ...target.bodyProperties, ...source.bodyProperties } };
  if (!Object.keys(next.bodyProperties ?? {}).length) delete next.bodyProperties;
  validatePartDocument(next);
  return next;
}
