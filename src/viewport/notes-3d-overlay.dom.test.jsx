import { createRequire } from "node:module";
import React, { act } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cadSelection } from "../core/stores/cad-selection-store";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");

let dom;
let mountDocumentNotesOverlay;
let documentNotesBridge;
let DocumentNotesPanel;
let resolveSelected3DAnchor;

beforeAll(async () => {
  dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/cad/index.html",
    pretendToBeVisual: true,
  });
  for (const key of [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "Element",
    "Node",
    "HTMLInputElement",
    "HTMLTextAreaElement",
    "Event",
    "CustomEvent",
    "MouseEvent",
    "KeyboardEvent",
  ]) {
    vi.stubGlobal(key, dom.window[key]);
  }
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

  const overlayMod = await import("./notes-3d-overlay");
  const notesMod = await import("../ui/panels/notes");
  mountDocumentNotesOverlay = overlayMod.mountDocumentNotesOverlay;
  documentNotesBridge = notesMod.documentNotesBridge;
  DocumentNotesPanel = notesMod.DocumentNotesPanel;
  resolveSelected3DAnchor = notesMod.resolveSelected3DAnchor;
});

afterAll(() => {
  dom.window.close();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  documentNotesBridge.bind([]);
  documentNotesBridge.setPinsVisible(true);
  documentNotesBridge.select(null);
  cadSelection.dispatch({ type: "clear" });
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("3D viewport PMI / Document Note pins", () => {
  it("projects pinned notes into the 3D viewport, syncs selection on click, and respects visibility & sketching mode", () => {
    const viewport = document.createElement("section");
    viewport.id = "viewport";
    viewport.className = "viewport";
    viewport.getBoundingClientRect = () => ({ left: 100, top: 50, width: 800, height: 600, right: 900, bottom: 650, x: 100, y: 50, toJSON() {} });
    document.body.append(viewport);

    const onProject = (event) => {
      const { points, respond } = event.detail;
      respond(points.map(([x, y]) => (x < -900 ? null : { x: 100 + x * 4, y: 50 + y * 4 })));
    };
    window.addEventListener("aether-measure-project", onProject);

    const onSelect = vi.fn();
    const handle = mountDocumentNotesOverlay(viewport, { onSelect });

    documentNotesBridge.bind([
      { id: "n1", text: "Deburr 0.5 mm all edges", category: "pmi", resolved: false, positionMillimeters: [25, 30, 10] },
      { id: "n2", text: "General unpinned note", category: "note", resolved: false },
      { id: "n3", text: "Behind camera note", category: "callout", resolved: false, positionMillimeters: [-1000, 0, 0] },
    ]);

    const overlay = viewport.querySelector(".cad-notes-3d-overlay");
    expect(overlay).toBeTruthy();
    expect(overlay.hidden).toBe(false);

    const pins = [...viewport.querySelectorAll(".cad-note-3d-pin")];
    expect(pins).toHaveLength(2);

    const p1 = viewport.querySelector('[data-viewport-note-id="n1"]');
    expect(p1.hidden).toBe(false);
    expect(p1.style.left).toBe("100px");
    expect(p1.style.top).toBe("120px");
    expect(p1.dataset.category).toBe("pmi");

    const p3 = viewport.querySelector('[data-viewport-note-id="n3"]');
    expect(p3.hidden).toBe(true);

    // Click pin -> selects note bidirectionally
    p1.click();
    expect(documentNotesBridge.viewSnapshot().selectedId).toBe("n1");
    expect(p1.dataset.selected).toBe("true");
    expect(onSelect).toHaveBeenCalledWith("n1");

    // Hide pins via bridge toggle
    documentNotesBridge.setPinsVisible(false);
    expect(overlay.hidden).toBe(true);
    expect(viewport.querySelectorAll(".cad-note-3d-pin")).toHaveLength(0);

    // Re-show pins, then enter 2D sketching mode
    documentNotesBridge.setPinsVisible(true);
    expect(viewport.querySelectorAll(".cad-note-3d-pin")).toHaveLength(2);
    viewport.classList.add("sketching");
    handle.refresh();
    expect(overlay.hidden).toBe(true);

    handle.dispose();
    expect(viewport.querySelector(".cad-notes-3d-overlay")).toBeNull();
    window.removeEventListener("aether-measure-project", onProject);
  });

  it("pins notes to the active 3D selection in DocumentNotesPanel and syncs live viewport badges", async () => {
    const viewport = document.createElement("section");
    viewport.className = "viewport";
    viewport.getBoundingClientRect = () => ({ left: 0, top: 0, width: 640, height: 480, right: 640, bottom: 480, x: 0, y: 0, toJSON() {} });
    const panelHost = document.createElement("div");
    document.body.append(viewport, panelHost);

    const onProject = (event) => {
      event.detail.respond(event.detail.points.map(([x, y]) => ({ x: 100 + x, y: 100 + y })));
    };
    const onFrame = (event) => {
      event.detail.respond({ origin: [12.5, 24.75, 6.25] });
    };
    window.addEventListener("aether-measure-project", onProject);
    window.addEventListener("aether-measure-frame", onFrame);

    cadSelection.dispatch({
      type: "replace",
      items: [
        {
          id: "face:body-1:0",
          kind: "face",
          partId: "body-1",
          label: "Top face",
        },
      ],
    });
    expect(resolveSelected3DAnchor()).toEqual({
      positionMillimeters: [12.5, 24.75, 6.25],
      targetBodyId: "body-1",
    });

    const persisted = [];
    documentNotesBridge.bind([], (next) => {
      persisted.push(next);
    });
    const overlayHandle = mountDocumentNotesOverlay(viewport);

    const { createRoot } = await import("react-dom/client");
    const root = createRoot(panelHost);
    await act(async () => root.render(<DocumentNotesPanel />));

    // Click "Pin to 3D selection"
    const pinSelectionBtn = [...panelHost.querySelectorAll("button")].find((b) => b.textContent === "Pin to 3D selection");
    expect(pinSelectionBtn).toBeTruthy();
    await act(async () => pinSelectionBtn.click());

    const anchorInput = panelHost.querySelector("#doc-note-anchor");
    expect(anchorInput.value).toBe("12.50, 24.75, 6.25");

    // Fill note text and add it
    const textarea = panelHost.querySelector("textarea");
    const setNativeValue = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value").set;
    await act(async () => {
      setNativeValue.call(textarea, "Check boss clearance");
      textarea.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    const addBtn = [...panelHost.querySelectorAll("button")].find((b) => b.textContent === "Add note");
    await act(async () => addBtn.click());

    expect(persisted).toHaveLength(1);
    expect(persisted[0][0].positionMillimeters).toEqual([12.5, 24.75, 6.25]);
    expect(persisted[0][0].targetBodyId).toBe("body-1");
    expect(viewport.querySelectorAll(".cad-note-3d-pin")).toHaveLength(1);

    // Unpin the saved note -> removes 3D pin while keeping note in panel
    const unpinBtn = [...panelHost.querySelectorAll("button")].find((b) => b.textContent === "Unpin");
    expect(unpinBtn).toBeTruthy();
    await act(async () => unpinBtn.click());
    expect(viewport.querySelectorAll(".cad-note-3d-pin")).toHaveLength(0);
    expect(panelHost.querySelectorAll(".cad-inspector-card")).toHaveLength(1);

    // Re-pin to active 3D selection -> restores 3D pin
    const repinBtn = [...panelHost.querySelectorAll("button")].find((b) => b.textContent === "Pin to 3D");
    expect(repinBtn).toBeTruthy();
    await act(async () => repinBtn.click());
    expect(viewport.querySelectorAll(".cad-note-3d-pin")).toHaveLength(1);

    await act(async () => root.unmount());
    overlayHandle.dispose();
    window.removeEventListener("aether-measure-project", onProject);
    window.removeEventListener("aether-measure-frame", onFrame);
  });
});
