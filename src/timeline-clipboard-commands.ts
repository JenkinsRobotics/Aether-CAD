import { copyFeatures, type PartDocument } from "@aether/core/document";
import { cadCommands } from "./cad-command-registry";
import { cadPresentation } from "./cad-presentation-store";

/** Timeline copy and paste (SolidCraft's timeline.copy / timeline.paste): Copy holds the
 *  tree's selected feature ids; Paste clones them at the marker through `copyFeatures`. */
export const featureClipboard: { ids: string[] } = { ids: [] };
const report = (message: string, tone: "error" | "success" = "success") => cadPresentation.patch({ statusMessage: message, statusTone: tone });

export function mountTimelineCopy(selectedFeatureIDs: () => readonly string[]) {
  const release = cadCommands.register("timeline-copy-features", () => {
    const ids = [...selectedFeatureIDs()];
    if (!ids.length) { report("Select features in the tree to copy.", "error"); return; }
    featureClipboard.ids = ids;
    report(`${ids.length} feature${ids.length === 1 ? "" : "s"} copied. Paste puts the copies at the marker.`);
  });
  cadCommands.setEnabled("timeline-copy-features", true);
  return release;
}
export function mountTimelinePaste(getDocument: () => PartDocument | null, apply: (doc: PartDocument) => Promise<void>) {
  const release = cadCommands.register("timeline-paste-features", () => {
    const doc = getDocument();
    if (!doc) { report("Open a part before pasting features.", "error"); return; }
    if (!featureClipboard.ids.length) { report("Copy features first.", "error"); return; }
    try {
      const { document, pasted } = copyFeatures(doc, featureClipboard.ids);
      void apply(document).then(() => report(`${pasted.length} feature${pasted.length === 1 ? "" : "s"} pasted at the marker.`)).catch((error: unknown) => report(error instanceof Error ? error.message : String(error), "error"));
    } catch (error) { report(error instanceof Error ? error.message : String(error), "error"); }
  });
  cadCommands.setEnabled("timeline-paste-features", true);
  return release;
}
