import { createRequire } from "node:module";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createEmptyPartDocument, insertFeature } from "@aether/core/document";

// Characterization test for the feature dialogs. feature-authoring.ts carries
// every feature's controls, layout and serialization in three parallel
// if/else chains, with no direct test. This pins what each dialog SUBMITS so
// the per-feature split is provably behaviour-preserving — it asserts the
// payload handed to apply(), not the internal structure that is being moved.
const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");

let dom, mountFeatureAuthoring, cadCommands, doc, apply;
let authoringActionListeners = [];
const unmountAuthoring = () => {
  for (const listener of authoringActionListeners) window.removeEventListener('aether-feature-action', listener);
  authoringActionListeners = [];
};

beforeAll(async () => {
  dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/cad/index.html",
  });
  for (const key of ["window", "document", "HTMLElement", "CustomEvent", "Event", "location", "crypto"])
    vi.stubGlobal(key, dom.window[key]);
  vi.stubGlobal("confirm", () => true);
  const mount = (await import("./feature-authoring")).mountFeatureAuthoring;
  // The production shell mounts once. Keep each fixture equally isolated;
  // accumulated app listeners otherwise create dozens of dialogs per edit.
  mountFeatureAuthoring = (...args) => {
    unmountAuthoring();
    const original = window.addEventListener;
    window.addEventListener = function (type, listener, options) {
      if (type === 'aether-feature-action') authoringActionListeners.push(listener);
      return original.call(this, type, listener, options);
    };
    try { return mount(...args); }
    finally { window.addEventListener = original; }
  };
  cadCommands = (await import("./cad-command-registry")).cadCommands;
});
afterAll(async () => {
  // Let disconnected dialog observers detach before removing the DOM globals.
  document.body.replaceChildren();
  unmountAuthoring();
  await new Promise(resolve => setTimeout(resolve, 0));
  dom.window.close();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  unmountAuthoring();
  document.body.innerHTML = '<div class="cad-studio-viewport"></div>';
  doc = createEmptyPartDocument("Part");
  apply = vi.fn(async (next) => {
    doc = next;
  });
  mountFeatureAuthoring(() => doc, (next) => apply(next));
});

/** Seed a profile directly. The `profile` dialog branch in feature-authoring.ts
 * is unreachable — show() routes "profile" to the sketch workspace before any
 * form is built — so extrude/revolve/mirror are exercised against a seeded
 * document rather than a dialog that cannot open. */
const seedProfile = () => {
  doc = insertFeature(doc, {
    id: "profile-1",
    type: "profile",
    name: "Sketch 1",
    plane: "XY",
    offsetMillimeters: 0,
    suppressed: false,
    profile: { type: "circle", radiusMillimeters: 10, centerMillimeters: [0, 0] },
  });
};

const seedConnectedProfile = () => {
  const points = [[20, 20], [80, 20], [80, 50], [20, 50]];
  doc = insertFeature(doc, { id: 'joined', type: 'profile', name: 'Joined sketch', plane: 'XY', offsetMillimeters: 0, suppressed: false,
    profile: { type: 'drawing', contours: points.map((start, i) => ({ type: 'path', start, segments: [{ type: 'line', end: points[(i + 1) % 4] }] })) } });
};

/** Open a feature dialog, set the named controls, commit, return the feature. */
const authored = async (type, values = {}) => {
  mountFeatureAuthoring(() => doc, apply);
  cadCommands.execute(`feature-${type}`);
  // Target the newest dialog: authoring several features in one test leaves
  // earlier panels in the DOM, and querySelector would return the stale one.
  const form = [...document.querySelectorAll("form")].at(-1);
  expect(form, `no dialog opened for ${type}`).toBeTruthy();
  // presentFeatureWindow moves each control out of the <form> into a window
  // row, keeping it associated by the `form` attribute — so search the panel.
  const panel = [...document.querySelectorAll(".cad-feature-dialog")].at(-1);
  for (const [label, value] of Object.entries(values)) {
    // Exact caption first. Only fall back to a unit-suffixed match, because
    // field() rewrites "(mm)"/"(degrees)" to the document's configured unit —
    // a bare prefix match would hit "Features to mirror" when asked for
    // "Feature".
    const control =
      panel.querySelector(`[aria-label="${label}"]`) ??
      panel.querySelector(`[aria-label^="${label} ("]`);
    expect(control, `${type}: no control labelled ${label}`).toBeTruthy();
    if (control.type === "checkbox") control.checked = value === "true";
    else control.value = value;
    control.dispatchEvent(new dom.window.Event("change"));
  }
  const before = apply.mock.calls.length;
  form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  // Wait for THIS commit, not any earlier one, or a blocked submit silently
  // returns the previously authored feature.
  await vi.waitFor(() => {
    if (apply.mock.calls.length <= before) {
      const why = [...panel.querySelectorAll('.aui-feature-error,[role="alert"]')]
        .map((e) => e.textContent).filter(Boolean).join(" | ");
      throw new Error(`${type} did not commit${why ? `: ${why}` : " (no message shown)"}`);
    }
  });
  const committed = apply.mock.calls.at(-1)[0].features.at(-1);
  // Dismiss the committed dialog so the next one is unambiguous.
  for (const cancel of document.querySelectorAll('[aria-label="Cancel"]')) cancel.click();
  return committed;
};

// The feature tree can select several features; suppress and delete must act on
// that whole set, in one undoable commit, not just the clicked row.
// Mount once: every mount adds a window listener for the whole file's lifetime,
// and a second listener re-handles the same event against the document the
// first one just committed (suppress would toggle straight back).
let treeMounted = false;
const treeAction = (actionID, clicked, selectedFeatureIDs) => {
  if (!treeMounted) {
    mountFeatureAuthoring(() => doc, (next) => apply(next));
    treeMounted = true;
  }
  window.dispatchEvent(new dom.window.CustomEvent("aether-feature-action", {
    detail: { type: "item-action", id: `feature/profile/${clicked}`, actionID, selectedFeatureIDs },
  }));
};

const seedTwoProfiles = () => {
  for (const id of ["profile-1", "profile-2"])
    doc = insertFeature(doc, {
      id, type: "profile", name: id, plane: "XY", offsetMillimeters: 0, suppressed: false,
      profile: { type: "circle", radiusMillimeters: 10, centerMillimeters: [0, 0] },
    });
};

it("deletes every selected feature in one commit", async () => {
  seedTwoProfiles();
  treeAction("delete-feature", "profile-1", ["profile-1", "profile-2"]);
  await vi.waitFor(() => expect(apply).toHaveBeenCalled());
  expect(apply).toHaveBeenCalledTimes(1);
  expect(doc.features).toHaveLength(0);
});

it("suppresses every selected feature, and leaves unselected features alone", async () => {
  seedTwoProfiles();
  treeAction("suppress-feature", "profile-1", ["profile-1"]);
  await vi.waitFor(() => expect(apply).toHaveBeenCalled());
  expect(doc.features.map((f) => f.suppressed)).toEqual([true, false]);
});

it("acts on the clicked row alone when it is outside the selection", async () => {
  seedTwoProfiles();
  treeAction("delete-feature", "profile-2", ["profile-1"]);
  await vi.waitFor(() => expect(apply).toHaveBeenCalled());
  expect(doc.features.map((f) => f.id)).toEqual(["profile-1"]);
});

it("routes profile to the sketch workspace instead of building a form", () => {
  mountFeatureAuthoring(() => doc, apply);
  cadCommands.execute("feature-profile");
  // The profile form branches in feature-authoring.ts are dead code.
  expect(document.querySelector("form")).toBeNull();
  expect(document.querySelector(".cad-sketch-workspace")).toBeTruthy();
});

it("serializes extrude with its distance and operation", async () => {
  seedProfile();
  const feature = await authored("extrude", { Sketch: "profile-1", "Distance": "25" });
  expect(feature).toMatchObject({ type: "extrude", distanceMillimeters: 25, operation: "new" });
  expect(feature.profileFeatureId).toBe("profile-1");
  expect(feature.suppressed).toBe(false);
  expect(feature.id).toBeTruthy();
});

it('carries an explicitly selected single-region sketch into Extrude without choosing the last sketch',async()=>{
  const {cadWorkspace}=await import('./cad-workspace-store');
  const original=cadWorkspace.snapshot();
  seedProfile();
  doc=insertFeature(doc,{id:'later',type:'profile',name:'Later sketch',plane:'XY',offsetMillimeters:20,suppressed:false,profile:{type:'circle',radiusMillimeters:3,centerMillimeters:[0,0]}});
  try {
    cadWorkspace.publish({...original,selectedItemIDs:new Set(['feature/profile/profile-1'])});
    mountFeatureAuthoring(()=>doc,apply);cadCommands.execute('feature-extrude');
    await vi.waitFor(()=>expect(document.querySelector('.cad-feature-dialog').textContent).toContain('Face 1 of Sketch 1'));
    document.querySelector('.cad-feature-dialog form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    await vi.waitFor(()=>expect(apply).toHaveBeenCalled());
    expect(doc.features.at(-1)).toMatchObject({type:'extrude',profileFeatureId:'profile-1'});
  } finally {cadWorkspace.publish(original);}
});

it('requires an explicit face when the selected sketch has multiple regions',async()=>{
  const {cadWorkspace}=await import('./cad-workspace-store');
  const original=cadWorkspace.snapshot();
  doc=insertFeature(doc,{id:'multi',type:'profile',name:'Two regions',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'drawing',contours:[{id:'one',type:'circle',center:[0,0],radius:2},{id:'two',type:'circle',center:[10,0],radius:2}]}});
  try {
    cadWorkspace.publish({...original,selectedItemIDs:new Set(['feature/profile/multi'])});
    mountFeatureAuthoring(()=>doc,apply);cadCommands.execute('feature-extrude');
    await new Promise(resolve=>queueMicrotask(resolve));
    expect(document.querySelector('[aria-label="Selected profiles"]').value).toBe('[]');
    expect(document.querySelector('.cad-feature-dialog').textContent).toContain('Select a sketch face.');
    expect(apply).not.toHaveBeenCalled();
  } finally {cadWorkspace.publish(original);}
});

it("serializes revolve with axis and angle", async () => {
  seedProfile();
  const feature = await authored("revolve", {
    Sketch: "profile-1",
    Axis: "Y",
    "Angle": "180",
  });
  expect(feature).toMatchObject({
    type: "revolve",
    axis: "Y",
    angleDegrees: 180,
    profileFeatureId: "profile-1",
  });
});

it("serializes mirror against its source feature and plane", async () => {
  seedProfile();
  // Seeded rather than authored: this test is about mirror's serialization, and
  // a stable id keeps it independent of how extrude happens to be committed.
  doc = insertFeature(doc, {
    id: "extrude-1",
    type: "extrude",
    name: "Extrude 1",
    suppressed: false,
    profileFeatureId: "profile-1",
    operation: "new",
    distanceMillimeters: 5,
  });
  const feature = await authored("mirror", { Feature: "extrude-1", "Mirror plane": "XZ" });
  expect(feature).toMatchObject({ type: "mirror", plane: "XZ", operation: "add" });
  expect(feature.sourceFeatureId).toBe("extrude-1");
});

it("serializes edge finishes, including the optional edge-plane scope", async () => {
  seedProfile();
  await authored("extrude", { Sketch: "profile-1", "Distance": "5" });
  const all = await authored("fillet", { "All-edge size": "2" });
  expect(all).toMatchObject({ type: "fillet", radiusMillimeters: 2 });
  expect(all.edgePlane).toBeUndefined();

  const scoped = await authored("chamfer", {
    "All-edge size": "1.5",
    Edges: "plane",
    "Edge plane": "YZ",
    "Edge plane offset": "3",
  });
  expect(scoped).toMatchObject({
    type: "chamfer",
    radiusMillimeters: 1.5,
    edgePlane: { plane: "YZ", offsetMillimeters: 3 },
  });
});

it("gives extrude the gallery anatomy: body/operation tabs and an entities box", () => {
  seedProfile();
  mountFeatureAuthoring(() => doc, apply);
  cadCommands.execute("feature-extrude");
  const panel = document.querySelector(".cad-feature-dialog");
  const tabRows = panel.querySelectorAll(".aui-feature-tabs");
  expect(tabRows.length).toBe(2);
  expect([...tabRows[0].children].map((t) => t.textContent)).toEqual(["Solid", "Surface", "Thin"]);
  expect([...tabRows[1].children].map((t) => t.textContent)).toEqual([
    "New",
    "Add",
    "Remove",
    "Intersect",
  ]);
  // Unimplemented options are visibly disabled rather than quietly missing.
  expect(tabRows[0].children[1].disabled).toBe(true);
  expect(tabRows[0].children[2].disabled).toBe(false);
  expect([...tabRows[1].children][3].disabled).toBe(false);
  expect(panel.textContent).toContain("Faces and sketch regions to extrude");
});

// The gallery is the design authority: the app's extrude must offer the same
// controls in the same order, not a reduced set. Controls the engine cannot
// honour yet stay visible and disabled rather than being dropped.
it("reproduces the gallery extrude layout control-for-control", () => {
  seedProfile();
  mountFeatureAuthoring(() => doc, apply);
  cadCommands.execute("feature-extrude");
  const panel = document.querySelector(".cad-feature-dialog");

  const endType = panel.querySelector('[aria-label="End type"]');
  expect(endType, "end type is a picker, as in the gallery").toBeTruthy();

  expect(panel.textContent).toContain("Depth");
  expect(panel.textContent).toContain("Up to next");
  for (const section of ["Draft", "Direction", "Starting offset", "Opposite depth"])
    expect(panel.textContent, `missing sub-setting: ${section}`).toContain(section);
  expect(panel.querySelector('[aria-label="Direction reference"]')).toBeTruthy();
  expect(panel.querySelector('[aria-label="Opposite depth (mm)"]')).toBeTruthy();
  expect(panel.querySelectorAll(".aui-feature-subsection").length).toBe(5);

  // Depth is the one end-type option this engine evaluates, so it is live.
  const depth = panel.querySelector('[aria-label^="Distance"]');
  expect(depth.disabled).toBeFalsy();
});

// Every feature window follows the plane window's discipline: nothing is
// pre-selected, the requirement is stated live, and the accept control stays
// disabled until it is met — an invalid feature is never submittable.
it("refuses to commit a feature until its required selections are made", async () => {
  seedProfile();
  mountFeatureAuthoring(() => doc, apply);
  cadCommands.execute("feature-extrude");
  const panel = document.querySelector(".cad-feature-dialog");
  const accept = panel.querySelector('[aria-label="Apply and rebuild"]');
  const error = () => panel.querySelector(".aui-feature-error")?.textContent ?? "";

  // Nothing pre-selected, so the sketch reference is missing.
  expect(panel.querySelector(".aui-feature-entity")).toBeNull();
  expect(error()).toContain("sketch face");
  expect(accept.disabled).toBe(true);

  const source = panel.querySelector('[aria-label="Sketch"]');
  source.value = "profile-1";
  source.dispatchEvent(new dom.window.Event("change"));
  expect(error()).toBe("");
  expect(accept.disabled).toBe(false);

  // Clearing it puts the window straight back into the invalid state.
  source.value = "";
  source.dispatchEvent(new dom.window.Event("change"));
  expect(accept.disabled).toBe(true);
});

it("states every missing selection at once", async () => {
  seedProfile();
  mountFeatureAuthoring(() => doc, apply);
  cadCommands.execute("feature-mirror");
  const panel = document.querySelector(".cad-feature-dialog");
  // Mirror needs a source feature; the plane defaults to YZ, so only one is
  // outstanding and the message names exactly that one.
  expect(panel.querySelector(".aui-feature-error").textContent).toContain("feature to mirror");
  expect(panel.querySelector('[aria-label="Apply and rebuild"]').disabled).toBe(true);
});

/** Jonathan's part: one sketch holding separate regions. Extrude must be able
 *  to build one of them, which needs the dialog to offer the choice at all. */
