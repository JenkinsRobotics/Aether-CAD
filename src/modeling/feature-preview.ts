import type { PartDocument, PartFeature } from "@aether/core/document";
import type { ImportedModelData } from "@aether/core/contracts";
import type { FeatureInputState } from './feature-input-feedback';

type PreviewService = {
  evaluate(document: PartDocument): Promise<ImportedModelData>;
  show(model: ImportedModelData | null): void;
  feedback?(state: FeatureInputState | null): void;
  /** Builds the complete document in the background so Apply finds it ready. */
  warm?(document: PartDocument): Promise<unknown>;
};
let service: PreviewService | null = null;
let closePrevious: (() => void) | undefined;
export function configureFeaturePreview(value: PreviewService | null) { service = value; }

/** Coalesces edits and discards obsolete replies without mutating saved state. */
export class PreviewQueue<T, R> {
  private revision = 0;
  private running = false;
  private generation = 0;
  private pending: { revision: number; generation: number; value: T } | null = null;
  private closed = false;
  constructor(private evaluate: (value: T) => Promise<R>, private result: (value: R | null, error?: string) => void, private options: { progressive?: (value: R) => void } = {}) {}
  invalidate(clear = true) { this.revision++; this.pending = null; if (clear) { this.generation++; this.result(null); } }
  request(value: T) { this.pending = { revision: ++this.revision, generation: this.generation, value }; void this.run(); }
  close() { this.closed = true; this.invalidate(); }
  private async run() {
    if (this.running || this.closed) return;
    this.running = true;
    while (this.pending && !this.closed) {
      const job = this.pending; this.pending = null;
      try {
        const value = await this.evaluate(job.value);
        // Continuous dragging must still show completed geometry while the next
        // value is queued. Invalid drafts/cancel cross a generation boundary.
        if (!this.closed) {
          if (job.revision === this.revision) this.result(value);
          else if (job.generation === this.generation) this.options.progressive?.(value);
        }
      } catch (error) {
        if (!this.closed && job.revision === this.revision) this.result(null, error instanceof Error ? error.message : String(error));
      }
    }
    this.running = false;
  }
}

export function mountFeaturePreview(root: HTMLElement, candidate: () => PartDocument, onError?: (message: string | null) => void, complete?: () => PartDocument, notice?: (message: string | null) => void, inputs?: () => PartFeature | undefined, onPending?: () => void) {
  if (!service) return { update() {}, close() {}, pause() {} };
  // A preview shows the history up to the edited feature; once it is on screen
  // and the user has paused, the rest of the document is built ahead so Apply
  // is a cache hit instead of a rebuild.
  let warmTimer: ReturnType<typeof setTimeout> | undefined;
  const warm = () => {
    clearTimeout(warmTimer); warmTimer = undefined;
    if (!service?.warm || !complete) return;
    warmTimer = setTimeout(() => { warmTimer = undefined; try { void service!.warm!(complete()).catch(() => {}); } catch { /* the draft is invalid: nothing to warm */ } }, 250);
  };
  window.dispatchEvent(new Event("aether-feature-preview-start"));
  closePrevious?.();
  const backend = service;
  const feedback = (status: FeatureInputState['status'], message?: string) => {
    root.dataset.featureValidation = status;
    for (const box of root.querySelectorAll<HTMLElement>('.aui-feature-entities')) {
      const failed = status === 'error' && Boolean(box.querySelector('.aui-feature-entity:not(.aui-feature-entity--empty)'));
      box.setAttribute('aria-invalid', String(failed));
      box.title = failed ? 'Selection belongs to a feature that could not be built. ' + (message ?? '') : '';
    }
    let feature = latest?.features[(latest.rollbackIndex ?? latest.features.length) - 1];
    try { if (inputs) feature = inputs(); } catch { feature = undefined; }
    if (feature) backend.feedback?.({ feature, status, message });
    else backend.feedback?.(null);
  };
  // Progress and result notes go to the window's floating notice (never
  // reflowing the form); a host without one gets a status line in the body.
  const status = document.createElement("p");
  status.className = "cad-feature-preview-status"; status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite"); status.style.fontSize = "0.8rem"; status.style.margin = "8px 0";
  status.hidden = true;
  if (!notice) root.prepend(status);
  const show = (message: string | null) => { status.textContent = message ?? ""; status.hidden = !message; notice?.(message); };
  const queue = new PreviewQueue(backend.evaluate, (model, error) => {
    backend.show(model);
    root.dispatchEvent(new CustomEvent('aether-feature-preview-state',{bubbles:true,detail:{model,pending:false,error}}));
    if (model && !closed) warm();
    if (model) {
      feedback('valid');
      show(model.featurePreviewUnavailable
        ? "Showing result only. Blue/red material previews require the updated CAD engine."
        : model.featurePreview ? [model.featurePreview.added.length ? "Blue: added material" : "", model.featurePreview.removed.length ? "Red: removed material" : ""].filter(Boolean).join(" · ") || null : null);
      onError?.(null);
    }
    else if (error) { feedback('error', error); show("Preview failed · selected inputs shown in red"); onError?.(error); }
    else show(null);
  // Intermediate geometry is visible, but handles stay pending until their
  // axes match the latest parameters. Only the final result publishes readiness.
  }, {progressive: model => backend.show(model)});
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let latest: PartDocument | null = null;
  const close = () => { if (closed) return; closed = true; clearTimeout(timer); clearTimeout(warmTimer); queue.close(); backend.feedback?.(null); observer.disconnect(); window.removeEventListener("aether-part-updated", close); };
  const update = () => {
    if (closed) return;
    clearTimeout(warmTimer); warmTimer = undefined;
    queue.invalidate(false);
    onPending?.();
    root.dispatchEvent(new CustomEvent('aether-feature-preview-state',{bubbles:true,detail:{pending:true}}));
    try {
      latest = candidate(); feedback('pending'); if(status.textContent !== "Updating preview…") show("Updating preview…");
      // Typing coalesces for 100 ms; a handle drag wants every frame (the queue
      // drops stale requests, so the engine never runs more than one at a time).
      const dragging = document.body.dataset.cadHandleDrag === "1";
      if (dragging) { clearTimeout(timer); timer = undefined; if (latest) queue.request(latest); }
      else if (timer === undefined) timer = setTimeout(() => {
        timer = undefined;
        if (latest) queue.request(latest);
      }, 100);
    } catch (error) { clearTimeout(timer); timer = undefined; queue.invalidate(); const message = error instanceof Error ? error.message : String(error); feedback('error', message); show(message); onError?.(message); }
  };
  const observer = new window.MutationObserver(() => { if (!root.isConnected) close(); });
  observer.observe(document.body, { childList: true, subtree: true });
  closePrevious = close;
  window.addEventListener("aether-part-updated", close);
  return { update, close, pause: () => { clearTimeout(timer); timer = undefined; clearTimeout(warmTimer); warmTimer = undefined; latest = null; queue.invalidate(); backend.feedback?.(null); } };
}
