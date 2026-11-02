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

it('carries an explicitly selected single-region sketch into Extrude without choosing the last sketch',async()=>{
  const {cadWorkspace}=await import('./cad-workspace-store');
  const original=cadWorkspace.snapshot();
  seedProfile();
  doc=insertFeature(doc,{id:'later',type:'profile',name:'Later sketch',plane:'XY',offsetMillimeters:20,suppressed:false,profile:{type:'circle',radiusMillimeters:3,centerMillimeters:[0,0]}});
  try {
    cadWorkspace.publish({...original,selectedItemIDs:new Set(['feature/profile/profile-1'])});
    mountFeatureAuthoring(()=>doc,apply);cadCommands.execute('feature-extrude');
    await vi.waitFor(()=>expect(document.querySelector('.cad-feature-dialog').textContent).toContain('Region 1 · circle of Sketch 1'));
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
    expect(document.body.textContent).toContain('Select a sketch face.');
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


it("authors a tapped M8 hole from the thread standards with a cap-screw counterbore", async () => {
  seedProfile();
  await authored("extrude", { Sketch: "profile-1", Distance: "25" });
  const feature = await authored("hole", {
    "Center sketch": "profile-1", "Thread profile": "ISO metric coarse", Size: "M8",
    "Head from standard": "ISO 4762 cap screw counterbore", "Thread geometry": "modelled", "Drill point": "angled",
  });
  // The standard drives the diameter (tap drill) and the recess (ISO 4762 bore and head height).
  expect(feature).toMatchObject({
    type: "hole", diameterMillimeters: 6.8, cutType: "counterbore", counterDiameterMillimeters: 15, counterDepthMillimeters: 8,
    drillPoint: "angled", drillPointAngleDegrees: 118,
    thread: { standard: "iso-metric-coarse", designation: "M8", tapped: true, modeled: true },
  });
  expect(feature.taperAngleDegrees).toBeUndefined();
  // Switching to a clearance hole takes the normal fit instead.
  const clearance = await authored("hole", { "Center sketch": "profile-1", "Thread profile": "ISO metric coarse", Size: "M8", Thread: "clearance", "Clearance fit": "close" });
  expect(clearance).toMatchObject({ diameterMillimeters: 8.4, cutType: "plain", thread: { standard: "iso-metric-coarse", designation: "M8", tapped: false, fit: "close" } });
});