const seedMultiRegionSketch = () => {
  doc = insertFeature(doc, {
    id: "profile-1",
    type: "profile",
    name: "Sketch 1",
    plane: "XY",
    offsetMillimeters: 0,
    suppressed: false,
    profile: {
      type: "drawing",
      contours: [
        {
          type: "path",
          start: [0, 0],
          segments: [
            { type: "line", end: [10, 0] },
            { type: "line", end: [5, 8] },
            { type: "line", end: [0, 0] },
          ],
        },
        { type: "circle", center: [50, 5], radius: 4 },
      ],
    },
  });
};

it("offers each region of a multi-region sketch, and extrudes the chosen one", async () => {
  seedMultiRegionSketch();
  mountFeatureAuthoring(() => doc, apply);
  cadCommands.execute("feature-extrude");
  const panel = [...document.querySelectorAll(".cad-feature-dialog")].at(-1);
  const region = panel.querySelector('[aria-label="Region"]');
  expect(region, "extrude dialog has no region picker").toBeTruthy();

  // Whole-sketch selection adds its faces; individual picks can refine it.
  const source = panel.querySelector('[aria-label="Sketch"]');
  source.value = "profile-1";
  source.dispatchEvent(new dom.window.Event("change"));
  expect([...region.options].map((o) => o.textContent)).toEqual([
    "Face 1",
    "Face 2",
  ]);
  expect(panel.querySelectorAll(".aui-feature-entity")).toHaveLength(2);

  // Selecting a whole sketch explicitly selects all its faces.
  const error = () => panel.querySelector(".aui-feature-error")?.textContent ?? "";
  expect(error()).toBe("");

  region.value = "1";
  region.dispatchEvent(new dom.window.Event("change"));
  expect(error()).toBe("");

  const form = [...document.querySelectorAll("form")].at(-1);
  form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(apply).toHaveBeenCalled());
  const committed = apply.mock.calls.at(-1)[0];
  const extrude = committed.features.at(-1);
  expect(extrude.type).toBe("extrude");
  expect(extrude.profileFeatureId).toBe("profile-1");
  // The picked contour was given an id on the very document being committed,
  // so the reference survives reordering rather than being an index.
  const contour = committed.features[0].profile.contours[1];
  expect(extrude.profileContourId).toBe(contour.id);
  expect(typeof contour.id).toBe("string");
});

it("keeps a single-region sketch free of a region choice", async () => {
  seedProfile();
  mountFeatureAuthoring(() => doc, apply);
  cadCommands.execute("feature-extrude");
  const panel = [...document.querySelectorAll(".cad-feature-dialog")].at(-1);
  const source = panel.querySelector('[aria-label="Sketch"]');
  source.value = "profile-1";
  source.dispatchEvent(new dom.window.Event("change"));
  // One region needs no choosing, so the row stays out of the way and the
  // committed feature records no contour — documents already saved keep working.
  expect(panel.querySelectorAll(".aui-feature-entity")).toHaveLength(1);
  const form = [...document.querySelectorAll("form")].at(-1);
  form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(apply).toHaveBeenCalled());
  const saved = apply.mock.calls.at(-1)[0];
  expect(saved.features.at(-1).profileSelections).toEqual([{profileFeatureId:"profile-1",profileContourId:saved.features[0].profile.contours[0].id}]);
});

it("accepts a viewport region pick and saves its stable contour identity", async () => {
  seedMultiRegionSketch();
  mountFeatureAuthoring(() => doc, apply);
  cadCommands.execute("feature-extrude");
  const panel = [...document.querySelectorAll(".cad-feature-dialog")].at(-1);
  window.dispatchEvent(new dom.window.CustomEvent("aether-region-picked", { detail: { featureId: "profile-1", contourIndex: 1 } }));
  expect(panel.querySelector('[aria-label="Sketch"]').value).toBe("profile-1");
  expect(panel.querySelector('[aria-label="Region"]').value).toBe("1");
  panel.querySelector("form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(apply).toHaveBeenCalled());
  expect(doc.features.at(-1).profileContourId).toBe(doc.features[0].profile.contours[1].id);
});

it("retains a region handed over from the sketch after the feature dialog mounts", async () => {
  seedMultiRegionSketch();
  const { setPickedSketchRegion, takePickedSketchRegion } = await import("./sketch-region-selection");
  setPickedSketchRegion({ featureId: "profile-1", contourIndex: 1 });
  mountFeatureAuthoring(() => doc, apply);
  cadCommands.execute("feature-extrude");
  await Promise.resolve();
  const panel = [...document.querySelectorAll(".cad-feature-dialog")].at(-1);
  expect(panel.querySelector('[aria-label="Sketch"]').value).toBe("profile-1");
  expect(panel.querySelector('[aria-label="Region"]').value).toBe("1");
  expect(panel.querySelector('[aria-label="Apply and rebuild"]').disabled).toBe(false);
  expect(takePickedSketchRegion()).toBeNull();
});

it('selects every handed-over sketch region, permits removing one and persists the chosen identities', async () => {
  seedMultiRegionSketch();
  const {setPickedSketchRegion,takePickedSketchRegion}=await import('./sketch-region-selection');
  setPickedSketchRegion({featureId:'profile-1',contourIndex:0,contourIndices:[0,1]});
  mountFeatureAuthoring(()=>doc,apply);cadCommands.execute('feature-extrude');await Promise.resolve();
  const panel=document.querySelector('.cad-feature-dialog');
  expect(JSON.parse(panel.querySelector('[aria-label="Selected profiles"]').value)).toEqual([{featureId:'profile-1',contourIndex:0},{featureId:'profile-1',contourIndex:1}]);
  expect(panel.querySelector('[aria-label="Apply and rebuild"]').disabled).toBe(false);
  expect(takePickedSketchRegion()).toBeNull();
  window.dispatchEvent(new CustomEvent('aether-region-picked',{detail:{featureId:'profile-1',contourIndex:0}}));
  panel.querySelector('form').requestSubmit();await vi.waitFor(()=>expect(apply).toHaveBeenCalledOnce());
  expect(doc.features.at(-1).profileSelections).toEqual([{profileFeatureId:'profile-1',profileContourId:doc.features[0].profile.contours[1].id}]);
});

it('does not silently narrow a multi-region handoff in a single-region feature', async () => {
  seedMultiRegionSketch();
  const {setPickedSketchRegion}=await import('./sketch-region-selection');
  setPickedSketchRegion({featureId:'profile-1',contourIndex:0,contourIndices:[0,1]});
  mountFeatureAuthoring(()=>doc,apply);cadCommands.execute('feature-revolve');await Promise.resolve();
  const panel=document.querySelector('.cad-feature-dialog');
  expect(panel.querySelector('[aria-label="Apply and rebuild"]').disabled).toBe(true);
  expect(panel.querySelector('[aria-label="Region"]').value).toBe('');
});

it("clearing the selected sketch chip immediately disables Apply", () => {
  seedProfile(); mountFeatureAuthoring(() => doc, apply); cadCommands.execute("feature-extrude");
  const panel = [...document.querySelectorAll(".cad-feature-dialog")].at(-1);
  const source = panel.querySelector('[aria-label="Sketch"]');
  source.value = "profile-1"; source.dispatchEvent(new Event("change"));
  panel.querySelector(".aui-feature-entity button").click();
  expect(JSON.parse(panel.querySelector('[aria-label="Selected profiles"]').value)).toEqual([]);
  expect(panel.querySelector('[aria-label="Apply and rebuild"]').disabled).toBe(true);
});

it("does not submit an incomplete feature via native Enter/form submission", async () => {
  seedMultiRegionSketch(); mountFeatureAuthoring(() => doc, apply); cadCommands.execute("feature-extrude");
  const panel = [...document.querySelectorAll(".cad-feature-dialog")].at(-1);
  panel.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await Promise.resolve();
  expect(apply).not.toHaveBeenCalled();
});

it("authors a new sweep body from a circle and an open path", async () => {
  seedProfile();
  doc = insertFeature(doc, { id: "path", type: "profile", name: "Path", plane: "XZ", offsetMillimeters: 0, suppressed: false,
    profile: { type: "drawing", contours: [{ type: "path", start: [0, 0], segments: [{ type: "line", end: [0, 20] }] }] } });
  const sweep = await authored("sweep", { "Sketch Profile": "profile-1", "Sweep Path": "path" });
  expect(sweep).toMatchObject({ type: "sweep", operation: "new", pathFeatureId: "path" });
  expect(sweep.bodyId).toBeTruthy();
});

it("previews the selected region without committing and submits the same geometry definition", async () => {
  seedMultiRegionSketch();
  const { configureFeaturePreview } = await import("./modeling/feature-preview");
  const evaluate = vi.fn().mockResolvedValue({ parts: [], sourceName: "Preview", parseMilliseconds: 1 });
  const show = vi.fn(); configureFeaturePreview({ evaluate, show });
  try {
    mountFeatureAuthoring(() => doc, apply); cadCommands.execute("feature-extrude");
    const panel = [...document.querySelectorAll(".cad-feature-dialog")].at(-1);
    window.dispatchEvent(new CustomEvent("aether-region-picked", { detail: { featureId: "profile-1", contourIndex: 1 } }));
    await vi.waitFor(() => expect(evaluate).toHaveBeenCalled());
    expect(apply).not.toHaveBeenCalled();
    expect(doc.features).toHaveLength(1);
    expect(panel.querySelector(".aui-feature-entity").textContent).toContain("Face 2 of Sketch 1");
    expect(panel.textContent).not.toContain("closed regions selected");
    const candidate = evaluate.mock.calls.at(-1)[0];
    panel.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(apply).toHaveBeenCalled());
    expect(apply.mock.calls.at(-1)[0]).toEqual(candidate);
    await vi.waitFor(() => expect(show).toHaveBeenLastCalledWith(null));
  } finally { configureFeaturePreview(null); }
});

it("disables Apply for a failed native preview and recovers after changing the parameters", async () => {
  seedProfile();
  const { configureFeaturePreview } = await import("./modeling/feature-preview");
  const evaluate = vi.fn().mockRejectedValueOnce(new Error("Native preview failed")).mockResolvedValue({ parts: [], sourceName: "Preview", parseMilliseconds: 1 });
  configureFeaturePreview({ evaluate, show: vi.fn() });
  try {
    mountFeatureAuthoring(() => doc, apply); cadCommands.execute("feature-extrude");
    const panel = [...document.querySelectorAll(".cad-feature-dialog")].at(-1);
    const source = panel.querySelector('[aria-label="Sketch"]'); source.value = "profile-1"; source.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(panel.textContent).toContain("Native preview failed"));
    expect(panel.querySelector('[aria-label="Apply and rebuild"]').disabled).toBe(true);
    const depth = panel.querySelector('[aria-label="Distance (mm)"]'); depth.value = "4"; depth.dispatchEvent(new Event("input"));
    await vi.waitFor(() => expect(panel.querySelector('[aria-label="Apply and rebuild"]').disabled).toBe(false));
    expect(panel.textContent).not.toContain("Preview · not saved");
    expect(panel.querySelector('[aria-label="Apply and rebuild"]').disabled).toBe(false);
    expect(apply).not.toHaveBeenCalled();
    panel.remove(); await Promise.resolve();
  } finally { configureFeaturePreview(null); }
});


it("saves several selected regions and preserves their identities after reordering", async () => {
  seedMultiRegionSketch();
  mountFeatureAuthoring(() => doc, apply);
  cadCommands.execute("feature-extrude");
  const panel = [...document.querySelectorAll(".cad-feature-dialog")].at(-1);
  const source = panel.querySelector('[aria-label="Sketch"]');
  source.value = "profile-1"; source.dispatchEvent(new dom.window.Event("change"));
  const region = panel.querySelector('[aria-label="Region"]');
  expect(region.multiple).toBe(true);
  for (const option of region.options) option.selected = true;
  region.dispatchEvent(new dom.window.Event("change"));
  expect(panel.querySelectorAll(".aui-feature-entity")).toHaveLength(2);
  panel.querySelector("form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(apply).toHaveBeenCalled());
  const saved = apply.mock.calls.at(-1)[0];
  expect(saved.features.at(-1).regionMode).toBe("faces");
  expect(saved.features.at(-1).profileSelections.map(p=>p.profileContourId)).toEqual(saved.features[0].profile.contours.map(c => c.id));
  saved.features[0].profile.contours.reverse();
  const { translateDocument } = await import("./freecad-translate");
  const translated = translateDocument(saved);
  expect(translated.complete).toBe(true);
  expect(translated.features.at(-1).parameters.profile_groups[0].profiles).toEqual(["profile-1#1", "profile-1#0"]);
});

it("renames a saved STEP feature without losing its original source", async () => {
  doc = insertFeature(doc, { id: "import", type: "import-step", name: "Import bracket", suppressed: false, operation: "new", bodyId: "imported-body", sourceName: "bracket.step", dataBase64: "U1RFUA==" });
  mountFeatureAuthoring(() => doc, apply);
  window.dispatchEvent(new dom.window.CustomEvent("aether-feature-action", { detail: { type: "item-action", actionID: "edit-feature", id: "feature/doc/import" } }));
  const panel = [...document.querySelectorAll(".cad-feature-dialog")].at(-1);
  expect(panel.querySelector('[aria-label="Source STEP"]').readOnly).toBe(true);
  panel.querySelector('[aria-label="Name"]').value = "Reference bracket";
  panel.querySelector("form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(apply).toHaveBeenCalled());
  expect(apply.mock.calls.at(-1)[0].features[0]).toMatchObject({ name: "Reference bracket", dataBase64: "U1RFUA==", sourceName: "bracket.step", bodyId: "imported-body", operation: "new" });
});

it("keeps an automatically selected sole region when handed over from sketching", async () => {
  seedProfile();
  const { setPickedSketchRegion } = await import("./sketch-region-selection");
  setPickedSketchRegion({ featureId: "profile-1", contourIndex: 0 });
  mountFeatureAuthoring(() => doc, apply);
  cadCommands.execute("feature-extrude");
  await Promise.resolve();
  const panel = [...document.querySelectorAll(".cad-feature-dialog")].at(-1);
  expect(panel.querySelector('[aria-label="Region"]').value).toBe("0");
  expect(panel.querySelector('[aria-label="Apply and rebuild"]').disabled).toBe(false);
});

it("saves symmetric extrusion, offset and opposite-depth settings", async () => {
  seedProfile();
  const symmetric = await authored("extrude", { Sketch: "profile-1", "End condition": "symmetric", "Distance (mm)": "20", "Starting offset enabled":"true", "Starting offset (mm)": "3" });
  expect(symmetric).toMatchObject({endType:"symmetric",distanceMillimeters:20,startingOffsetMillimeters:3});
  expect(symmetric.secondDistanceMillimeters).toBeUndefined();
});

it("opens Cut directly in Remove mode and persists target-derived through-all", async () => {
  seedProfile();
  await authored("extrude", { Sketch: "profile-1" });
  cadCommands.execute("feature-cut");
  const panel = [...document.querySelectorAll(".cad-feature-dialog")].at(-1);
  expect(panel.querySelector('[aria-label="Operation"]').value).toBe("cut");
  for (const [label,value] of [["Sketch","profile-1"],["End condition","through-all"]]) {
    const control=panel.querySelector(`[aria-label="${label}"]`);control.value=value;control.dispatchEvent(new dom.window.Event("change"));
  }
  panel.querySelector("form").dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true}));
  await vi.waitFor(()=>expect(doc.features.at(-1).endType).toBe("through-all"));
  expect(doc.features.at(-1).operation).toBe("cut");
});

it("stores the opposite blind depth and signed starting offset in canonical units", async () => {
  seedProfile();
  const feature=await authored("extrude", { Sketch:"profile-1", "Use second end":"true", "Opposite depth (mm)":"4", "Starting offset enabled":"true", "Starting offset (mm)":"-2" });
  expect(feature).toMatchObject({endType:"blind",secondEnd:{endType:"blind",distanceMillimeters:4},startingOffsetMillimeters:-2});
  const { translateDocument }=await import("./freecad-translate");
  expect(translateDocument(doc).features.at(-1).parameters).toMatchObject({second_end:{end_type:"blind",distance_mm:4},starting_offset_mm:-2,end_type:"blind"});
});


