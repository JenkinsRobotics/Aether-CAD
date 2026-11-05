import { createRequire } from "node:module";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createEmptyPartDocument, insertFeature } from "@aether/core/document";
import { configureFeaturePreview } from './modeling/feature-preview';

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
    else if (value === "<first option>") control.value = [...control.options].find((option) => option.value)?.value ?? "";
    else control.value = value;
    control.dispatchEvent(new dom.window.Event("change"));
  }
  const before = apply.mock.calls.length;
  form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  // Wait for THIS commit, not any earlier one, or a blocked submit silently
  // returns the previously authored feature.
  await vi.waitFor(() => {
    if (apply.mock.calls.length <= before) {
      const why = [...document.querySelectorAll('.aui-feature-error,[role="alert"]')]
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

it('authors Surface through the common Extrude controls with independent ends and direction', async () => {
  seedProfile();
  const feature = await authored('extrude', {
    'Creation type': 'surface', Sketch: 'profile-1', Distance: '12',
    'Starting offset enabled': 'true', 'Starting offset (mm)': '2',
    'Extrusion direction': 'custom', 'Direction X': '0', 'Direction Y': '3', 'Direction Z': '4',
    'Use second end': 'true', 'Opposite depth (mm)': '3',
  });
  expect(feature).toMatchObject({ type: 'surface-extrude', operation: 'new', distanceMillimeters: 12,
    startingOffsetMillimeters: 2, directionVector: [0, .6, .8], secondEnd: { endType: 'blind', distanceMillimeters: 3 } });
  expect(feature.profileSelections).toHaveLength(1);
  expect(feature.profileSelections[0]).toMatchObject({ profileFeatureId: 'profile-1', profileContourId: expect.any(String) });
  expect(feature).not.toHaveProperty('thin');
  expect(feature).not.toHaveProperty('draftAngleDegrees');
  expect(feature.separateBodies).toBe(true);
});

it('uses the same Surface dialog from its command and removes curve inputs by repeat click or ×', async () => {
  seedConnectedProfile();
  cadCommands.execute('feature-surface-extrude');
  const panel = document.querySelector('.cad-feature-dialog');
  const field = label => panel.querySelector(`[aria-label="${label}"]`);
  expect(field('Creation type').value).toBe('surface');
  const pick = contourIndex => window.dispatchEvent(new CustomEvent('aether-region-picked', { detail: { featureId: 'joined', contourIndex } }));
  const refs = () => JSON.parse(field('Selected profiles').value);
  pick(0); pick(1);
  expect(refs()).toEqual([{ featureId: 'joined', contourIndex: 0 }, { featureId: 'joined', contourIndex: 1 }]);
  pick(0);
  expect(refs()).toEqual([{ featureId: 'joined', contourIndex: 1 }]);
  const entities = panel.querySelector('[aria-label="Sketch curves to extrude"]');
  const remove = entities.querySelector('button');
  remove.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  expect(remove.isConnected).toBe(true); remove.click();
  expect(refs()).toEqual([]);
  expect(entities.querySelectorAll('.aui-feature-entity')).toHaveLength(0);
  panel.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  expect(apply).not.toHaveBeenCalled();
  pick(2);
  panel.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  expect(doc.features.at(-1)).toMatchObject({ type: 'surface-extrude', profileFeatureId: 'joined' });
  expect(doc.features.at(-1).profileSelections).toHaveLength(1);
});

it('reopens a legacy symmetric Surface in the shared editor without losing its extent', async () => {
  seedProfile();
  doc = insertFeature(doc, { id: 'surface', type: 'surface-extrude', name: 'Surface', suppressed: false,
    profileFeatureId: 'profile-1', operation: 'new', distanceMillimeters: 14, symmetric: true });
  window.dispatchEvent(new CustomEvent('aether-feature-action', { detail: { type: 'item-action',
    id: 'feature/surface-extrude/surface', actionID: 'edit-feature' } }));
  const panel = document.querySelector('.cad-feature-dialog');
  expect(panel.querySelector('[aria-label="Creation type"]').value).toBe('surface');
  expect(panel.querySelector('[aria-label="Symmetric"]').checked).toBe(true);
  expect(Number(panel.querySelector('[aria-label="Distance (mm)"]').value)).toBe(14);
  panel.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  expect(doc.features.at(-1)).toMatchObject({ id: 'surface', type: 'surface-extrude', endType: 'symmetric', distanceMillimeters: 14 });
  expect(doc.features.at(-1)).not.toHaveProperty('symmetric');
});

it('waits for the latest native preview before accepting a feature through either the button or Enter', async () => {
  seedProfile();
  const jobs = [];
  configureFeaturePreview({ evaluate: candidate => new Promise((resolve, reject) => jobs.push({ candidate, resolve, reject })), show: vi.fn() });
  try {
    cadCommands.execute('feature-extrude');
    const win = document.querySelector('.cad-feature-dialog'), form = win.querySelector('form');
    const accept = win.querySelector('[data-feature-action="accept"]'), distance = win.querySelector('[aria-label="Distance (mm)"]');
    const source = win.querySelector('[aria-label="Sketch"]'); source.value = 'profile-1'; source.dispatchEvent(new Event('change'));
    const submit = () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(accept.disabled).toBe(true); submit(); expect(apply).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(jobs).toHaveLength(1));
    distance.value = '200'; distance.dispatchEvent(new Event('input'));
    jobs[0].resolve({ parts: [] });
    await vi.waitFor(() => expect(jobs).toHaveLength(2));
    distance.dispatchEvent(new Event('change')); // blur repeats the pending value
    expect(accept.disabled).toBe(true); submit(); expect(apply).not.toHaveBeenCalled();
    jobs[1].reject(new Error('The latest feature cannot be built'));
    await vi.waitFor(() => expect(win.textContent).toContain('The latest feature cannot be built'));
    expect(accept.disabled).toBe(true); submit(); expect(apply).not.toHaveBeenCalled();
    distance.value = '15'; distance.dispatchEvent(new Event('input'));
    await vi.waitFor(() => expect(jobs).toHaveLength(3));
    jobs[2].resolve({ parts: [] });
    await vi.waitFor(() => expect(accept.disabled).toBe(false));
    distance.dispatchEvent(new Event('change')); // the completed value must stay ready
    expect(accept.disabled).toBe(false);
    submit(); await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(jobs).toHaveLength(3);
    expect(doc.features.at(-1).distanceMillimeters).toBe(15);
  } finally { configureFeaturePreview(null); }
});

it('carries an explicitly selected single-region sketch into Extrude without choosing the last sketch',async()=>{
  const {cadWorkspace}=await import('./cad-workspace-store');
  const original=cadWorkspace.snapshot();
  seedProfile();
  doc=insertFeature(doc,{id:'later',type:'profile',name:'Later sketch',plane:'XY',offsetMillimeters:20,suppressed:false,profile:{type:'circle',radiusMillimeters:3,centerMillimeters:[0,0]}});
  try {
    cadWorkspace.publish({...original,selectedItemIDs:new Set(['feature/profile/profile-1'])});
    mountFeatureAuthoring(()=>doc,apply);cadCommands.execute('feature-extrude');
    await vi.waitFor(()=>expect(document.querySelector('.cad-feature-dialog').textContent).toContain('Sketch 1 · Region 1'));
    document.querySelector('.cad-feature-dialog form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    await vi.waitFor(()=>expect(apply).toHaveBeenCalled());
    expect(doc.features.at(-1)).toMatchObject({type:'extrude',profileFeatureId:'profile-1'});
  } finally {cadWorkspace.publish(original);}
});

it('uses every region of an explicitly selected whole sketch',async()=>{
  const {cadWorkspace}=await import('./cad-workspace-store');
  const original=cadWorkspace.snapshot();
  doc=insertFeature(doc,{id:'multi',type:'profile',name:'Two regions',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'drawing',contours:[{id:'one',type:'circle',center:[0,0],radius:2},{id:'two',type:'circle',center:[10,0],radius:2}]}});
  try {
    cadWorkspace.publish({...original,selectedItemIDs:new Set(['feature/profile/multi'])});
    mountFeatureAuthoring(()=>doc,apply);cadCommands.execute('feature-extrude');
    await new Promise(resolve=>queueMicrotask(resolve));
    expect(JSON.parse(document.querySelector('[aria-label="Selected profiles"]').value)).toEqual([
      { featureId: 'multi', contourIndex: 0 }, { featureId: 'multi', contourIndex: 1 },
    ]);
    expect(apply).not.toHaveBeenCalled();
  } finally {cadWorkspace.publish(original);}
});

it("serializes revolve with axis and angle", async () => {
  seedProfile();
  const feature = await authored("revolve", {
    Sketch: "profile-1",
    "Revolve axis choice": "Y",
    "Angle": "180",
  });
  expect(feature).toMatchObject({
    type: "revolve",
    axis: "Y",
    angleDegrees: 180,
    profileFeatureId: "profile-1",
  });
});


it("revolves about a line of an earlier sketch and about a construction Axis feature", async () => {
  doc = insertFeature(doc, { id: "guide", type: "profile", name: "Guide", plane: "XY", offsetMillimeters: 0, suppressed: false,
    profile: { type: "drawing", contours: [{ id: "g", type: "path", start: [-30, -10], segments: [{ id: "g1", type: "line", end: [-30, 40] }], construction: true }] } });
  seedProfile();
  doc.features.splice(doc.features.length - 1, 0, { id: "axis-1", type: "axis", name: "Axis 1", suppressed: false, definition: { method: "edge", axis: { kind: "axis", originMillimeters: [-30, 0, 0], directionMillimeters: [0, 1, 0] } } });
  const byLine = await authored("revolve", { Sketch: "profile-1", "Revolve axis choice": `line:${JSON.stringify({ kind: "sketch-line", sourceFeatureId: "guide", contourId: "g", segmentId: "g1" })}` });
  expect(byLine).toMatchObject({ type: "revolve", axisReference: { kind: "sketch-line", sourceFeatureId: "guide", contourId: "g", segmentId: "g1" } });
  const byAxis = await authored("revolve", { Sketch: "profile-1", "Revolve axis choice": "axis:axis-1" });
  expect(byAxis).toMatchObject({ type: "revolve", axisReference: { kind: "feature", featureId: "axis-1" } });
});

it("authors a tapped M8 hole from the thread standards with a cap-screw counterbore", async () => {
  seedProfile();
  await authored("extrude", { Sketch: "profile-1", Distance: "25" });
  // Onshape's placement: the sketch's circle centre, the first entry of the sketch-points list.
  const point = "<first option>"; void "{\"kind\": \"sketch-choice\", \"sourceFeatureId\": \"profile-1\", \"contourIndex\": 0, \"index\": 0, \"label\": \"Sketch 1 · Circle 1 center\"}";
  const feature = await authored("hole", {
    "Sketch points to place holes sketch point": point, "Hole type": "tapped", Standard: "ISO metric coarse", Size: "M8",
    "Head from standard": "ISO 4762 cap screw counterbore", "Thread geometry": "modelled", "Tip angle style": "118",
  });
  // The standard drives the diameter (tap drill) and the recess (ISO 4762 bore and head height).
  expect(feature).toMatchObject({
    type: "hole", placement: { kind: "sketch-points" }, diameterMillimeters: 6.8, cutType: "counterbore", counterDiameterMillimeters: 15, counterDepthMillimeters: 8,
    drillPoint: "angled", drillPointAngleDegrees: 118,
    thread: { standard: "iso-metric-coarse", designation: "M8", tapped: true, modeled: true },
  });
  expect(feature.taperAngleDegrees).toBeUndefined();
  // Switching to a clearance hole takes the normal fit instead.
  const clearance = await authored("hole", { "Sketch points to place holes sketch point": point, "Hole type": "clearance", Standard: "ISO metric coarse", Size: "M8", "Fastener fit": "close" });
  expect(clearance).toMatchObject({ diameterMillimeters: 8.4, cutType: "plain", thread: { standard: "iso-metric-coarse", designation: "M8", tapped: false, fit: "close" } });
});

it("revolve ends stop at the next part on either side, with the angle only for Blind", async () => {
  seedProfile();
  const toNext = await authored("revolve", { Sketch: "profile-1", "Revolve axis choice": "Y", "Angle": "90", "End condition": "up-to-next" });
  expect(toNext).toMatchObject({ type: "revolve", endType: "up-to-next", angleDegrees: 90 });
  expect(toNext.secondEnd).toBeUndefined();
  const both = await authored("revolve", { Sketch: "profile-1", "Revolve axis choice": "Y", "Angle": "90", "Second end position": "true", "Opposite end condition": "up-to-next" });
  expect(both).toMatchObject({ type: "revolve", angleDegrees: 90, secondEnd: { endType: "up-to-next" } });
  expect(both.endType).toBeUndefined();
  const blindBoth = await authored("revolve", { Sketch: "profile-1", "Revolve axis choice": "Y", "Angle": "90", "Second end position": "true", "Opposite angle": "45" });
  expect(blindBoth).toMatchObject({ secondEnd: { endType: "blind", angleDegrees: 45 } });
  // Each end offers the same choices and pick boxes.
  cadCommands.execute("feature-revolve");
  const panel = [...document.querySelectorAll(".cad-feature-dialog")].at(-1);
  for (const label of ["End type", "Stopping part", "Stopping face", "Opposite end type", "Opposite stopping part", "Opposite stopping face"])
    expect(panel.querySelector(`[aria-label="${label}"]`), label).toBeTruthy();
});

it("fillet and chamfer windows follow Onshape: entities box, tangent propagation, size rows by chamfer type", async () => {
  seedProfile();
  doc.features.push({ id: "box-1", type: "extrude", name: "Extrude 1", profileFeatureId: "profile-1", distanceMillimeters: 5, operation: "new", suppressed: false });
  const chamfer = await authored("chamfer", { "Edges": "all", "Chamfer type": "distance-angle", "Distance (mm)": "1", "Angle": "30" });
  expect(chamfer).toMatchObject({ type: "chamfer", radiusMillimeters: 1, angleDegrees: 30 });
  expect(chamfer.secondDistanceMillimeters).toBeUndefined();
  const fillet = await authored("fillet", { "Edges": "all", "Radius (mm)": "2", "Variable fillet": "true", "End radius (mm)": "4", "Measurement": "width" });
  expect(fillet).toMatchObject({ type: "fillet", radiusMillimeters: 2, endRadiusMillimeters: 4, measurement: "width" });
  const tangent = await authored("chamfer", { "Edges": "all", "Distance (mm)": "1", "Measurement": "tangent" });
  expect(tangent).toMatchObject({ type: "chamfer", radiusMillimeters: 1, measurement: "tangent" });
  const flipped = await authored("chamfer", { "Edges": "all", "Chamfer type": "two-distances", "Distance (mm)": "1", "Second distance (mm)": "2", "Flip direction": "true" });
  expect(flipped).toMatchObject({ type: "chamfer", radiusMillimeters: 1, secondDistanceMillimeters: 2, flipped: true });
  cadCommands.execute("feature-fillet");
  const panel = [...document.querySelectorAll(".cad-feature-dialog")].at(-1);
  for (const label of ["Entities to fillet", "Tangent propagation", "Variable fillet"]) expect(panel.querySelector(`[aria-label^="${label}"]`), label).toBeTruthy();
  expect(panel.querySelector('[aria-label="Edges"]').closest(".aui-feature-row")).toBeNull();
});

it("mirror and split take one plane box: a tree plane, a plane feature, a face or a sketch line", async () => {
  seedProfile();
  doc.features.push({ id: "box-2", type: "extrude", name: "Extrude 2", profileFeatureId: "profile-1", distanceMillimeters: 5, operation: "new", suppressed: false });
  // A tree click on Right Plane reaches the open window as the sketch-plane pick.
  cadCommands.execute("feature-mirror");
  window.dispatchEvent(new CustomEvent("aether-sketch-plane", { detail: "YZ" }));
  const openPanel = [...document.querySelectorAll(".cad-feature-dialog")].at(-1);
  expect(openPanel.querySelector('.aui-feature-entities[aria-label^="Mirror plane"]').textContent).toContain("Right Plane");
  for (const cancel of document.querySelectorAll('[aria-label="Cancel"]')) cancel.click();
  const mirrored = await authored("mirror", { Feature: "box-2", "Mirror plane reference": JSON.stringify({ kind: "principal", plane: "YZ", offsetMillimeters: 0 }) });
  expect(mirrored).toMatchObject({ type: "mirror", sourceFeatureId: "box-2", plane: "YZ", offsetMillimeters: 0, operation: "add" });
  expect(mirrored.mirrorPlane).toBeUndefined();
  const { availableBodies } = await import("@aether/core/document");
  const body = availableBodies(doc)[0];
  const split = await authored("split", { "Part to split identity": JSON.stringify([body.id]), "Split plane reference": JSON.stringify({ kind: "principal", plane: "XZ", offsetMillimeters: 2 }), "Keep both sides": "true" });
  expect(split).toMatchObject({ type: "split", bodyIds: [body.id], plane: { kind: "principal", plane: "XZ", offsetMillimeters: 2 }, keep: "both" });
  expect(split.copyBodyIds[body.id]).toBeTruthy();
});


it('hands an open whole sketch to Surface and never restores a removed curve on unrelated tree updates', async () => {
  const { cadWorkspace } = await import('./cad-workspace-store');
  const original = cadWorkspace.snapshot();
  doc = insertFeature(doc, { id: 'open', type: 'profile', name: 'Open curves', plane: 'XY', offsetMillimeters: 0, suppressed: false,
    profile: { type: 'drawing', contours: [0, 10, 20].map((x, i) => ({ id: 'curve-' + i, type: 'path', start: [x, 0],
      segments: [{ type: 'line', end: [x + 5, 0] }], ...(i === 2 ? { construction: true } : {}) })) } });
  try {
    cadWorkspace.publish({ ...original, selectedItemIDs: new Set(['feature/profile/open']) });
    cadCommands.execute('feature-extrude');
    const panel = document.querySelector('.cad-feature-dialog');
    await new Promise(resolve => queueMicrotask(resolve));
    const mode = panel.querySelector('[aria-label="Creation type"]'); mode.value = 'surface'; mode.dispatchEvent(new Event('change'));
    const picks = () => JSON.parse(panel.querySelector('[aria-label="Selected profiles"]').value);
    expect(picks()).toEqual([{ featureId: 'open', contourIndex: 0 }, { featureId: 'open', contourIndex: 1 }]);
    const entities = panel.querySelector('[aria-label="Sketch curves to extrude"]');
    entities.querySelector('button').click();
    expect(picks()).toEqual([{ featureId: 'open', contourIndex: 1 }]);
    cadWorkspace.publish({ ...cadWorkspace.snapshot(), partCount: 2 });
    expect(picks()).toEqual([{ featureId: 'open', contourIndex: 1 }]);
    window.dispatchEvent(new CustomEvent('aether-region-picked', { detail: { featureId: 'open', contourIndex: 1 } }));
    expect(picks()).toEqual([]);
    cadWorkspace.publish({ ...cadWorkspace.snapshot(), partCount: 3 });
    expect(picks()).toEqual([]);
  } finally { cadWorkspace.publish(original); }
});

it('accepts whole sketches selected from the tree while Surface is open', async () => {
  const { cadWorkspace } = await import('./cad-workspace-store');
  const original = cadWorkspace.snapshot(); seedConnectedProfile();
  try {
    cadWorkspace.publish({ ...original, selectedItemIDs: new Set() });
    cadCommands.execute('feature-surface-extrude');
    cadWorkspace.publish({ ...cadWorkspace.snapshot(), selectedItemIDs: new Set(['feature/profile/joined']) });
    const picks = JSON.parse(document.querySelector('[aria-label="Selected profiles"]').value);
    expect(picks).toHaveLength(4);
    expect(picks.every(p => p.featureId === 'joined')).toBe(true);
  } finally { cadWorkspace.publish(original); }
});

it('switches Extrude selection focus between profiles, stopping faces and points without losing × clicks', async () => {
  const { cadSelection } = await import('./cad-selection-store');
  seedProfile();
  cadCommands.execute('feature-extrude');
  const panel = document.querySelector('.cad-feature-dialog');
  const field = label => panel.querySelector(`input[aria-label="${label}"], select[aria-label="${label}"]`);
  const change = (label, value) => { field(label).value = value; field(label).dispatchEvent(new Event('change')); };
  change('Sketch', 'profile-1');
  change('End condition', 'up-to-face');
  const profiles = panel.querySelector('.aui-feature-entities[aria-label="Faces and sketch regions to extrude"]');
  const face = panel.querySelector('.aui-feature-entities[aria-label="End face"]');
  const reference = { sourceFeatureId: 'stop', bodyId: 'stop-body', label: 'Stop face', normal: [0, 0, -1] };
  const reply = () => window.dispatchEvent(new CustomEvent('aether-extrude-face', { detail: { support: reference } }));
  reply();
  expect(JSON.parse(field('Stopping face').value)).toEqual(reference);
  const remove = profiles.querySelector('button');
  remove.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  expect(remove.isConnected).toBe(true);
  expect(profiles.dataset.picking).toBe('true');
  expect(cadSelection.snapshot().filter).toBe('auto');
  remove.click();
  expect(JSON.parse(field('Selected profiles').value)).toEqual([]);
  window.dispatchEvent(new CustomEvent('aether-region-picked', { detail: { featureId: 'profile-1', contourIndex: 0 } }));
  expect(JSON.parse(field('Selected profiles').value)).toHaveLength(1);
  face.focus();
  expect(profiles.dataset.picking).toBe('false');
  expect(cadSelection.snapshot().filter).toBe('face');
  window.dispatchEvent(new CustomEvent('aether-region-picked', { detail: { featureId: 'profile-1', contourIndex: 0 } }));
  expect(JSON.parse(field('Selected profiles').value)).toHaveLength(1);
  change('End condition', 'up-to-vertex');
  expect(cadSelection.snapshot().filter).toBe('vertex');
  profiles.focus();
  expect(cadSelection.snapshot().filter).toBe('auto');
  window.dispatchEvent(new CustomEvent('aether-extrude-point', { detail: { reference: { label: 'Inactive vertex' } } }));
  expect(field('Stopping point').value).toBe('');
  expect(JSON.parse(field('Stopping face').value)).toEqual(reference);
  for (const mode of ['thin', 'surface', 'solid']) {
    change('Creation type', mode);
    expect(field('Sketch').hidden).toBe(true);
    expect(field(mode === 'solid' ? 'Region' : 'Sketch curves').hidden).toBe(true);
    expect(profiles.querySelectorAll('.aui-feature-entity')).toHaveLength(1);
  }
});

it('keeps opposite stopping-part inputs independent and ignores hidden or inactive part fields', async () => {
  const { cadSelection } = await import('./cad-selection-store');
  seedProfile();
  for (const id of ['first', 'second']) doc = insertFeature(doc, {
    id, type: 'extrude', name: id, profileFeatureId: 'profile-1', bodyId: id + '-body', distanceMillimeters: 5, operation: 'new', suppressed: false,
  });
  cadCommands.execute('feature-extrude');
  const panel = document.querySelector('.cad-feature-dialog');
  const field = label => panel.querySelector(`input[aria-label="${label}"], select[aria-label="${label}"]`);
  const change = (label, value) => { field(label).value = value; field(label).dispatchEvent(new Event('change')); };
  const pick = id => cadSelection.dispatch({ type: 'replace', items: [{ id, kind: 'body', partId: id + '-body', label: id }] });
  change('End condition', 'up-to-part');
  pick('first');
  expect(field('Stopping part identity').value).toBe('first-body');
  expect(field('Opposite stopping part identity').value).toBe('');
  panel.querySelector('input[type="checkbox"][aria-label="Second end position"]').click(); change('Opposite end condition', 'up-to-part');
  pick('second');
  expect(field('Stopping part identity').value).toBe('first-body');
  expect(field('Opposite stopping part identity').value).toBe('second-body');
  panel.querySelector('.aui-feature-entities[aria-label="Stopping part"]').focus();
  pick('second');
  expect(field('Stopping part identity').value).toBe('second-body');
  panel.querySelector('.aui-feature-entities[aria-label="Faces and sketch regions to extrude"]').focus();
  pick('first');
  expect(field('Stopping part identity').value).toBe('second-body');
  expect(field('Opposite stopping part identity').value).toBe('second-body');
  change('End condition', 'blind'); panel.querySelector('input[type="checkbox"][aria-label="Second end position"]').click();
  pick('first');
  expect(field('Stopping part identity').value).toBe('second-body');
  expect(field('Opposite stopping part identity').value).toBe('second-body');
  cadSelection.dispatch({ type: 'clear' });
});

it('keeps newly assigned legacy sketch identities identical between Surface preview, blur and commit', async () => {
  seedProfile();
  const candidates = [];
  configureFeaturePreview({ evaluate: async candidate => { candidates.push(structuredClone(candidate)); return { parts: [] }; }, show: vi.fn() });
  try {
    cadCommands.execute('feature-extrude');
    const win = document.querySelector('.cad-feature-dialog'), form = win.querySelector('form');
    const source = win.querySelector('[aria-label="Sketch"]'); source.value = 'profile-1'; source.dispatchEvent(new Event('change'));
    [...win.querySelectorAll('button')].find(button => button.textContent === 'Surface').click();
    const accept = win.querySelector('[data-feature-action="accept"]');
    await vi.waitFor(() => { expect(candidates.at(-1)?.features.at(-1).type).toBe('surface-extrude'); expect(accept.disabled).toBe(false); });
    const preview = candidates.at(-1), count = candidates.length;
    expect(preview.features[0].profile.contours[0].id).toBeTruthy();
    win.querySelector('[aria-label="Distance (mm)"]').dispatchEvent(new Event('change'));
    expect(accept.disabled).toBe(false);
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(doc.features[0].profile).toEqual(preview.features[0].profile);
    expect(candidates).toHaveLength(count);
  } finally { configureFeaturePreview(null); }
});
