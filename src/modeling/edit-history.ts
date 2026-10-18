import type { PartDocument } from "@aether/core/document";
import type { ImportedModelData } from "../domain";

type HistoryService = {
  evaluate(document: PartDocument): Promise<ImportedModelData>;
  show(model: ImportedModelData | null, active: boolean): void;
  changed(): void;
  error(message: string): void;
};

/** Transient editor state. The persisted document and its rollback are untouched. */
export class EditHistory {
  private session: { documentId: string; featureId: string } | null = null;
  private revision = 0;
  constructor(private service: HistoryService) {}

  project(document: PartDocument | null, includeEdited = true): PartDocument | null {
    if (!document || this.session?.documentId !== document.documentId) return document;
    const index = document.features.findIndex(f => f.id === this.session!.featureId);
    return index < 0 ? document : { ...document, rollbackIndex: index + Number(includeEdited) };
  }

  begin(document: PartDocument, featureId: string): () => void {
    const index = document.features.findIndex(f => f.id === featureId);
    if (index < 0) return () => {};
    const revision = ++this.revision;
    this.session = { documentId: document.documentId, featureId };
    this.service.show(null, true); // Hide downstream geometry immediately, even during evaluation.
    this.service.changed();
    void this.service.evaluate(structuredClone(this.project(document, false)!)).then(model => {
      if (this.revision === revision) this.service.show(model, true);
    }).catch(error => {
      if (this.revision === revision) this.service.error(error instanceof Error ? error.message : String(error));
    });
    return () => {
      if (this.revision !== revision) return;
      this.revision++;
      this.session = null;
      this.service.show(null, false);
      this.service.changed();
    };
  }
}

let history: EditHistory | null = null;
export function configureEditHistory(service: HistoryService | null) { history = service ? new EditHistory(service) : null; }
export function editingDocument(document: PartDocument | null) { return history?.project(document) ?? document; }

/** Scope temporary rollback to the editor's actual lifetime, including Cancel. */
export function mountEditHistory(root: HTMLElement, document: PartDocument, featureId?: string) {
  if (!featureId || !history) return;
  const end = history.begin(document, featureId);
  const observer = new window.MutationObserver(() => {
    if (root.isConnected) return;
    observer.disconnect(); end();
  });
  observer.observe(root.ownerDocument.body, { childList: true, subtree: true });
}

/** A solid preview includes the edited operation, but none of its descendants. */
export function featurePreviewDocument(document: PartDocument, featureId?: string): PartDocument {
  if (!featureId) return document;
  const index = document.features.findIndex(f => f.id === featureId);
  return index < 0 ? document : { ...document, rollbackIndex: index + 1 };
}