it("accumulates faces across sketches, removes one chip, and preserves the selection on reopen", async () => {
  seedMultiRegionSketch();
  doc=insertFeature(doc,{id:"second",type:"profile",name:"Sketch 2",plane:"XY",offsetMillimeters:20,suppressed:false,profile:{type:"circle",radiusMillimeters:3,centerMillimeters:[80,0]}});
  mountFeatureAuthoring(()=>doc,apply);cadCommands.execute("feature-extrude");
  let panel=[...document.querySelectorAll(".cad-feature-dialog")].at(-1);
  expect(panel.querySelector('[aria-label="Add sketch or face"]')).toBeNull();
  for (const contourIndex of [0,1]) window.dispatchEvent(new CustomEvent("aether-region-picked",{detail:{featureId:"profile-1",contourIndex}}));
  window.dispatchEvent(new CustomEvent("aether-region-picked",{detail:{featureId:"second",contourIndex:0}}));
  expect([...panel.querySelectorAll(".aui-feature-entity span")].map(e=>e.textContent)).toEqual(["Face 1 of Sketch 1","Face 2 of Sketch 1","Face 1 of Sketch 2"]);
  panel.querySelector('[aria-label="Remove Face 2 of Sketch 1"]').click();
  panel.querySelector("form").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));
  await vi.waitFor(()=>expect(apply).toHaveBeenCalled());
  const feature=doc.features.at(-1);
  expect(feature.profileSelections.map(p=>p.profileFeatureId)).toEqual(["profile-1","second"]);
  const {translateDocument}=await import("./freecad-translate");
  expect(translateDocument(doc).features.at(-1).parameters.profile_groups.map(g=>g.profiles)).toEqual([["profile-1#0"],["second"]]);
  window.dispatchEvent(new CustomEvent("aether-feature-action",{detail:{type:"item-action",actionID:"edit-feature",id:`feature/doc/${feature.id}`}}));
  panel=[...document.querySelectorAll(".cad-feature-dialog")].at(-1);
  expect([...panel.querySelectorAll(".aui-feature-entity span")].map(e=>e.textContent)).toEqual(["Face 1 of Sketch 1","Face 1 of Sketch 2"]);
  expect(panel.querySelector('[aria-label="Name"]').hidden).toBe(true);
  for(const text of ["Move earlier","Move later","Delete feature","Preview · not saved"])expect(panel.textContent).not.toContain(text);
});

it("previews an edited feature at its history position but commits the complete future history", async () => {
  seedProfile();
  const extrude=await authored("extrude",{Sketch:"profile-1"});
  doc=insertFeature(doc,{id:"later",type:"fillet",name:"Later fillet",radiusMillimeters:1,suppressed:false});
  const {configureFeaturePreview}=await import("./modeling/feature-preview");
  const evaluate=vi.fn().mockResolvedValue({parts:[],sourceName:"Preview",parseMilliseconds:0});
  configureFeaturePreview({evaluate,show:vi.fn()});
  try {
    window.dispatchEvent(new CustomEvent("aether-feature-action",{detail:{type:"item-action",actionID:"edit-feature",id:`feature/doc/${extrude.id}`}}));
    const panel=[...document.querySelectorAll(".cad-feature-dialog")].at(-1);
    const depth=panel.querySelector('[aria-label="Distance (mm)"]');depth.value="25";depth.dispatchEvent(new Event("change"));
    await vi.waitFor(()=>expect(evaluate).toHaveBeenCalled());
    const preview=evaluate.mock.calls.at(-1)[0];
    expect(preview.rollbackIndex).toBe(2);
    expect(preview.features.at(-1).id).toBe("later");
    panel.querySelector("form").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));
    await vi.waitFor(()=>expect(doc.features[1].distanceMillimeters).toBe(25));
    expect(doc.rollbackIndex).toBeUndefined();
    expect(doc.features.at(-1).id).toBe("later");
  } finally {configureFeaturePreview(null);}
});

it('authors counterbore holes and shows only the parameters for the selected hole type', async () => {
  seedProfile();
  doc = insertFeature(doc, {id:'extrude-1',type:'extrude',name:'Plate',suppressed:false,profileFeatureId:'profile-1',distanceMillimeters:10,operation:'new'});
  const feature = await authored('hole', {'Center sketch':'profile-1','Hole type':'counterbore','Diameter':'6','Depth':'8','Head diameter':'10','Counterbore depth':'2'});
  expect(feature).toMatchObject({type:'hole',profileFeatureId:'profile-1',diameterMillimeters:6,depthMillimeters:8,cutType:'counterbore',counterDiameterMillimeters:10,counterDepthMillimeters:2});
  expect(feature.targetBodyId).toBeTruthy();
  cadCommands.execute('feature-hole');
  const panel = [...document.querySelectorAll('.cad-feature-dialog')].at(-1);
  const field = name => panel.querySelector(`[aria-label="${name}"]`) ?? panel.querySelector(`[aria-label^="${name} ("]`);
  expect(field('Head diameter').closest('.aui-feature-row').hidden).toBe(true);
  field('Hole type').value = 'countersink'; field('Hole type').dispatchEvent(new Event('change'));
  expect(field('Head diameter').closest('.aui-feature-row').hidden).toBe(false);
  expect(field('Countersink angle').closest('.aui-feature-row').hidden).toBe(false);
  expect(field('Counterbore depth').closest('.aui-feature-row').hidden).toBe(true);
  field('Depth type').value = 'through-all'; field('Depth type').dispatchEvent(new Event('change'));
  expect(field('Depth').closest('.aui-feature-row').hidden).toBe(true);
  panel.querySelector('[aria-label="Cancel"]').click();
  await Promise.resolve();
});

it('authors an ordered multi-section loft and lets sections move and be removed', async () => {
  for (let i=0;i<3;i++) doc=insertFeature(doc,{id:`section-${i}`,type:'profile',name:`Section ${i}`,suppressed:false,plane:'XY',offsetMillimeters:i*10,profile:{type:'circle',radiusMillimeters:4-i,centerMillimeters:[0,0]}});
  mountFeatureAuthoring(()=>doc,apply);
  cadCommands.execute('feature-loft');
  const panel=document.querySelector('.cad-feature-dialog');
  const source=panel.querySelector('[aria-label="Section sketch"]');
  const click=label=>[...panel.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===label || b.textContent===label).click();
  for (let i=0;i<3;i++) {source.value=`section-${i}`;source.dispatchEvent(new Event('change'));click('Add section');}
  const list=panel.querySelector('[aria-label="Loft section order"]');
  expect(list.options).toHaveLength(3);
  click('Move up');
  expect([...list.options].map(o=>o.textContent)).toEqual([expect.stringContaining('Section 0'),expect.stringContaining('Section 2'),expect.stringContaining('Section 1')]);
  click('Remove section');
  panel.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  await vi.waitFor(()=>expect(apply).toHaveBeenCalled());
  expect(doc.features.at(-1)).toMatchObject({type:'loft',operation:'new',ruled:false,sections:[{profileFeatureId:'section-0'},{profileFeatureId:'section-1'}]});
  panel.querySelector('[aria-label="Cancel"]')?.click();
  await Promise.resolve();
});

it('authors a Draft with face and neutral plane references, angle and target',async()=>{
  seedProfile();
  doc=insertFeature(doc,{id:'pad',type:'extrude',name:'Plate',suppressed:false,profileFeatureId:'profile-1',distanceMillimeters:10,operation:'new'});
  const feature=await authored('draft',{'Face plane':'YZ','Face plane offset':'10','Neutral plane':'XY','Neutral plane offset':'2','Draft angle':'8','Direction':'reverse'});
  expect(feature).toMatchObject({type:'draft',facePlane:{plane:'YZ',offsetMillimeters:10},neutralPlane:{plane:'XY',offsetMillimeters:2},angleDegrees:8,reversed:true});
  expect(feature.targetBodyId).toBeTruthy();
});

it('authors native polar patterns with count, axis and angle',async()=>{
  seedProfile();
  doc=insertFeature(doc,{id:'pad',type:'extrude',name:'Boss',suppressed:false,profileFeatureId:'profile-1',distanceMillimeters:10,operation:'new'});
  const feature=await authored('pattern',{'Source feature':'pad','Pattern type':'polar','Axis':'Z','Occurrences':'4','Angle':'360'});
  expect(feature).toMatchObject({type:'pattern',sourceFeatureId:'pad',patternType:'polar',axis:'Z',count:4,angleDegrees:360,reversed:false});
  expect(feature).not.toHaveProperty('spacingMillimeters');
  expect(feature.targetBodyId).toBeTruthy();
});

it('authors a Boolean with selected tool bodies and keep-tools intent',async()=>{
  seedProfile();
  for (const id of ['target','tool']) doc=insertFeature(doc,{id:`pad-${id}`,type:'extrude',name:id,suppressed:false,profileFeatureId:'profile-1',distanceMillimeters:10,operation:'new',bodyId:id});
  mountFeatureAuthoring(()=>doc,apply);
  cadCommands.execute('feature-boolean');
  const panel=document.querySelector('.cad-feature-dialog');
  const set=(label,value)=>{const c=panel.querySelector(`[aria-label="${label}"]`);c.value=value;c.dispatchEvent(new Event('change'));};
  set('Target body','target');set('Operation','intersection');set('Keep tools','yes');
  panel.querySelector('[aria-label="Use Body 2 as tool"]').click();
  panel.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  await vi.waitFor(()=>expect(apply).toHaveBeenCalled());
  expect(doc.features.at(-1)).toMatchObject({type:'boolean',operation:'intersection',targetBodyId:'target',toolBodyIds:['tool'],keepTools:true});
});


it("authors and reopens Intersect with an explicit target and the standard extent controls", async () => {
  seedProfile();
  doc = insertFeature(doc, { id: "base", type: "extrude", name: "Base", suppressed: false, profileFeatureId: "profile-1", distanceMillimeters: 10, operation: "new", bodyId: "base-body" });
  const feature = await authored("extrude", { Sketch: "profile-1", Operation: "intersect", "Merge with all":"false", "Target body": "base-body", "End condition": "through-all" });
  expect(feature).toMatchObject({ operation: "intersect", targetBodyId: "base-body", endType: "through-all" });
  const { serializePartDocument, parsePartDocument } = await import("@aether/core/document");
  const reopened = parsePartDocument(serializePartDocument(doc));
  expect(reopened.features.at(-1)).toEqual(feature);
  expect(apply).toHaveBeenCalledTimes(1);
});

it("refuses Intersect without an existing target and keeps other unsupported Intersect tools disabled", () => {
  seedProfile();
  mountFeatureAuthoring(() => doc, apply);
  cadCommands.execute("feature-extrude");
  const panel = document.querySelector(".cad-feature-dialog");
  const button = [...panel.querySelectorAll(".aui-feature-tabs button")].find(b => b.textContent === "Intersect");
  button.click();
  expect(panel.textContent).toContain("Choose a target part to modify.");
  expect(apply).not.toHaveBeenCalled();
  cadCommands.execute("feature-revolve");
  const revolve = [...document.querySelectorAll(".cad-feature-dialog")].at(-1);
  expect([...revolve.querySelectorAll(".aui-feature-tabs button")].find(b => b.textContent === "Intersect").disabled).toBe(true);
});


it('persists signed Up-to-next end offsets and clears them when switching to Blind', async () => {
  seedProfile();
  const feature=await authored('extrude', {Sketch:'profile-1',Operation:'new','End condition':'up-to-next','End offset (mm)':'-2'});
  expect(feature).toMatchObject({endType:'up-to-next',endOffsetMillimeters:-2});
  const blind=await authored('extrude', {Sketch:'profile-1',Operation:'new','End condition':'blind','End offset (mm)':'5'});
  expect(blind.endOffsetMillimeters).toBeUndefined();
});

it('authors reverse, symmetric and independent opposite revolve angles', async () => {
  seedProfile();
  const two=await authored('revolve',{'Sketch':'profile-1','Axis':'X','Angle':'90','Reverse direction':'true','Opposite angle':'30'});
  expect(two).toMatchObject({angleDegrees:90,reversed:true,secondAngleDegrees:30});
  const symmetric=await authored('revolve',{'Sketch':'profile-1','Axis':'X','Angle':'120','Symmetric':'true','Opposite angle':'30'});
  expect(symmetric).toMatchObject({angleDegrees:120,symmetric:true});
  expect(symmetric).not.toHaveProperty('secondAngleDegrees');
});

it('keeps full and opposite revolve angles correct when display units are radians', async () => {
  const {applyDocumentUnits}=await import('./document-preferences');
  applyDocumentUnits({angle:{unit:'rad',decimals:4}});
  try {
    seedProfile(); mountFeatureAuthoring(()=>doc,apply); cadCommands.execute('feature-revolve');
    const panel=[...document.querySelectorAll('.cad-feature-dialog')].at(-1);
    const source=panel.querySelector('[aria-label="Sketch"]'); source.value='profile-1'; source.dispatchEvent(new dom.window.Event('change'));
    const full=panel.querySelector('[aria-label="Full revolve"]');
    expect(full.checked).toBe(true);full.click();
    const angle=panel.querySelector('[aria-label="Angle (rad)"]');
    expect(Number(angle.value)).toBeCloseTo(Math.PI/2);
    const second=panel.querySelector('[aria-label="Opposite angle (rad)"]');
    second.value=String(Math.PI/6);second.dispatchEvent(new dom.window.Event('change'));
    panel.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
    await vi.waitFor(()=>expect(apply).toHaveBeenCalled());
    expect(apply.mock.calls.at(-1)[0].features.at(-1)).toMatchObject({angleDegrees:90});
    expect(apply.mock.calls.at(-1)[0].features.at(-1).secondAngleDegrees).toBeCloseTo(30);
  } finally { applyDocumentUnits({}); }
});

it('rejects typed sweeps over a full turn and deliberately clears the opposite angle for Full revolve', async () => {
  seedProfile();mountFeatureAuthoring(()=>doc,apply);cadCommands.execute('feature-revolve');
  const panel=[...document.querySelectorAll('.cad-feature-dialog')].at(-1);
  const source=panel.querySelector('[aria-label="Sketch"]');source.value='profile-1';source.dispatchEvent(new dom.window.Event('change'));
  const full=panel.querySelector('[aria-label="Full revolve"]');full.click();
  const angle=panel.querySelector('[aria-label^="Angle ("]');angle.value='360';angle.dispatchEvent(new dom.window.Event('change'));
  const second=panel.querySelector('[aria-label^="Opposite angle ("]');second.value='30';second.dispatchEvent(new dom.window.Event('change'));
  const form=panel.querySelector('form');form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  expect(apply).not.toHaveBeenCalled();
  expect(panel.textContent).toContain('totaling at most 360');
  full.click();expect(Number(second.value)).toBe(0);
  form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  await vi.waitFor(()=>expect(apply).toHaveBeenCalled());
  const result=apply.mock.calls.at(-1)[0].features.at(-1);
  expect(result.angleDegrees).toBe(360);expect(result).not.toHaveProperty('secondAngleDegrees');
});

it('waits for confirmed sketch completion, deduplicates clicks and stays in the sketch on failure',async()=>{
  seedProfile();
  mountFeatureAuthoring(()=>doc,apply);
  const workspace=document.createElement('section');workspace.className='cad-sketch-workspace';document.body.append(workspace);
  let complete;
  const finish=vi.fn(event=>{event.preventDefault();complete=event.detail.complete;});
  window.addEventListener('aether-sketch-finish',finish);
  try {
    cadCommands.execute('feature-extrude');cadCommands.execute('feature-extrude');
    expect(finish).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.cad-feature-dialog')).toBeNull();
    complete(false);
    expect(document.querySelector('.cad-feature-dialog')).toBeNull();
    cadCommands.execute('feature-extrude');
    expect(finish).toHaveBeenCalledTimes(2);
    workspace.remove();complete(true);
    expect(document.querySelector('.cad-feature-dialog')).toBeTruthy();
  } finally {workspace.remove();window.removeEventListener('aether-sketch-finish',finish);}
});

