/** Screen-space 3D PMI / Note callout pin overlay for the 3D viewport.
 *  Projects persisted DocumentNote 3D anchors through `aether-measure-project`
 *  so note pins follow the model smoothly across orbit, pan, and zoom. */
import type { DocumentNote } from "@aether/core/document";
import { documentNotesBridge } from "../ui/panels/notes";

type ScreenPoint = { x: number; y: number } | null;

export interface Notes3DOverlayHandle {
  refresh(): void;
  dispose(): void;
}

export interface Notes3DOverlayOptions {
  onSelect?: (noteId: string) => void;
}

export function mountDocumentNotesOverlay(
  viewport: HTMLElement,
  options?: Notes3DOverlayOptions,
): Notes3DOverlayHandle {
  const root = document.createElement("div");
  root.className = "cad-notes-3d-overlay";
  root.setAttribute("aria-label", "3D document notes");
  viewport.append(root);

  const buttons = new Map<string, HTMLButtonElement>();
  let frame = 0;
  let disposed = false;

  const syncDom = (pinned: readonly DocumentNote[], selectedId: string | null) => {
    const activeIds = new Set(pinned.map((n) => n.id));
    for (const [id, btn] of buttons) {
      if (!activeIds.has(id)) {
        btn.remove();
        buttons.delete(id);
      }
    }
    for (const note of pinned) {
      let btn = buttons.get(note.id);
      if (!btn) {
        btn = document.createElement("button");
        btn.type = "button";
        btn.className = "cad-note-3d-pin";
        btn.dataset.viewportNoteId = note.id;
        btn.addEventListener("click", (event) => {
          event.stopPropagation();
          documentNotesBridge.select(note.id);
          options?.onSelect?.(note.id);
        });
        root.append(btn);
        buttons.set(note.id, btn);
      }
      btn.dataset.category = note.category ?? "note";
      btn.dataset.resolved = note.resolved ? "true" : "false";
      btn.dataset.selected = selectedId === note.id ? "true" : "false";
      const preview = note.text.length > 34 ? `${note.text.slice(0, 33)}…` : note.text;
      btn.setAttribute("aria-label", `${(note.category ?? "note").toUpperCase()}: ${note.text}`);
      btn.title = `${note.text}${note.positionMillimeters ? ` (${note.positionMillimeters.map((v) => v.toFixed(1)).join(", ")} mm)` : ""}`;
      const badge = (note.category ?? "note").toUpperCase();
      if (btn.dataset.renderedText !== `${badge}|${preview}`) {
        btn.dataset.renderedText = `${badge}|${preview}`;
        btn.replaceChildren();
        const dot = document.createElement("span");
        dot.className = "cad-note-3d-pin-dot";
        const tag = document.createElement("span");
        tag.className = "cad-note-3d-pin-tag";
        tag.textContent = badge;
        const label = document.createElement("span");
        label.className = "cad-note-3d-pin-text";
        label.textContent = preview;
        btn.append(dot, tag, label);
      }
    }
  };

  const updatePositions = () => {
    const state = documentNotesBridge.viewSnapshot();
    const sketching = viewport.classList.contains("sketching");
    const pinned = !sketching && state.pinsVisible
      ? state.notes.filter((n): n is DocumentNote & { positionMillimeters: [number, number, number] } => Array.isArray(n.positionMillimeters) && n.positionMillimeters.length === 3)
      : [];
    const rect = viewport.getBoundingClientRect();
    const visibleViewport = rect.width > 0 && rect.height > 0;
    root.hidden = pinned.length === 0 || !visibleViewport;
    syncDom(pinned, state.selectedId);
    if (pinned.length > 0 && visibleViewport) {
      let projected: ScreenPoint[] = [];
      window.dispatchEvent(
        new CustomEvent("aether-measure-project", {
          detail: {
            points: pinned.map((n) => n.positionMillimeters),
            respond: (pts: ScreenPoint[]) => {
              projected = pts;
            },
          },
        }),
      );
      pinned.forEach((note, index) => {
        const btn = buttons.get(note.id);
        const screen = projected[index];
        if (!btn) return;
        if (!screen) {
          btn.hidden = true;
          return;
        }
        const localX = screen.x - rect.left;
        const localY = screen.y - rect.top;
        const inView = localX >= -40 && localY >= -40 && localX <= rect.width + 40 && localY <= rect.height + 40;
        btn.hidden = !inView;
        if (inView) {
          btn.style.left = `${Math.max(12, Math.min(rect.width - 12, localX))}px`;
          btn.style.top = `${Math.max(12, Math.min(rect.height - 12, localY))}px`;
        }
      });
    }
  };

  const renderFrame = () => {
    if (disposed) return;
    updatePositions();
    frame = requestAnimationFrame(renderFrame);
  };

  const unsubscribe = documentNotesBridge.subscribe(() => {
    if (!disposed) updatePositions();
  });

  renderFrame();
  return {
    refresh: () => {
      if (!disposed) updatePositions();
    },
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(frame);
      unsubscribe();
      root.remove();
    },
  };
}
