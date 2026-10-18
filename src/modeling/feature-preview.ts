import type { PartDocument } from "@aether/core/document";
import type { ImportedModelData } from "../domain";

type PreviewService = { evaluate(document: PartDocument): Promise<ImportedModelData>; show(model: ImportedModelData | null): void };
let service: PreviewService | null = null;
let closePrevious: (() => void) | undefined;
export function configureFeaturePreview(value: PreviewService | null) { service = value; }

/** Coalesces edits and discards obsolete replies without mutating saved state. */
export class PreviewQueue<T, R> {
  private revision = 0;
  private running = false;
  private pending: { revision: number; value: T } | null = null;
  private closed = false;
  constructor(private evaluate: (value: T) => Promise<R>, private result: (value: R | null, error?: string) => void) {}
  invalidate(clear = true) { this.revision++; this.pending = null; if (clear) this.result(null); }
  request(value: T) { this.pending = { revision: ++this.revision, value }; void this.run(); }
  close() { this.closed = true; this.invalidate(); }
  private async run() {
    if (this.running || this.closed) return;
    this.running = true;
    while (this.pending && !this.closed) {
      const job = this.pending; this.pending = null;
      try {
        const value = await this.evaluate(job.value);
        if (!this.closed && job.revision === this.revision) this.result(value);
      } catch (error) {
        if (!this.closed && job.revision === this.revision) this.result(null, error instanceof Error ? error.message : String(error));
      }
    }
    this.running = false;
  }
}

export function mountFeaturePreview(root: HTMLElement, candidate: () => PartDocument, onError?: (message: string | null) => void) {
  if (!service) return { update() {}, close() {}, pause() {} };
  window.dispatchEvent(new Event("aether-feature-preview-start"));
  closePrevious?.();
  const backend = service;
  const status = document.createElement("p");
  status.className = "cad-feature-preview-status"; status.setAttribute("role", "status");
  status.hidden = true;
  status.setAttribute("aria-live", "polite"); status.style.fontSize = "0.8rem"; status.style.margin = "8px 0"; root.prepend(status);
  const queue = new PreviewQueue(backend.evaluate, (model, error) => {
    backend.show(model);
    root.dispatchEvent(new CustomEvent('aether-feature-preview-state',{bubbles:true,detail:{model,pending:false}}));
    if (model) {
      status.hidden = false;
      status.textContent = model.featurePreviewUnavailable
        ? "Showing result only. Blue/red material previews require the updated CAD engine."
        : model.featurePreview ? [model.featurePreview.added.length ? "Blue: added material" : "", model.featurePreview.removed.length ? "Red: removed material" : ""].filter(Boolean).join(" · ") : "";
      onError?.(null);
    }
    else if (error) { status.hidden = false; status.textContent = "Preview unavailable. Adjust the feature to continue."; onError?.(error); }
    else { status.textContent = ""; status.hidden = true; }
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let latest: PartDocument | null = null;
  const close = () => { if (closed) return; closed = true; clearTimeout(timer); queue.close(); observer.disconnect(); window.removeEventListener("aether-part-updated", close); };
  const update = () => {
    if (closed) return;
    queue.invalidate(false);
    root.dispatchEvent(new CustomEvent('aether-feature-preview-state',{bubbles:true,detail:{pending:true}}));
    try {
      latest = candidate(); status.hidden = false; if(status.textContent !== "Updating preview…") status.textContent = "Updating preview…";
      if (timer === undefined) timer = setTimeout(() => {
        timer = undefined;
        if (latest) queue.request(latest);
      }, 100);
    } catch (error) { clearTimeout(timer); timer = undefined; latest = null; queue.invalidate(); status.hidden = false; status.textContent = error instanceof Error ? error.message : String(error); }
  };
  const observer = new window.MutationObserver(() => { if (!root.isConnected) close(); });
  observer.observe(document.body, { childList: true, subtree: true });
  closePrevious = close;
  window.addEventListener("aether-part-updated", close);
  return { update, close, pause: () => { clearTimeout(timer); timer = undefined; latest = null; queue.invalidate(); } };
}