it('authors signed planar face Push/Pull in document units and restores the selection filter',async()=>{
  const {cadSelection}=await import('./cad-selection-store');
  const {applyDocumentUnits,documentUnits}=await import('./document-preferences');
  const units=documentUnits(),filter=cadSelection.snapshot().filter;
  seedProfile();doc=insertFeature(doc,{id:'pad',type:'extrude',name:'Base',profileFeatureId:'profile-1',distanceMillimeters:10,operation:'new',bodyId:'base',suppressed:false});
  const faceAnchor={centerMillimeters:[0,0,10],areaSquareMillimeters:100};
  const respond=()=>window.dispatchEvent(new CustomEvent('aether-sketch-face',{detail:{support:{sourceFeatureId:'pad',bodyId:'base',normal:[0,0,1],xDirection:[1,0,0],label:'Face of Base',faceAnchor}}}));
  window.addEventListener('aether-sketch-face-request',respond);
  try {
    applyDocumentUnits({length:{unit:'in',decimals:3}});
    cadSelection.dispatch({type:'replace',items:[{id:'top',kind:'face',partId:'base',faceId:1,label:'Top'}]});
    mountFeatureAuthoring(()=>doc,apply);cadCommands.execute('feature-face-extrude');
    await new Promise(resolve=>setTimeout(resolve,0));
    const panel=document.querySelector('.cad-feature-dialog');
    expect(panel.textContent).toContain('Face of Base');
    expect(cadSelection.snapshot().filter).toBe('face');
    const depth=panel.querySelector('[aria-label="Distance (in)"]');depth.value='-0.25';depth.dispatchEvent(new Event('input'));
    panel.querySelector('form').requestSubmit();
    await vi.waitFor(()=>expect(apply).toHaveBeenCalledTimes(1));
    expect(doc.features.at(-1)).toMatchObject({type:'face-extrude',sourceFeatureId:'pad',targetBodyId:'base',normal:[0,0,1],distanceMillimeters:-6.35,faceAnchor});
    await vi.waitFor(()=>expect(cadSelection.snapshot().filter).toBe(filter));
  } finally {window.removeEventListener('aether-sketch-face-request',respond);applyDocumentUnits(units);cadSelection.dispatch({type:'clear'});}
});

it('does not enable Push/Pull commit without a face or for zero distance',async()=>{
  seedProfile();doc=insertFeature(doc,{id:'pad',type:'extrude',name:'Base',profileFeatureId:'profile-1',distanceMillimeters:10,operation:'new',bodyId:'base',suppressed:false});
  mountFeatureAuthoring(()=>doc,apply);cadCommands.execute('feature-face-extrude');
  const panel=document.querySelector('.cad-feature-dialog');
  expect(panel.querySelector('.aui-feature-accept').disabled).toBe(true);
  window.dispatchEvent(new CustomEvent('aether-sketch-face',{detail:{support:{sourceFeatureId:'pad',bodyId:'base',normal:[0,0,1],label:'Top'}}}));
  const distance=panel.querySelector('[aria-label="Distance (mm)"]');distance.value='0';distance.dispatchEvent(new Event('input'));
  expect(panel.querySelector('.aui-feature-accept').disabled).toBe(true);
  expect(apply).not.toHaveBeenCalled();
  panel.querySelector('[aria-label="Cancel"]').click();
});

it('authors an explicit stopping face, gates missing references and restores profile picking',async()=>{
 seedProfile();doc=insertFeature(doc,{id:'pad',type:'extrude',name:'Stop',profileFeatureId:'profile-1',distanceMillimeters:10,operation:'new',bodyId:'stop',suppressed:false});
 mountFeatureAuthoring(()=>doc,apply);cadCommands.execute('feature-extrude');
 const panel=document.querySelector('.cad-feature-dialog'),mode=panel.querySelector('[aria-label="End condition"]');
 const source=panel.querySelector('[aria-label="Sketch"]');source.value='profile-1';source.dispatchEvent(new Event('change'));
 const operation=panel.querySelector('[aria-label="Operation"]');operation.value='new';operation.dispatchEvent(new Event('change'));
 const events=[];const receive=event=>events.push(event.detail.active);window.addEventListener('aether-region-mode',receive);
 try {
  mode.value='up-to-face';mode.dispatchEvent(new Event('change'));
  expect(events.at(-1)).toBe(false);expect(panel.querySelector('.aui-feature-accept').disabled).toBe(true);
  window.dispatchEvent(new CustomEvent('aether-extrude-face',{detail:{support:{sourceFeatureId:'pad',bodyId:'stop',normal:[0,0,-1],label:'Face of Stop'}}}));
  expect(panel.querySelector('.aui-feature-accept').disabled).toBe(false);
  mode.value='blind';mode.dispatchEvent(new Event('change'));expect(events.at(-1)).toBe(true);
  mode.value='up-to-face';mode.dispatchEvent(new Event('change'));
  panel.querySelector('form').requestSubmit();await vi.waitFor(()=>expect(apply).toHaveBeenCalledTimes(1));
  expect(doc.features.at(-1)).toMatchObject({type:'extrude',endType:'up-to-face',endReference:{sourceFeatureId:'pad',bodyId:'stop',normal:[0,0,-1]}});
 }finally{window.removeEventListener('aether-region-mode',receive);}
});

it('updates the material preview legend when switching Add to Remove and clears it on cancel',async()=>{
 seedProfile();doc=insertFeature(doc,{id:'base',type:'extrude',name:'Base',profileFeatureId:'profile-1',distanceMillimeters:10,operation:'new',suppressed:false});
 const {configureFeaturePreview}=await import('./modeling/feature-preview');
 const show=vi.fn();
 const evaluate=vi.fn(async candidate=>({parts:[],sourceName:'Preview',parseMilliseconds:1,featurePreview:{base:[],added:candidate.features.at(-1).operation==='cut'?[]:[{}],removed:candidate.features.at(-1).operation==='cut'?[{}]:[]}}));
 configureFeaturePreview({evaluate,show});
 try{
  mountFeatureAuthoring(()=>doc,apply);cadCommands.execute('feature-extrude');
  const panel=document.querySelector('.cad-feature-dialog');
  const source=panel.querySelector('[aria-label="Sketch"]');source.value='profile-1';source.dispatchEvent(new Event('change'));
  await vi.waitFor(()=>expect(panel.textContent).toContain('Blue: added material'));
  const operation=panel.querySelector('[aria-label="Operation"]');operation.value='cut';operation.dispatchEvent(new Event('change'));
  expect(panel.textContent).toContain('Updating preview…');
  await vi.waitFor(()=>expect(panel.textContent).toContain('Red: removed material'));
  expect(panel.textContent).not.toContain('Blue: added material');
  panel.remove();await vi.waitFor(()=>expect(show).toHaveBeenLastCalledWith(null));
  expect(apply).not.toHaveBeenCalled();
 }finally{configureFeaturePreview(null);}
});

it('authors explicit extra targets, retains them for Add and drops scope for New',async()=>{
 seedProfile();
 for(const id of ['first','second','third'])doc=insertFeature(doc,{id,type:'extrude',name:id,profileFeatureId:'profile-1',distanceMillimeters:10,operation:'new',bodyId:id,suppressed:false});
 mountFeatureAuthoring(()=>doc,apply);cadCommands.execute('feature-cut');
 let panel=document.querySelector('.cad-feature-dialog');
 const source=panel.querySelector('[aria-label="Sketch"]');source.value='profile-1';source.dispatchEvent(new Event('change'));
 panel.querySelector('[aria-label="Merge with all"]').click();
 const target=panel.querySelector('[aria-label="Target body"]');target.value='first';target.dispatchEvent(new Event('change'));
 const extra=panel.querySelector('[aria-label="Also modify Body 2"]');extra.checked=true;extra.dispatchEvent(new Event('change'));
 panel.querySelector('form').requestSubmit();await vi.waitFor(()=>expect(apply).toHaveBeenCalledTimes(1));
 expect(doc.features.at(-1)).toMatchObject({operation:'cut',targetBodyId:'first',targetBodyIds:['first','second']});
 const id=doc.features.at(-1).id;
 window.dispatchEvent(new CustomEvent('aether-feature-action',{detail:{type:'item-action',actionID:'edit-feature',id:`feature/doc/${id}`}}));
 panel=[...document.querySelectorAll('.cad-feature-dialog')].at(-1);
 expect(panel.querySelector('[aria-label="Also modify Body 2"]').checked).toBe(true);
 const op=panel.querySelector('[aria-label="Operation"]');op.value='add';op.dispatchEvent(new Event('change'));
 expect(panel.querySelector('[aria-label="Also merge Body 2"]').checked).toBe(true);
 expect(panel.querySelector('[aria-label="Additional parts to merge"]').hidden).toBe(false);
 panel.querySelector('form').requestSubmit();await vi.waitFor(()=>expect(apply).toHaveBeenCalledTimes(2));
 expect(doc.features.at(-1).targetBodyIds).toEqual(['first','second']);
 expect(doc.features.at(-1).targetBodyId).toBe('first');
 window.dispatchEvent(new CustomEvent('aether-feature-action',{detail:{type:'item-action',actionID:'edit-feature',id:`feature/doc/${id}`}}));
 panel=[...document.querySelectorAll('.cad-feature-dialog')].at(-1);
 expect(panel.querySelector('[aria-label="Also merge Body 2"]').checked).toBe(true);
 const changed=panel.querySelector('[aria-label="Operation"]');changed.value='new';changed.dispatchEvent(new Event('change'));
 expect(panel.querySelector('[aria-label="Additional parts to modify"]').hidden).toBe(true);
 panel.querySelector('form').requestSubmit();await vi.waitFor(()=>expect(apply).toHaveBeenCalledTimes(3));
 expect(doc.features.at(-1).targetBodyIds).toBeUndefined();
});

it('clears the draft preview to change an anchored face and saves only the repaired reference',async()=>{
 const {cadSelection}=await import('./cad-selection-store');
 const {configureFeaturePreview}=await import('./modeling/feature-preview');
 seedProfile();doc=insertFeature(doc,{id:'pad',type:'extrude',name:'Base',profileFeatureId:'profile-1',distanceMillimeters:10,operation:'new',bodyId:'base',suppressed:false});
 const oldAnchor={centerMillimeters:[2.5,10,15],areaSquareMillimeters:100};
 doc=insertFeature(doc,{id:'pull',type:'face-extrude',name:'Push/Pull',sourceFeatureId:'pad',targetBodyId:'base',normal:[0,0,1],faceAnchor:oldAnchor,faceLabel:'Upper face',distanceMillimeters:2,suppressed:false});
 const show=vi.fn();configureFeaturePreview({evaluate:async()=>({parts:[],sourceName:'Preview',parseMilliseconds:0}),show});
 const repaired={centerMillimeters:[7.5,10,10],areaSquareMillimeters:100};
 const respond=vi.fn(event=>{
  expect(event.detail.beforeFeatureId).toBe('pull');
  window.dispatchEvent(new CustomEvent('aether-sketch-face',{detail:{support:{sourceFeatureId:'pad',bodyId:'base',normal:[0,0,1],faceAnchor:repaired,label:'Lower face'}}}));
 });
 window.addEventListener('aether-sketch-face-request',respond);
 try {
  mountFeatureAuthoring(()=>doc,apply);
  window.dispatchEvent(new CustomEvent('aether-feature-action',{detail:{type:'item-action',actionID:'edit-feature',id:'feature/face-extrude/pull'}}));
  const panel=[...document.querySelectorAll('.cad-feature-dialog')].at(-1);
  // Each mount in this harness adds an app-level listener. Keep only this
  // editor connected so earlier test mounts cannot respond to face selection.
  for(const other of document.querySelectorAll('.cad-feature-dialog'))if(other!==panel)other.remove();
  await vi.waitFor(()=>expect(show).toHaveBeenCalledWith(expect.objectContaining({sourceName:'Preview'})));
  [...panel.querySelectorAll('button')].find(b=>b.textContent==='Change face').click();
  expect(show).toHaveBeenLastCalledWith(null);expect(panel.querySelector('.aui-feature-accept').disabled).toBe(true);
  expect(JSON.parse(panel.querySelector('[aria-label="Planar face"]').value||'null')).toBeNull();
  expect(doc.features.at(-1).faceAnchor).toEqual(oldAnchor);
  cadSelection.dispatch({type:'replace',items:[{id:'face:base:99',kind:'face',partId:'base',faceId:99,label:'Lower'}]});
  expect(respond).toHaveBeenCalledOnce();
  await vi.waitFor(()=>expect(panel.querySelector('.aui-feature-accept').disabled).toBe(false));
  panel.querySelector('form').requestSubmit();await vi.waitFor(()=>expect(apply).toHaveBeenCalledOnce());
  expect(doc.features.at(-1)).toMatchObject({id:'pull',faceAnchor:repaired,faceLabel:'Lower face'});
 } finally {configureFeaturePreview(null);window.removeEventListener('aether-sketch-face-request',respond);cadSelection.dispatch({type:'clear'});}
});

it('edits persisted mesh interpretation and units without inventing a target body or changing source bytes',async()=>{
 doc=insertFeature(doc,{id:'mesh-import',type:'import-cad',name:'Import wheel.stl',suppressed:false,operation:'new',bodyId:'wheel-body',sourceName:'wheel.stl',format:'stl',dataBase64:btoa('original mesh'),meshMode:'reference',meshUnits:'mm'});
 mountFeatureAuthoring(()=>doc,apply);
 window.dispatchEvent(new CustomEvent('aether-feature-action',{detail:{type:'item-action',actionID:'edit-feature',id:'feature/doc/mesh-import'}}));
 const panel=[...document.querySelectorAll('.cad-feature-dialog')].at(-1);
 expect(panel.textContent).toContain('Edit CAD import');
 expect(panel.querySelector('[aria-label="Target body"]').closest('.aui-feature-row').hidden).toBe(true);
 for(const [label,value] of [['Mesh handling','solid'],['Source units','in']]){
  const input=panel.querySelector(`[aria-label="${label}"]`);input.value=value;input.dispatchEvent(new Event('change'));
 }
 panel.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
 await vi.waitFor(()=>expect(apply).toHaveBeenCalled());
 expect(doc.features[0]).toMatchObject({id:'mesh-import',bodyId:'wheel-body',dataBase64:btoa('original mesh'),meshMode:'solid',meshUnits:'in'});
 expect(doc.features[0]).not.toHaveProperty('targetBodyId');
});

it('authors extrusion draft in document angle units and retains its exact angle when reopened', async()=>{
  const {applyDocumentUnits}=await import('./document-preferences');
  applyDocumentUnits({angle:{unit:'rad',decimals:4}});
  try {
    seedProfile();
    const feature=await authored('extrude',{Sketch:'profile-1','Use extrusion draft':'true','Draft angle (rad)':String(Math.PI/36),'Widen extrusion draft':'true'});
    expect(feature.draftAngleDegrees).toBeCloseTo(-5,12);
    window.dispatchEvent(new CustomEvent('aether-feature-action',{detail:{type:'item-action',actionID:'edit-feature',id:`feature/doc/${feature.id}`}}));
    const panel=[...document.querySelectorAll('.cad-feature-dialog')].at(-1);
    expect(panel.querySelector('[aria-label="Widen extrusion draft"]').checked).toBe(true);
    expect(Number(panel.querySelector('[aria-label="Draft angle (rad)"]').value)).toBeCloseTo(Math.PI/36,4);
    const before=apply.mock.calls.length;
    panel.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    await vi.waitFor(()=>expect(apply.mock.calls.length).toBeGreaterThan(before));
    expect(doc.features.at(-1).draftAngleDegrees).toBe(feature.draftAngleDegrees);
  } finally {applyDocumentUnits({});}
});

it('previews draft on referenced extents, rejects invalid angles and cancels without committing',async()=>{
  seedProfile();
  const {configureFeaturePreview}=await import('./modeling/feature-preview');
  const evaluate=vi.fn().mockResolvedValue({parts:[],sourceName:'Draft',parseMilliseconds:0}),show=vi.fn();
  configureFeaturePreview({evaluate,show});
  try {
    mountFeatureAuthoring(()=>doc,apply);cadCommands.execute('feature-extrude');
    const panel=[...document.querySelectorAll('.cad-feature-dialog')].at(-1);
    const source=panel.querySelector('[aria-label="Sketch"]');source.value='profile-1';source.dispatchEvent(new Event('change'));
    const toggle=[...panel.querySelectorAll('input[type="checkbox"]')].find(input=>input.closest('.aui-feature-subsection')?.textContent.includes('Draft'));
    expect(toggle).toBeTruthy();toggle.click();
    await vi.waitFor(()=>expect(evaluate.mock.calls.at(-1)?.[0].features.at(-1).draftAngleDegrees).toBe(3));
    const end=panel.querySelector('[aria-label="End condition"]');end.value='up-to-next';end.dispatchEvent(new Event('change'));
    await vi.waitFor(()=>expect(evaluate.mock.calls.at(-1)?.[0].features.at(-1)).toMatchObject({draftAngleDegrees:3,endType:'up-to-next'}));
    const angle=panel.querySelector('[aria-label="Draft angle (deg)"]');angle.value='90';angle.dispatchEvent(new Event('change'));
    panel.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    expect(apply).not.toHaveBeenCalled();expect(panel.textContent).toContain('less than 90 degrees');
    panel.querySelector('[aria-label="Cancel"]').click();
    expect(doc.features).toHaveLength(1);expect(show).toHaveBeenLastCalledWith(null);
  } finally {configureFeaturePreview(null);}
});

it('disabling draft on an existing feature removes its taper without changing feature or body identity',async()=>{
 seedProfile();const feature=await authored('extrude',{Sketch:'profile-1','Use extrusion draft':'true','Draft angle':'6'});
 window.dispatchEvent(new CustomEvent('aether-feature-action',{detail:{type:'item-action',actionID:'edit-feature',id:`feature/doc/${feature.id}`}}));
 const panel=[...document.querySelectorAll('.cad-feature-dialog')].at(-1);
 panel.querySelector('[aria-label="Draft"]').click();
 const before=apply.mock.calls.length;
 panel.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
 await vi.waitFor(()=>expect(apply.mock.calls.length).toBeGreaterThan(before));
 expect(doc.features.at(-1)).not.toHaveProperty('draftAngleDegrees');
 expect(doc.features.at(-1).id).toBe(feature.id);expect(doc.features.at(-1).bodyId).toBe(feature.bodyId);
});

it('authors independent opposite-end depth and draft in inches and radians',async()=>{
 const {applyDocumentUnits}=await import('./document-preferences');
 applyDocumentUnits({length:{unit:'in',decimals:4},angle:{unit:'rad',decimals:5}});
 try {
  seedProfile();
  const feature=await authored('extrude',{Sketch:'profile-1','Distance (in)':'1','Use extrusion draft':'true','Draft angle (rad)':String(Math.PI/36),
   'Use second end':'true','Opposite depth (in)':'.5','Use opposite draft':'true','Opposite draft angle (rad)':String(Math.PI/18),'Widen opposite extrusion draft':'true'});
  expect(feature.distanceMillimeters).toBeCloseTo(25.4);expect(feature.draftAngleDegrees).toBeCloseTo(5);
  expect(feature.secondEnd.endType).toBe('blind');expect(feature.secondEnd.distanceMillimeters).toBeCloseTo(12.7);expect(feature.secondEnd.draftAngleDegrees).toBeCloseTo(-10);
  expect(feature).not.toHaveProperty('secondDistanceMillimeters');
  window.dispatchEvent(new CustomEvent('aether-feature-action',{detail:{type:'item-action',actionID:'edit-feature',id:`feature/doc/${feature.id}`}}));
  const panel=[...document.querySelectorAll('.cad-feature-dialog')].at(-1);
  expect(panel.querySelector('[aria-label="Second end position"]').checked).toBe(true);
  expect(panel.querySelector('[aria-label="Opposite draft"]').checked).toBe(true);
  expect(Number(panel.querySelector('[aria-label="Opposite depth (in)"]').value)).toBeCloseTo(.5);
  panel.querySelector('[aria-label="Second end position"]').click();
  const before=apply.mock.calls.length;panel.querySelector('form').requestSubmit();await vi.waitFor(()=>expect(apply.mock.calls.length).toBeGreaterThan(before));
  expect(doc.features.at(-1)).not.toHaveProperty('secondEnd');expect(doc.features.at(-1).draftAngleDegrees).toBe(feature.draftAngleDegrees);
 }finally{applyDocumentUnits({});}
});

it('keeps primary and opposite stopping-face picks independent and commits both references',async()=>{
 seedProfile();
 for(const id of ['top','bottom'])doc=insertFeature(doc,{id,type:'extrude',name:id,profileFeatureId:'profile-1',operation:'new',bodyId:id,distanceMillimeters:2,suppressed:false});
 mountFeatureAuthoring(()=>doc,apply);cadCommands.execute('feature-extrude');
 const panel=[...document.querySelectorAll('.cad-feature-dialog')].at(-1);
 const change=(label,value)=>{const input=panel.querySelector(`[aria-label="${label}"]`);input.value=value;input.dispatchEvent(new Event('change'));};
 change('Sketch','profile-1');change('Operation','new');change('End condition','up-to-face');change('Use second end','true');change('Opposite end condition','up-to-face');
 const reference=(id,normal)=>({sourceFeatureId:id,bodyId:id,normal,xDirection:[1,0,0],label:id});
 window.dispatchEvent(new CustomEvent('aether-extrude-face',{detail:{support:reference('bottom',[0,0,1])}}));
 expect(panel.querySelector('[aria-label="Stopping face"]').value).toBe('');
 expect(JSON.parse(panel.querySelector('[aria-label="Opposite stopping face"]').value).sourceFeatureId).toBe('bottom');
 const primary=panel.querySelectorAll('[data-picking]')[0];primary.dispatchEvent(new Event('pointerdown',{bubbles:true}));
 window.dispatchEvent(new CustomEvent('aether-extrude-face',{detail:{support:reference('top',[0,0,-1])}}));
 expect(JSON.parse(panel.querySelector('[aria-label="Opposite stopping face"]').value).sourceFeatureId).toBe('bottom');
 panel.querySelector('form').requestSubmit();await vi.waitFor(()=>expect(apply).toHaveBeenCalled());
 expect(doc.features.at(-1)).toMatchObject({endReference:{sourceFeatureId:'top'},secondEnd:{endType:'up-to-face',endReference:{sourceFeatureId:'bottom'}}});
});

it('authors normalized custom extrusion directions and clears them when restored to sketch normal',async()=>{
 seedProfile();const feature=await authored('extrude',{Sketch:'profile-1','Extrusion direction':'custom','Direction X':'3','Direction Y':'0','Direction Z':'4'});
 expect(feature.directionVector).toEqual([.6,0,.8]);
 window.dispatchEvent(new CustomEvent('aether-feature-action',{detail:{type:'item-action',actionID:'edit-feature',id:`feature/doc/${feature.id}`}}));
 const panel=[...document.querySelectorAll('.cad-feature-dialog')].at(-1);
 expect(panel.querySelector('[aria-label="Direction X"]').value).toBe('0.6');
 const mode=panel.querySelector('[aria-label="Extrusion direction"]');mode.value='normal';mode.dispatchEvent(new Event('change'));
 const before=apply.mock.calls.length;panel.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await vi.waitFor(()=>expect(apply.mock.calls.length).toBeGreaterThan(before));
 expect(doc.features.at(-1)).not.toHaveProperty('directionVector');
});
it('rejects an empty or zero custom extrusion direction before applying',async()=>{
 seedProfile();mountFeatureAuthoring(()=>doc,apply);cadCommands.execute('feature-extrude');
 const panel=[...document.querySelectorAll('.cad-feature-dialog')].at(-1);
 for(const [label,value] of [['Sketch','profile-1'],['Extrusion direction','custom'],['Direction Z','0']]){const field=panel.querySelector(`[aria-label="${label}"]`);field.value=value;field.dispatchEvent(new Event('change'));}
 panel.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));expect(apply).not.toHaveBeenCalled();expect(panel.textContent).toContain('nonzero extrusion direction');panel.querySelector('[aria-label="Cancel"]').click();
});
it('offers symmetric Through-all, retaining the checkbox across Blind and Through-all only',async()=>{
 seedProfile();const base=await authored('extrude',{Sketch:'profile-1'});
 const feature=await authored('extrude',{Sketch:'profile-1',Operation:'cut','End condition':'symmetric-through-all'});
 expect(feature.endType).toBe('symmetric-through-all');expect(feature).not.toHaveProperty('secondEnd');
 window.dispatchEvent(new CustomEvent('aether-feature-action',{detail:{type:'item-action',actionID:'edit-feature',id:`feature/doc/${feature.id}`}}));
 const panel=[...document.querySelectorAll('.cad-feature-dialog')].at(-1),symmetric=panel.querySelector('[aria-label="Symmetric"]');expect(symmetric.checked).toBe(true);expect(symmetric.closest('.aui-feature-row').hidden).toBe(false);
 symmetric.click();expect(panel.querySelector('[aria-label="End condition"]').value).toBe('through-all');
 symmetric.click();expect(panel.querySelector('[aria-label="End condition"]').value).toBe('symmetric-through-all');
 panel.querySelector('[aria-label="Cancel"]').click();expect(doc.features.at(-1).endType).toBe('symmetric-through-all');expect(base.id).not.toBe(feature.id);
});

it('authors an associative construction-line direction atomically and restores its picker',async()=>{
 seedProfile();doc.features.unshift({id:'guide',name:'Guide',type:'profile',plane:'XZ',offsetMillimeters:0,suppressed:false,profile:{type:'drawing',contours:[{type:'path',construction:true,start:[0,0],segments:[{type:'line',end:[3,4]}]}]}});
 const original=JSON.stringify(doc);
 mountFeatureAuthoring(()=>doc,apply);cadCommands.execute('feature-extrude');
 let panel=[...document.querySelectorAll('.cad-feature-dialog')].at(-1);
 const select=(label,value)=>{const field=panel.querySelector(`[aria-label="${label}"]`);field.value=value;field.dispatchEvent(new Event('change'));};
 select('Extrusion direction','line');expect(panel.querySelector('[aria-label="Apply and rebuild"]').disabled).toBe(true);
 select('Sketch','profile-1');select('Direction sketch line',JSON.stringify(['guide',0,0]));
 expect(JSON.parse(panel.querySelector('[aria-label="Resolved direction vector"]').value)).toEqual([.6,0,.8]);
 panel.querySelector('[aria-label="Cancel"]').click();expect(JSON.stringify(doc)).toBe(original);
 const feature=await authored('extrude',{Sketch:'profile-1','Extrusion direction':'line','Direction sketch line':JSON.stringify(['guide',0,0])});
 const contour=doc.features[0].profile.contours[0];expect(contour.id).toBeTruthy();expect(contour.segments[0].id).toBeTruthy();
 expect(feature.directionReference).toEqual({kind:'sketch-line',sourceFeatureId:'guide',contourId:contour.id,segmentId:contour.segments[0].id});expect(feature).not.toHaveProperty('directionVector');
 window.dispatchEvent(new CustomEvent('aether-feature-action',{detail:{type:'item-action',actionID:'edit-feature',id:`feature/doc/${feature.id}`}}));
 panel=[...document.querySelectorAll('.cad-feature-dialog')].at(-1);expect(panel.querySelector('[aria-label="Extrusion direction"]').value).toBe('line');expect(panel.querySelector('[aria-label="Direction sketch line"]').value).toBe(JSON.stringify(['guide',0,0]));
 select('Extrusion direction','normal');const before=apply.mock.calls.length;panel.querySelector('form').requestSubmit();await vi.waitFor(()=>expect(apply.mock.calls.length).toBeGreaterThan(before));expect(doc.features.at(-1)).not.toHaveProperty('directionReference');
});

it('authors thin open curves with document-unit wall controls, cancellation and mode switching',async()=>{
 const {applyDocumentUnits}=await import('./document-preferences');applyDocumentUnits({length:{unit:'in',decimals:4}});
 try {
  doc.features.push({id:'open',type:'profile',name:'Open path',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'drawing',contours:[{type:'path',start:[0,0],segments:[{type:'line',end:[20,0]}]}]}});
  const original=JSON.stringify(doc);
  mountFeatureAuthoring(()=>doc,apply);cadCommands.execute('feature-extrude');
  let panel=document.querySelector('.cad-feature-dialog');
  const tab=(name)=>[...panel.querySelectorAll('.aui-feature-tabs button')].find(b=>b.textContent===name).click();
  const change=(label,value)=>{const input=panel.querySelector(`[aria-label="${label}"]`);input.value=value;input.dispatchEvent(new Event('change'));};
  tab('Thin');change('Sketch','open');
  expect(panel.querySelector('[aria-label="Sketch curves"]').hidden).toBe(false);
  expect(panel.textContent).toContain('Curve 1 of Open path');
  expect(panel.querySelector('[aria-label="Sketch curves to extrude"]')).not.toBeNull();
  change('Thickness 1 (in)','.1');change('Thickness 2 (in)','.05');change('Thickness (in)','.2');
  panel.querySelector('input[aria-label="Mid plane"]').click();
  expect(panel.querySelector('[aria-label="Thickness 1 (in)"]').closest('.aui-feature-row').hidden).toBe(true);
  panel.querySelector('input[aria-label="Mid plane"]').click();
  expect(panel.querySelector('[aria-label="Thickness 1 (in)"]').value).toBe('.1');
  panel.querySelector('input[aria-label="Flip wall"]').click();
  panel.querySelector('[aria-label="Cancel"]').click();expect(JSON.stringify(doc)).toBe(original);expect(apply).not.toHaveBeenCalled();
  cadCommands.execute('feature-extrude');panel=document.querySelector('.cad-feature-dialog');tab('Thin');change('Sketch','open');
  change('Thickness 1 (in)','.1');change('Thickness 2 (in)','.05');change('Thickness (in)','.2');
  panel.querySelector('input[aria-label="Flip wall"]').click();panel.querySelector('form').requestSubmit();await vi.waitFor(()=>expect(apply).toHaveBeenCalledOnce());
  const feature=doc.features.at(-1);expect(feature.thin).toMatchObject({thickness1Millimeters:2.54,thickness2Millimeters:1.27,midplaneThicknessMillimeters:5.08,flipped:true,midplane:false});
  expect(feature.profileSelections[0].profileContourId).toBe(doc.features[0].profile.contours[0].id);
  window.dispatchEvent(new CustomEvent('aether-feature-action',{detail:{type:'item-action',actionID:'edit-feature',id:`feature/doc/${feature.id}`}}));panel=document.querySelector('.cad-feature-dialog');
  expect(panel.querySelector('[aria-label="Creation type"]').value).toBe('thin');expect(Number(panel.querySelector('[aria-label="Thickness 1 (in)"]').value)).toBe(.1);
  tab('Solid');expect(JSON.parse(panel.querySelector('[aria-label="Selected profiles"]').value)).toEqual([]);expect(panel.querySelector('[aria-label="Apply and rebuild"]').disabled).toBe(true);
  tab('Thin');expect(panel.textContent).toContain('Curve 1 of Open path');
  panel.querySelector('input[aria-label="Mid plane"]').click();panel.querySelector('form').requestSubmit();await vi.waitFor(()=>expect(apply).toHaveBeenCalledTimes(2));expect(doc.features.at(-1).thin.midplane).toBe(true);
 }finally{applyDocumentUnits({});}
});

it.each(['finished','selected'])('retains a %s open sketch when switching from Solid to Thin',async(source)=>{
 const {cadWorkspace}=await import('./cad-workspace-store');
 const original=cadWorkspace.snapshot();
 try {
 const {setPickedSketchRegion}=await import('./sketch-region-selection');
 doc.features.push({id:'open',name:'Open path',type:'profile',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'drawing',contours:[{type:'path',start:[0,0],segments:[{type:'line',end:[20,0]}]}]}});
 if(source==='finished')setPickedSketchRegion({featureId:'open',contourIndex:0});else cadWorkspace.publish({...original,selectedItemIDs:new Set(['feature/profile/open'])});mountFeatureAuthoring(()=>doc,apply);cadCommands.execute('feature-extrude');
 const panel=document.querySelector('.cad-feature-dialog');await new Promise(resolve=>queueMicrotask(resolve));
 expect(panel.querySelector('[aria-label="Sketch"]').value).toBe('open');expect(JSON.parse(panel.querySelector('[aria-label="Selected profiles"]').value)).toEqual([]);
 [...panel.querySelectorAll('.aui-feature-tabs button')].find(b=>b.textContent==='Thin').click();
 expect(JSON.parse(panel.querySelector('[aria-label="Selected profiles"]').value)).toEqual([{featureId:'open',contourIndex:0}]);
 expect(panel.querySelector('[aria-label="Apply and rebuild"]').disabled).toBe(false);
 }finally{cadWorkspace.publish(original);}
});

it('authors selected-part stops on both ends, preserves units and clears references when changing modes',async()=>{
 const {applyDocumentUnits}=await import('./document-preferences');const {cadSelection}=await import('./cad-selection-store');applyDocumentUnits({length:{unit:'in',decimals:4}});
 try{
  seedProfile();doc.features.push({id:'stop-s',name:'Stop sketch',type:'profile',plane:'XY',offsetMillimeters:20,suppressed:false,profile:{type:'circle',radiusMillimeters:30,centerMillimeters:[0,0]}},{id:'stop',name:'Stop',type:'extrude',profileFeatureId:'stop-s',bodyId:'stop-body',distanceMillimeters:3,operation:'new',suppressed:false});
  doc.bodyProperties={'stop-body':{name:'Roof',visible:true}};
  mountFeatureAuthoring(()=>doc,apply);cadCommands.execute('feature-extrude');let panel=document.querySelector('.cad-feature-dialog');
  const change=(label,value)=>{const input=panel.querySelector(`[aria-label="${label}"]`);input.value=value;input.dispatchEvent(new Event('change'));};
  const tab=text=>[...panel.querySelectorAll('.aui-feature-tabs button')].find(b=>b.textContent===text).click();
  change('Sketch','profile-1');tab('New');change('End condition','up-to-part');
  expect(panel.querySelector('[aria-label="Stopping part"]').textContent).toContain('Roof');expect(panel.querySelector('[aria-label="Apply and rebuild"]').disabled).toBe(true);
  cadSelection.dispatch({type:'replace',items:[{id:'face',kind:'face',partId:'stop-body',label:'Roof face'}]});panel.querySelector('[aria-label="Stopping part from selection"]').click();
  change('End offset (in)','.1');panel.querySelector('input[aria-label="Second end position"]').click();change('Opposite end condition','up-to-part');change('Opposite stopping part','stop-body');change('Opposite end offset (in)','-.05');
  const before=JSON.stringify(doc);panel.querySelector('[aria-label="Cancel"]').click();expect(JSON.stringify(doc)).toBe(before);
  cadCommands.execute('feature-extrude');panel=document.querySelector('.cad-feature-dialog');change('Sketch','profile-1');tab('New');change('End condition','up-to-part');change('Stopping part','stop-body');change('End offset (in)','.1');
  panel.querySelector('input[aria-label="Second end position"]').click();change('Opposite end condition','up-to-part');change('Opposite stopping part','stop-body');change('Opposite end offset (in)','-.05');
  expect(panel.querySelector('[aria-label="Apply and rebuild"]').disabled,panel.textContent).toBe(false);panel.querySelector('form').requestSubmit();await vi.waitFor(()=>expect(apply,panel.textContent).toHaveBeenCalledOnce());const feature=doc.features.at(-1);
  expect(feature).toMatchObject({endType:'up-to-part',endPartId:'stop-body',endOffsetMillimeters:2.54,secondEnd:{endType:'up-to-part',endPartId:'stop-body',endOffsetMillimeters:-1.27}});
  window.dispatchEvent(new CustomEvent('aether-feature-action',{detail:{type:'item-action',actionID:'edit-feature',id:`feature/doc/${feature.id}`}}));panel=document.querySelector('.cad-feature-dialog');expect(panel.querySelector('[aria-label="Stopping part"]').value).toBe('stop-body');expect(panel.querySelector('[aria-label="Opposite stopping part"]').value).toBe('stop-body');
  change('End condition','blind');change('Opposite end condition','blind');panel.querySelector('form').requestSubmit();await vi.waitFor(()=>expect(apply).toHaveBeenCalledTimes(2));expect(doc.features.at(-1)).not.toHaveProperty('endPartId');expect(doc.features.at(-1).secondEnd).not.toHaveProperty('endPartId');
 }finally{applyDocumentUnits({});cadSelection.dispatch({type:'clear'});}
});

it('authors stable stopping sketch points in document units, cancels atomically and clears inactive references',async()=>{
 const {applyDocumentUnits}=await import('./document-preferences');applyDocumentUnits({length:{unit:'in',decimals:4}});
 const {cadSelection}=await import('./cad-selection-store');cadSelection.dispatch({type:'set-filter',filter:'edge'});
 try{
  seedProfile();doc.features.unshift({id:'guide',name:'Guide',type:'profile',plane:'XZ',offsetMillimeters:0,suppressed:false,profile:{type:'drawing',contours:[{type:'path',construction:true,start:[0,0],segments:[{type:'line',end:[8,50]}]}]}});
  const original=JSON.stringify(doc);mountFeatureAuthoring(()=>doc,apply);cadCommands.execute('feature-extrude');let panel=document.querySelector('.cad-feature-dialog');
  const change=(label,value)=>{const input=panel.querySelector(`[aria-label="${label}"]`);input.value=value;input.dispatchEvent(new Event('change'));};
  const choose=()=>{const select=panel.querySelector('[aria-label="Stopping point sketch point"]');change('Stopping point sketch point',[...select.options].find(o=>o.textContent==='Guide · Point 1.2').value);};
  change('Sketch','profile-1');change('End condition','up-to-vertex');expect(cadSelection.snapshot().filter).toBe('vertex');choose();change('End offset (in)','.1');
  panel.querySelector('[aria-label="Cancel"]').click();expect(JSON.stringify(doc)).toBe(original);await vi.waitFor(()=>expect(cadSelection.snapshot().filter).toBe('edge'));
  cadCommands.execute('feature-extrude');panel=document.querySelector('.cad-feature-dialog');change('Sketch','profile-1');change('End condition','up-to-vertex');choose();change('End offset (in)','.1');
  panel.querySelector('form').requestSubmit();await vi.waitFor(()=>expect(apply).toHaveBeenCalledOnce());const feature=doc.features.at(-1),guide=doc.features[0].profile.contours[0];
  expect(feature).toMatchObject({endType:'up-to-vertex',endOffsetMillimeters:2.54,endPointReference:{kind:'sketch-point',contourId:guide.id,vertexId:guide.segments[0].endVertexId}});
  window.dispatchEvent(new CustomEvent('aether-feature-action',{detail:{type:'item-action',actionID:'edit-feature',id:`feature/doc/${feature.id}`}}));panel=[...document.querySelectorAll('.cad-feature-dialog')].at(-1);for(const other of document.querySelectorAll('.cad-feature-dialog'))if(other!==panel)other.remove();
  expect(panel.textContent).toContain('Guide · Point 1.2');expect(Number(panel.querySelector('[aria-label="End offset (in)"]').value)).toBe(.1);
  change('End condition','blind');panel.querySelector('form').requestSubmit();await vi.waitFor(()=>expect(apply).toHaveBeenCalledTimes(2));expect(doc.features.at(-1).endPointReference).toBeUndefined();
 }finally{applyDocumentUnits({});cadSelection.dispatch({type:'clear'});}
});

it('arbitrates solid vertex and opposite face picking and stores both references',async()=>{
 const {cadSelection}=await import('./cad-selection-store');cadSelection.dispatch({type:'set-filter',filter:'auto'});
 seedProfile();doc=insertFeature(doc,{id:'base',type:'extrude',name:'Base',profileFeatureId:'profile-1',distanceMillimeters:20,operation:'new',bodyId:'base',suppressed:false});
 const reference={kind:'solid-vertex',sourceFeatureId:'base',bodyId:'base',label:'Corner of Base',anchor:{positionMillimeters:[0,0,20],signature:'native-corner',incidence:'native-incidence',shapeFingerprint:'a'.repeat(64)}};
 const pointResponse=()=>window.dispatchEvent(new CustomEvent('aether-extrude-point',{detail:{reference}}));window.addEventListener('aether-extrude-point-request',pointResponse);
 const faceResponse=()=>window.dispatchEvent(new CustomEvent('aether-extrude-face',{detail:{support:{sourceFeatureId:'base',bodyId:'base',normal:[0,0,-1],label:'Bottom'}}}));window.addEventListener('aether-extrude-face-request',faceResponse);
 try{
  mountFeatureAuthoring(()=>doc,apply);cadCommands.execute('feature-extrude');const panel=[...document.querySelectorAll('.cad-feature-dialog')].at(-1);for(const other of document.querySelectorAll('.cad-feature-dialog'))if(other!==panel)other.remove();
  const change=(label,value)=>{const input=panel.querySelector(`[aria-label="${label}"]`);input.value=value;input.dispatchEvent(new Event('change'));};
  change('Operation','new');change('Sketch','profile-1');change('End condition','up-to-vertex');
  cadSelection.dispatch({type:'replace',items:[{id:'vertex:base:corner',partId:'base',kind:'vertex',label:'Corner'}]});expect(panel.textContent).toContain('Corner of Base');
  change('Use second end','true');change('Opposite end condition','up-to-face');expect(cadSelection.snapshot().filter).toBe('face');
  cadSelection.dispatch({type:'replace',items:[{id:'face:base:1',partId:'base',kind:'face',faceId:1,label:'Bottom'}]});expect(panel.textContent).toContain('Bottom');
  panel.querySelector('[aria-label="Stopping point selection"]').click();expect(cadSelection.snapshot().filter).toBe('vertex');
  cadSelection.dispatch({type:'replace',items:[{id:'vertex:base:corner',partId:'base',kind:'vertex',label:'Corner'}]});
  panel.querySelector('form').requestSubmit();await vi.waitFor(()=>expect(apply).toHaveBeenCalledOnce());expect(doc.features.at(-1)).toMatchObject({endPointReference:reference,secondEnd:{endType:'up-to-face',endReference:{label:'Bottom'}}});
  await vi.waitFor(()=>expect(cadSelection.snapshot().filter).toBe('auto'));
 }finally{window.removeEventListener('aether-extrude-point-request',pointResponse);window.removeEventListener('aether-extrude-face-request',faceResponse);cadSelection.dispatch({type:'clear'});}
});

it('creates, cancels, reopens and disables referenced starts with canonical offsets',async()=>{
 const {applyDocumentUnits}=await import('./document-preferences');applyDocumentUnits({length:{unit:'in',decimals:4}});
 try{
  seedProfile();doc.features.unshift({id:'datum',name:'Start datum',type:'plane',plane:'XY',offsetMillimeters:20,suppressed:false});
  const original=JSON.stringify(doc);cadCommands.execute('feature-extrude');let panel=document.querySelector('.cad-feature-dialog');
  const change=(label,value)=>{const input=panel.querySelector(`[aria-label="${label}"]`);input.value=value;input.dispatchEvent(new Event('change'));};
  const choose=()=>{change('Sketch','profile-1');change('Operation','new');change('Starting offset enabled','true');change('Starting offset type','plane');
   const select=panel.querySelector('select[aria-label="Starting reference plane"]');select.value=[...select.options].find(o=>o.textContent==='Start datum').value;select.dispatchEvent(new Event('change'));change('Starting offset (in)','-.1');};
  choose();panel.querySelector('[aria-label="Cancel"]').click();expect(JSON.stringify(doc)).toBe(original);
  cadCommands.execute('feature-extrude');panel=document.querySelector('.cad-feature-dialog');choose();panel.querySelector('form').requestSubmit();await vi.waitFor(()=>expect(apply).toHaveBeenCalledOnce());
  expect(doc.features.at(-1)).toMatchObject({startingReference:{kind:'plane',sourceFeatureId:'datum'},startingOffsetMillimeters:-2.54});
  doc.features[0].name='Renamed datum';
  window.dispatchEvent(new CustomEvent('aether-feature-action',{detail:{type:'item-action',actionID:'edit-feature',id:`feature/doc/${doc.features.at(-1).id}`}}));panel=document.querySelector('.cad-feature-dialog');
  expect(panel.querySelector('select[aria-label="Starting reference plane"]').selectedOptions[0].textContent).toBe('Renamed datum');
  expect(Number(panel.querySelector('[aria-label="Starting offset (in)"]').value)).toBe(-.1);
  change('Starting offset enabled','false');panel.querySelector('form').requestSubmit();await vi.waitFor(()=>expect(apply).toHaveBeenCalledTimes(2));
  expect(doc.features.at(-1)).not.toHaveProperty('startingReference');expect(doc.features.at(-1)).not.toHaveProperty('startingOffsetMillimeters');
 }finally{applyDocumentUnits({});}
});

it('keeps start and stop face pickers independent and restores the selection filter',async()=>{
 const {cadSelection}=await import('./cad-selection-store');cadSelection.dispatch({type:'set-filter',filter:'edge'});
 seedProfile();doc=insertFeature(doc,{id:'base',type:'extrude',name:'Base',profileFeatureId:'profile-1',distanceMillimeters:20,operation:'new',bodyId:'base',suppressed:false});
 let normal=[0,0,1],label='Top start';
 const response=()=>window.dispatchEvent(new CustomEvent('aether-sketch-face',{detail:{support:{sourceFeatureId:'base',bodyId:'base',normal,label}}}));window.addEventListener('aether-sketch-face-request',response);const stopResponse=()=>window.dispatchEvent(new CustomEvent('aether-extrude-face',{detail:{support:{sourceFeatureId:'base',bodyId:'base',normal,label}}}));window.addEventListener('aether-extrude-face-request',stopResponse);
 try{
  cadCommands.execute('feature-extrude');const panel=document.querySelector('.cad-feature-dialog');
  const change=(label,value)=>{const input=panel.querySelector(`[aria-label="${label}"]`);input.value=value;input.dispatchEvent(new Event('change'));};
  change('Sketch','profile-1');change('Operation','new');change('Starting offset enabled','true');change('Starting offset type','face');
  expect(cadSelection.snapshot().filter).toBe('face');cadSelection.dispatch({type:'replace',items:[{id:'face:base:1',partId:'base',kind:'face',faceId:1,label}]});
  expect(panel.textContent).toContain('Top start');
  change('End condition','up-to-face');normal=[0,0,-1];label='Bottom stop';
  panel.querySelector('[aria-label="End face selection"]').click();cadSelection.dispatch({type:'replace',items:[{id:'face:base:2',partId:'base',kind:'face',faceId:2,label}]});
  panel.querySelector('form').requestSubmit();await vi.waitFor(()=>expect(apply).toHaveBeenCalledOnce());
  expect(doc.features.at(-1)).toMatchObject({startingReference:{kind:'face',label:'Top start',normal:[0,0,1]},endReference:{label:'Bottom stop',normal:[0,0,-1]}});
  await vi.waitFor(()=>expect(cadSelection.snapshot().filter).toBe('edge'));
 }finally{window.removeEventListener('aether-sketch-face-request',response);window.removeEventListener('aether-extrude-face-request',stopResponse);cadSelection.dispatch({type:'clear'});}
});

it('defaults new modifications to automatic scope, keeps explicit selection opt-in and cancels atomically',async()=>{
 seedProfile();for(const id of ['first','second'])doc=insertFeature(doc,{id,type:'extrude',name:id,profileFeatureId:'profile-1',distanceMillimeters:10,operation:'new',bodyId:id,suppressed:false});
 const original=JSON.stringify(doc);cadCommands.execute('feature-extrude');let panel=document.querySelector('.cad-feature-dialog');
 const change=(label,value)=>{const c=panel.querySelector(`[aria-label="${label}"]`);c.value=value;c.dispatchEvent(new Event('change'));};
 change('Sketch','profile-1');change('Operation','add');expect(panel.querySelector('[aria-label="Merge with all"]').checked).toBe(true);
 expect(panel.querySelector('[aria-label="Target body"]').closest('.aui-feature-row').hidden).toBe(true);
 panel.querySelector('[aria-label="Merge with all"]').click();expect(panel.querySelector('[aria-label="Target body"]').closest('.aui-feature-row').hidden).toBe(false);
 panel.querySelector('[aria-label="Cancel"]').click();expect(JSON.stringify(doc)).toBe(original);
 cadCommands.execute('feature-extrude');panel=document.querySelector('.cad-feature-dialog');change('Sketch','profile-1');change('Operation','add');panel.querySelector('form').requestSubmit();await vi.waitFor(()=>expect(apply).toHaveBeenCalledOnce());
 expect(doc.features.at(-1)).toMatchObject({scopeMode:'all',operation:'add'});expect(doc.features.at(-1)).not.toHaveProperty('targetBodyId');expect(doc.features.at(-1)).not.toHaveProperty('targetBodyIds');
 window.dispatchEvent(new CustomEvent('aether-feature-action',{detail:{type:'item-action',actionID:'edit-feature',id:`feature/doc/${doc.features.at(-1).id}`}}));panel=document.querySelector('.cad-feature-dialog');expect(panel.querySelector('[aria-label="Merge with all"]').checked).toBe(true);
 change('Operation','new');panel.querySelector('form').requestSubmit();await vi.waitFor(()=>expect(apply).toHaveBeenCalledTimes(2));expect(doc.features.at(-1)).not.toHaveProperty('scopeMode');expect(doc.features.at(-1)).not.toHaveProperty('scopeResolution');
});

it.each(['removed','suppressed'])('defaults to New when the previous solid is %s',state=>{
 seedProfile();doc=insertFeature(doc,{id:'first',type:'extrude',name:'First',profileFeatureId:'profile-1',distanceMillimeters:10,operation:'new',bodyId:'first',suppressed:state==='suppressed'});
 if(state==='removed')doc=insertFeature(doc,{id:'remove',type:'extrude',name:'Remove all',profileFeatureId:'profile-1',distanceMillimeters:10,operation:'cut',scopeMode:'all',scopeResolution:{targets:['first'],groups:[]},suppressed:false});
 cadCommands.execute('feature-extrude');const panel=document.querySelector('.cad-feature-dialog');
 expect(panel.querySelector('[aria-label="Operation"]').value).toBe('new');panel.querySelector('[aria-label="Cancel"]').click();
});

it.each([false,true])('authors a curved stopping face on either end, cancels and restores selection (opposite=%s)',async opposite=>{
 const {cadSelection}=await import('./cad-selection-store');
 seedProfile();doc=insertFeature(doc,{id:'stop',type:'extrude',name:'Cylinder',profileFeatureId:'profile-1',operation:'new',bodyId:'stop',distanceMillimeters:20,suppressed:false});
 const original=JSON.stringify(doc),reference={sourceFeatureId:'stop',bodyId:'stop',surfaceType:'cylinder',label:'Cylinder surface'};
 cadSelection.dispatch({type:'set-filter',filter:'edge'});
 const respond=()=>window.dispatchEvent(new CustomEvent('aether-extrude-face',{detail:{support:reference}}));window.addEventListener('aether-extrude-face-request',respond);
 try{
  for(const commit of [false,true]){
   cadCommands.execute('feature-extrude');const panel=document.querySelector('.cad-feature-dialog');
   const change=(label,value)=>{const e=panel.querySelector(`[aria-label="${label}"]`);e.value=value;e.dispatchEvent(new Event('change'));};
   change('Sketch','profile-1');change('Operation','new');
   if(opposite){change('Use second end','true');change('Opposite end condition','up-to-face');}else change('End condition','up-to-face');
   cadSelection.dispatch({type:'replace',items:[{id:'face:stop:1',partId:'stop',kind:'face',faceId:1,label:'Cylinder'}]});
   expect(panel.textContent).toContain('Cylinder surface');expect(cadSelection.snapshot().filter).toBe('face');
   if(commit){panel.querySelector('form').requestSubmit();await vi.waitFor(()=>expect(apply).toHaveBeenCalledOnce());const f=doc.features.at(-1);expect(opposite?f.secondEnd.endReference:f.endReference).toEqual(reference);}
   else {panel.querySelector('[aria-label="Cancel"]').click();expect(JSON.stringify(doc)).toBe(original);}
   await vi.waitFor(()=>expect(cadSelection.snapshot().filter).toBe('edge'));cadSelection.dispatch({type:'clear'});
  }
 }finally{window.removeEventListener('aether-extrude-face-request',respond);cadSelection.dispatch({type:'set-filter',filter:'auto'});cadSelection.dispatch({type:'clear'});}
});

it('authors multiple planar and curved face offsets in document units without duplicate scope',async()=>{
 const {cadSelection}=await import('./cad-selection-store');
 const {applyDocumentUnits,documentUnits}=await import('./document-preferences');
 const units=documentUnits(),filter=cadSelection.snapshot().filter;
 seedProfile();doc=insertFeature(doc,{id:'pad',type:'extrude',name:'Base',profileFeatureId:'profile-1',distanceMillimeters:10,operation:'new',bodyId:'base',suppressed:false});
 const faces=[{sourceFeatureId:'pad',bodyId:'base',normal:[0,0,1],label:'Top'}, {sourceFeatureId:'pad',bodyId:'base',surfaceType:'cylinder',label:'Wall'}];
 try{
  applyDocumentUnits({length:{unit:'in',decimals:3}});cadSelection.dispatch({type:'clear'});
  mountFeatureAuthoring(()=>doc,apply);cadCommands.execute('feature-offset-face');
  const panel=document.querySelector('.cad-feature-dialog');expect(panel.querySelector('.aui-feature-accept').disabled).toBe(true);
  window.dispatchEvent(new CustomEvent('aether-offset-faces',{detail:{faces}}));
  window.dispatchEvent(new CustomEvent('aether-offset-faces',{detail:{faces:[faces[0]]}}));
  expect(JSON.parse(panel.querySelector('[aria-label="Offset face references"]').value)).toHaveLength(2);
  const offset=panel.querySelector('[aria-label="Offset (in)"]');offset.value='-0.25';offset.dispatchEvent(new Event('input'));
  panel.querySelector('form').requestSubmit();await vi.waitFor(()=>expect(apply).toHaveBeenCalledTimes(1));
  expect(doc.features.at(-1)).toMatchObject({type:'offset-face',faces,distanceMillimeters:-6.35});expect(doc.features.at(-1)).not.toHaveProperty('targetBodyId');
  await vi.waitFor(()=>expect(cadSelection.snapshot().filter).toBe(filter));
 }finally{applyDocumentUnits(units);cadSelection.dispatch({type:'clear'});}
});

it('clears face offsets and cancels edits without changing the saved feature',async()=>{
 seedProfile();doc=insertFeature(doc,{id:'pad',type:'extrude',name:'Base',profileFeatureId:'profile-1',distanceMillimeters:10,operation:'new',bodyId:'base',suppressed:false});
 doc=insertFeature(doc,{id:'offset',type:'offset-face',name:'Offset faces',suppressed:false,distanceMillimeters:2,faces:[{sourceFeatureId:'pad',bodyId:'base',normal:[0,0,1],label:'Top'}]});
 const original=structuredClone(doc);mountFeatureAuthoring(()=>doc,apply);
 window.dispatchEvent(new CustomEvent('aether-feature-action',{detail:{type:'item-action',actionID:'edit-feature',id:'feature/offset-face/offset'}}));
 const panel=document.querySelector('.cad-feature-dialog');expect(panel.textContent).toContain('Top');
 [...panel.querySelectorAll('button')].find(b=>b.textContent==='Clear faces').click();
 expect(panel.querySelector('.aui-feature-accept').disabled).toBe(true);
 panel.querySelector('[aria-label="Cancel"]').click();expect(doc).toEqual(original);expect(apply).not.toHaveBeenCalled();
});

it('uses current face selection requests and cleans up offset picking on close',async()=>{
 const {cadSelection}=await import('./cad-selection-store');
 seedProfile();doc=insertFeature(doc,{id:'pad',type:'extrude',name:'Base',profileFeatureId:'profile-1',distanceMillimeters:10,operation:'new',bodyId:'base',suppressed:false});
 cadSelection.dispatch({type:'clear'});const request=vi.fn();window.addEventListener('aether-offset-faces-request',request);
 try{
  mountFeatureAuthoring(()=>doc,apply);cadCommands.execute('feature-offset-face');
  cadSelection.dispatch({type:'replace',items:[{id:'face',kind:'face',partId:'base',faceId:1,label:'Top'}]});
  expect(request).toHaveBeenCalledTimes(1);
  const panel=document.querySelector('.cad-feature-dialog');panel.querySelector('[aria-label="Cancel"]').click();await new Promise(resolve=>setTimeout(resolve,0));
  cadSelection.dispatch({type:'replace',items:[{id:'other',kind:'face',partId:'base',faceId:2,label:'Other'}]});expect(request).toHaveBeenCalledTimes(1);
 }finally{window.removeEventListener('aether-offset-faces-request',request);cadSelection.dispatch({type:'clear'});}
});


it.each(['translate','rotate','scale','copy'])('authors solid transform %s with native parameters and stable copies',async mode=>{
 seedProfile();doc=insertFeature(doc,{id:'base',type:'extrude',name:'Base',profileFeatureId:'profile-1',operation:'new',bodyId:'body',distanceMillimeters:10,suppressed:false});
 const body=(await import('@aether/core/document')).availableBodies(doc)[0].id;
 cadCommands.execute(`transform-${mode}`);const panel=document.querySelector('.cad-feature-dialog');
 const change=(label,value)=>{const e=panel.querySelector(`[aria-label="${label}"]`);expect(e).toBeTruthy();e.value=value;e.dispatchEvent(new Event('change'));};
 panel.querySelector('[aria-label="Transform Body 1"]').click();
 expect(panel.querySelector('[aria-label="Transform type"]').value).toBe(mode);
 if(mode==='translate'){change('Translation X (mm)','12');change('Translation Y (mm)','-3');change('Copy parts','yes');}
 if(mode==='rotate'){change('Axis direction Z','2');change('Angle (deg)','90');}
 if(mode==='scale'){change('Uniform scale','no');change('Scale factor X','2');change('Scale factor Y','.5');change('Scale factor Z','3');}
 const outputs=JSON.parse(panel.querySelector('[aria-label="Copy output IDs"]').value);
 panel.querySelector('[aria-label="Apply and rebuild"]').click();await vi.waitFor(()=>expect(doc.features.at(-1).type).toBe('transform'));
 const f=doc.features.at(-1);expect(f.bodyIds).toEqual([body]);expect(f).not.toHaveProperty('targetBodyId');
 if(mode==='translate')expect(f.transform).toEqual({kind:'translate',translationMillimeters:[12,-3,0]});
 if(mode==='rotate')expect(f.transform).toMatchObject({kind:'rotate',axisDirection:[0,0,1],angleDegrees:90});
 if(mode==='scale')expect(f.transform.scaleFactors).toEqual([2,.5,3]);
 if(mode==='copy'||mode==='translate')expect(f.copyBodyIds).toEqual({[body]:outputs[body]});else expect(f.copyBodyIds).toBeUndefined();
});
it('converts transform distances from inches, restores picking mode and keeps Cancel unchanged',async()=>{
 const {cadSelection}=await import('./cad-selection-store');const {applyDocumentUnits}=await import('./document-preferences');
 seedProfile();doc=insertFeature(doc,{id:'base',type:'extrude',name:'Base',profileFeatureId:'profile-1',operation:'new',bodyId:'body',distanceMillimeters:10,suppressed:false});const before=structuredClone(doc);
 applyDocumentUnits({length:{unit:'in',decimals:4}});cadSelection.dispatch({type:'set-filter',filter:'edge'});
 try{
  cadCommands.execute('transform-translate');const panel=document.querySelector('.cad-feature-dialog');panel.querySelector('[aria-label="Transform Body 1"]').click();
  const field=panel.querySelector('[aria-label="Translation X (in)"]');field.value='1';field.dispatchEvent(new Event('change'));
  expect(cadSelection.snapshot().filter).toBe('body');panel.querySelector('[aria-label="Apply and rebuild"]').click();await vi.waitFor(()=>expect(doc.features.at(-1).type).toBe('transform'));
  expect(doc.features.at(-1).transform.translationMillimeters[0]).toBe(25.4);await vi.waitFor(()=>expect(cadSelection.snapshot().filter).toBe('edge'));
  cadCommands.execute('transform-scale');document.querySelector('[aria-label="Cancel"]').click();await vi.waitFor(()=>expect(cadSelection.snapshot().filter).toBe('edge'));
  expect(doc.features.slice(0,-1)).toEqual(before.features);
 }finally{applyDocumentUnits({length:{unit:'mm',decimals:3}});}
});

it.each(['translate-reference','rotate-reference','scale-reference'])('authors associative %s with stable identities and restores its controls on edit',async mode=>{
 seedProfile();doc=insertFeature(doc,{id:'base',type:'extrude',name:'Base',profileFeatureId:'profile-1',operation:'new',bodyId:'body',distanceMillimeters:10,suppressed:false});
 doc=insertFeature(doc,{id:'guide',type:'profile',name:'Guide',plane:'XZ',offsetMillimeters:0,suppressed:false,profile:{type:'drawing',contours:[{type:'path',construction:true,start:[1,2],segments:[{type:'line',end:[4,6]}]}]}});
 cadCommands.execute('transform-translate');let panel=document.querySelector('.cad-feature-dialog');
 const change=(label,value)=>{const e=panel.querySelector(`[aria-label="${label}"]`);expect(e).toBeTruthy();e.value=value;e.dispatchEvent(new Event('change'));};
 panel.querySelector('[aria-label="Transform Body 1"]').click();change('Transform type',mode);
 if(mode==='scale-reference'){
  const picker=panel.querySelector('[aria-label="Scale about point sketch point"]');change('Scale about point sketch point',[...picker.options].find(o=>o.textContent==='Guide · Point 1.2').value);change('Scale factor X','2');
 }else{
  const picker=panel.querySelector('[aria-label="Transform sketch line"]');change('Transform sketch line',[...picker.options].find(o=>o.textContent.startsWith('Guide ·')).value);
  if(mode==='translate-reference'){change('Specify distance','yes');change('Translation distance (mm)','-12');change('Reverse reference direction','yes');}
  else change('Angle (deg)','90');
 }
 panel.querySelector('[aria-label="Apply and rebuild"]').click();await vi.waitFor(()=>expect(apply).toHaveBeenCalledOnce());
 const saved=structuredClone(doc.features.at(-1));expect(saved.transform.kind).toBe(mode);expect(doc.features.find(f=>f.id==='guide').profile.contours[0].id).toBeTruthy();
 if(mode==='scale-reference')expect(saved.transform).toMatchObject({centerReference:{sourceFeatureId:'guide',point:'vertex'},scaleFactors:[2,2,2]});
 else {expect(saved.transform.reference).toMatchObject({kind:'sketch-line',sourceFeatureId:'guide'});if(mode==='translate-reference')expect(saved.transform).toMatchObject({distanceMillimeters:-12,reversed:true});}
 window.dispatchEvent(new CustomEvent('aether-feature-action',{detail:{type:'item-action',actionID:'edit-feature',id:`feature/transform/${saved.id}`}}));panel=document.querySelector('.cad-feature-dialog');expect(panel.querySelector('[aria-label="Transform type"]').value).toBe(mode);
 panel.querySelector('[aria-label="Cancel"]').click();expect(doc.features.at(-1)).toEqual(saved);
});
it('selects ordered sketch points without adding their owning body and leaves Cancel unchanged',async()=>{
 const{cadSelection}=await import('./cad-selection-store');seedProfile();doc=insertFeature(doc,{id:'base',type:'extrude',name:'Base',profileFeatureId:'profile-1',operation:'new',bodyId:'body',distanceMillimeters:10,suppressed:false});
 doc=insertFeature(doc,{id:'other-body',type:'extrude',name:'Other part',profileFeatureId:'profile-1',operation:'new',bodyId:'other-part',distanceMillimeters:10,suppressed:false});
 doc=insertFeature(doc,{id:'point-guide',type:'profile',name:'Point guide',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'drawing',contours:[{type:'path',construction:true,start:[0,0],segments:[{type:'line',end:[3,4]}]}]}});
 const before=structuredClone(doc),oldFilter=cadSelection.snapshot().filter;
 cadCommands.execute('transform-translate');const panel=document.querySelector('.cad-feature-dialog');const change=(label,value)=>{const e=panel.querySelector(`[aria-label="${label}"]`);e.value=value;e.dispatchEvent(new Event('change'));};
 panel.querySelector('[aria-label="Transform Body 1"]').click();change('Transform type','translate-reference');change('Transform reference','points');
 const choose=(label,index)=>{const select=panel.querySelector(`[aria-label="${label}"]`);change(label,select.options[index].value);};choose('Transform from point sketch point',2);choose('Transform to point sketch point',3);
 expect(JSON.parse(panel.querySelector('[aria-label="From point reference"]').value).index).not.toBe(JSON.parse(panel.querySelector('[aria-label="To point reference"]').value).index);
 cadSelection.dispatch({type:'replace',items:[{id:'vertex-other',kind:'vertex',partId:'other-part',faceId:1,label:'Other corner'}]});
 expect(JSON.parse(panel.querySelector('[aria-label="Transform part IDs"]').value)).toEqual(['body']);
 panel.querySelector('[aria-label="Cancel"]').click();await vi.waitFor(()=>expect(cadSelection.snapshot().filter).toBe(oldFilter));expect(doc).toEqual(before);
});

it.each(['translate-reference','rotate-reference'])('picks a solid edge for %s, preserves part scope and reopens saved identity',async mode=>{
 const{cadSelection}=await import('./cad-selection-store');seedProfile();
 doc=insertFeature(doc,{id:'base',type:'extrude',name:'Base',profileFeatureId:'profile-1',operation:'new',bodyId:'body',distanceMillimeters:10,suppressed:false});
 doc=insertFeature(doc,{id:'other',type:'extrude',name:'Other',profileFeatureId:'profile-1',operation:'new',bodyId:'other-body',distanceMillimeters:15,suppressed:false});
 const anchor=z=>({positionMillimeters:[0,0,z],signature:'native-'+z,incidence:'incidence-'+z,shapeFingerprint:'a'.repeat(64)});
 const reference={kind:'solid-edge',sourceFeatureId:'other',bodyId:'other-body',label:'Other vertical edge',anchor:{start:anchor(0),end:anchor(15)}};
 const request=vi.fn(),old=cadSelection.snapshot().filter;window.addEventListener('aether-transform-edge-request',request);
 try{
  cadCommands.execute('transform-translate');let panel=document.querySelector('.cad-feature-dialog');
  const change=(label,value)=>{const e=panel.querySelector(`[aria-label="${label}"]`);e.value=value;e.dispatchEvent(new Event('change'));};
  panel.querySelector('[aria-label="Transform Body 1"]').click();change('Transform type',mode);change('Transform reference','edge');
  expect(cadSelection.snapshot().filter).toBe('edge');expect(panel.querySelector('[aria-label="Apply and rebuild"]').disabled).toBe(true);
  cadSelection.dispatch({type:'replace',items:[{id:'edge:other-body:edge-1',kind:'edge',partId:'other-body',faceId:1,label:'Edge'}]});expect(request).toHaveBeenCalledOnce();
  window.dispatchEvent(new CustomEvent('aether-transform-edge',{detail:{error:'Select a straight edge, not a curve.'}}));expect(panel.textContent).toContain('not a curve');expect(panel.querySelector('[aria-label="Transform edge reference"]').value).toBe('');
  window.dispatchEvent(new CustomEvent('aether-transform-edge',{detail:{reference}}));expect(JSON.parse(panel.querySelector('[aria-label="Transform part IDs"]').value)).toEqual(['body']);
  if(mode==='translate-reference'){change('Specify distance','yes');change('Translation distance (mm)','-12');change('Reverse reference direction','yes');}else change('Angle (deg)','90');
  change('Transform reference','points');expect(cadSelection.snapshot().filter).toBe('vertex');change('Transform reference','edge');expect(cadSelection.snapshot().filter).toBe('edge');
  panel.querySelector('[aria-label="Apply and rebuild"]').click();await vi.waitFor(()=>expect(apply).toHaveBeenCalledOnce());await vi.waitFor(()=>expect(cadSelection.snapshot().filter).toBe(old));
  const saved=structuredClone(doc.features.at(-1));expect(saved.transform.reference).toEqual(reference);
  window.dispatchEvent(new CustomEvent('aether-feature-action',{detail:{type:'item-action',actionID:'edit-feature',id:`feature/transform/${saved.id}`}}));panel=document.querySelector('.cad-feature-dialog');
  expect(panel.querySelector('[aria-label="Transform reference"]').value).toBe('edge');expect(panel.textContent).toContain('Other vertical edge');
  const remove=[...panel.querySelectorAll('button')].find(e=>e.getAttribute('aria-label')?.includes('Remove Other vertical edge'));expect(remove).toBeTruthy();remove.click();expect(panel.querySelector('[aria-label="Apply and rebuild"]').disabled).toBe(true);
  panel.querySelector('[aria-label="Cancel"]').click();expect(doc.features.at(-1)).toEqual(saved);await vi.waitFor(()=>expect(cadSelection.snapshot().filter).toBe(old));
  const count=request.mock.calls.length;cadSelection.dispatch({type:'replace',items:[{id:'edge:body:later',kind:'edge',partId:'body',faceId:1,label:'Later'}]});expect(request).toHaveBeenCalledTimes(count);
 }finally{window.removeEventListener('aether-transform-edge-request',request);cadSelection.dispatch({type:'clear'});}
});

it.each(['translate','rotate','translate-reference','rotate-reference'])('authors face %s without offset semantics and reopens it',async mode=>{
 const{cadSelection}=await import('./cad-selection-store');seedProfile();doc=insertFeature(doc,{id:'base',type:'extrude',name:'Base',profileFeatureId:'profile-1',operation:'new',bodyId:'body',distanceMillimeters:10,suppressed:false});
 doc=insertFeature(doc,{id:'guide',type:'profile',name:'Guide',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'drawing',contours:[{id:'path',type:'path',construction:true,start:[0,0],segments:[{id:'line',type:'line',end:[3,4]}]}]}});
 const old=cadSelection.snapshot().filter;cadCommands.execute('feature-offset-face');let panel=document.querySelector('.cad-feature-dialog');
 const change=(label,value)=>{const e=panel.querySelector(`[aria-label="${label}"]`);expect(e).toBeTruthy();e.value=value;e.dispatchEvent(new Event('change'));};
 window.dispatchEvent(new CustomEvent('aether-offset-faces',{detail:{faces:[{sourceFeatureId:'base',bodyId:'body',normal:[0,0,1],label:'Top'}]}}));change('Face operation',mode);
 if(mode==='translate'){change('Translation X (mm)','2');change('Translation Z (mm)','3');}
 if(mode.startsWith('rotate')){change('Angle (deg)','15');}
 if(mode.endsWith('reference')){const select=panel.querySelector('[aria-label="Transform sketch line"]');change('Transform sketch line',[...select.options].find(o=>o.textContent.startsWith('Guide ·')).value);}
 if(mode==='translate-reference'){change('Specify distance','yes');change('Translation distance (mm)','-10');change('Reverse reference direction','yes');}
 expect(panel.querySelector('[aria-label="Offset (mm)"]').closest('.aui-feature-row').hidden).toBe(true);
 panel.querySelector('[aria-label="Apply and rebuild"]').click();await vi.waitFor(()=>expect(apply).toHaveBeenCalledOnce());
 const saved=structuredClone(doc.features.at(-1));expect(saved).not.toHaveProperty('distanceMillimeters');expect(saved.transform.kind).toBe(mode);await vi.waitFor(()=>expect(cadSelection.snapshot().filter).toBe(old));
 window.dispatchEvent(new CustomEvent('aether-feature-action',{detail:{type:'item-action',actionID:'edit-feature',id:`feature/offset-face/${saved.id}`}}));panel=document.querySelector('.cad-feature-dialog');expect(panel.querySelector('[aria-label="Face operation"]').value).toBe(mode);
 change('Face operation','offset');expect(panel.querySelector('[aria-label="Offset (mm)"]').closest('.aui-feature-row').hidden).toBe(false);panel.querySelector('[aria-label="Cancel"]').click();expect(doc.features.at(-1)).toEqual(saved);
 await vi.waitFor(()=>expect(cadSelection.snapshot().filter).toBe(old));
});

it('arbitrates face and edge reference picking without adding unwanted faces',async()=>{
 const{cadSelection}=await import('./cad-selection-store');seedProfile();doc=insertFeature(doc,{id:'base',type:'extrude',name:'Base',profileFeatureId:'profile-1',operation:'new',bodyId:'body',distanceMillimeters:10,suppressed:false});const before=structuredClone(doc);
 cadCommands.execute('feature-offset-face');const panel=document.querySelector('.cad-feature-dialog');const change=(label,value)=>{const e=panel.querySelector(`[aria-label="${label}"]`);e.value=value;e.dispatchEvent(new Event('change'));};
 const face={sourceFeatureId:'base',bodyId:'body',normal:[0,0,1],label:'Top'};window.dispatchEvent(new CustomEvent('aether-offset-faces',{detail:{faces:[face]}}));change('Face operation','rotate-reference');change('Transform reference','edge');expect(cadSelection.snapshot().filter).toBe('edge');
 window.dispatchEvent(new CustomEvent('aether-offset-faces',{detail:{faces:[{...face,normal:[1,0,0],label:'Side'}]}}));expect(JSON.parse(panel.querySelector('[aria-label="Offset face references"]').value)).toEqual([face]);
 panel.querySelector('[aria-label="Add offset faces"]').click();expect(cadSelection.snapshot().filter).toBe('face');
 panel.querySelector('[aria-label="Transform edge selection"]').click();expect(cadSelection.snapshot().filter).toBe('edge');
 panel.querySelector('[aria-label="Cancel"]').click();expect(doc).toEqual(before);
});

it('applies and reopens a connected region in the approved Extrude window without losing its sources', async () => {
  seedConnectedProfile();
  const feature = await authored('extrude', {Sketch:'joined'});
  expect(feature.profileRegion.contourIds).toHaveLength(4);
  expect(feature.profileSelections).toEqual([{profileFeatureId:'joined',profileRegion:feature.profileRegion}]);
  expect(doc.features[0].profile.contours).toHaveLength(4);
  const sources = [...feature.profileRegion.contourIds];
  window.dispatchEvent(new CustomEvent('aether-feature-action',{detail:{type:'item-action',actionID:'edit-feature',id:`feature/extrude/${feature.id}`}}));
  const panel = document.querySelector('.cad-feature-dialog');
  expect(panel.querySelectorAll('.aui-feature-entity')).toHaveLength(1);
  expect(JSON.parse(panel.querySelector('[aria-label="Selected profiles"]').value)).toEqual([{featureId:'joined',contourIndex:0}]);
  const before = apply.mock.calls.length;
  panel.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  await vi.waitFor(()=>expect(apply.mock.calls.length).toBe(before+1));
  expect(doc.features.at(-1).profileRegion.contourIds).toEqual(sources);
});

it('keeps joined-region preview identity changes out of the document on Cancel', async () => {
  seedConnectedProfile(); const before = structuredClone(doc);
  cadCommands.execute('feature-extrude');
  const panel = document.querySelector('.cad-feature-dialog'), source = panel.querySelector('[aria-label="Sketch"]');
  source.value='joined'; source.dispatchEvent(new Event('change'));
  expect(panel.querySelectorAll('.aui-feature-entity')).toHaveLength(1);
  panel.querySelector('[aria-label="Cancel"]').click();
  expect(doc).toEqual(before); expect(apply).not.toHaveBeenCalled();
});

it('uses the same saved connected-region selection for Revolve', async () => {
  seedConnectedProfile();
  const feature = await authored('revolve', {Sketch:'joined',Axis:'X'});
  expect(feature.profileRegion.contourIds).toHaveLength(4);
  expect(feature.profileContourId).toBeUndefined();
  expect(doc.features[0].profile.contours.map(c=>c.id)).toEqual(expect.arrayContaining(feature.profileRegion.contourIds));
});

it('sweeps a joined profile while keeping its path an individual curve', async () => {
  seedConnectedProfile();
  doc=insertFeature(doc,{id:'path',type:'profile',name:'Spine',plane:'XZ',offsetMillimeters:0,suppressed:false,
    profile:{type:'drawing',contours:[{type:'path',start:[0,0],segments:[{type:'line',end:[0,20]}]}]}});
  const feature=await authored('sweep',{'Sketch Profile':'joined','Sweep Path':'path'});
  expect(feature.profileRegion.contourIds).toHaveLength(4);
  expect(feature.pathFeatureId).toBe('path');expect(feature.profileContourId).toBeUndefined();
  const {translateDocument}=await import('./freecad-translate');
  const job=translateDocument(doc);expect(job.complete).toBe(true);
  const path=job.features.find(f=>f.id===job.features.at(-1).parameters.path);
  expect(path).toMatchObject({id:'path',kind:'sketch-wire'});
  window.dispatchEvent(new CustomEvent('aether-feature-action',{detail:{type:'item-action',actionID:'edit-feature',id:`feature/sweep/${feature.id}`}}));
  const panel=document.querySelector('.cad-feature-dialog');
  expect(panel.querySelector('[aria-label="Region"]').value).toBe('0');
  const before=structuredClone(doc);panel.querySelector('[aria-label="Cancel"]').click();expect(doc).toEqual(before);
});

it('stores and restores joined Loft sections without flattening the source sketches', async () => {
  seedConnectedProfile();
  const top=structuredClone(doc.features[0]);top.id='top';top.name='Top joined sketch';top.offsetMillimeters=20;
  doc=insertFeature(doc,top);cadCommands.execute('feature-loft');
  let panel=document.querySelector('.cad-feature-dialog');
  const source=panel.querySelector('[aria-label="Section sketch"]');
  for(const id of ['joined','top']) {
    source.value=id;source.dispatchEvent(new Event('change'));
    [...panel.querySelectorAll('button')].find(button=>button.textContent==='Add section').click();
  }
  panel.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  await vi.waitFor(()=>expect(apply).toHaveBeenCalledOnce());
  const feature=structuredClone(doc.features.at(-1));
  expect(feature.sections.map(s=>s.profileRegion.contourIds.length)).toEqual([4,4]);
  expect(doc.features.slice(0,2).map(s=>s.profile.contours.length)).toEqual([4,4]);
  panel.querySelector('[aria-label="Cancel"]')?.click();
  window.dispatchEvent(new CustomEvent('aether-feature-action',{detail:{type:'item-action',actionID:'edit-feature',id:`feature/loft/${feature.id}`}}));
  panel=document.querySelector('.cad-feature-dialog');
  expect([...panel.querySelector('[aria-label="Loft section order"]').options].every(o=>!o.textContent.includes('Missing'))).toBe(true);
  panel.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  await vi.waitFor(()=>expect(apply).toHaveBeenCalledTimes(2));
  expect(doc.features.at(-1).sections).toEqual(feature.sections);
});
