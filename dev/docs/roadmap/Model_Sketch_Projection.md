# Model geometry in sketches

The local SolidCraft command and edge-link tests distinguish two behaviors:
orthogonal projection and persistent links to upstream geometry. They are a
behavior reference. Aether's implementation uses its own OCCT modeling layer.

## Implemented source increment

Include 3D edges projects selected exact-body boundaries, face loops, edges or
vertices into an editable sketch. Without a selection it includes all earlier
exact-body edges. It does not generate a body silhouette or hide occluded edges.
The existing coplanar operation remains separate for face auto-projection.

Lines, circles, circular/elliptical arcs and polynomial Bézier curves of degree
up to three remain analytic. A circle viewed obliquely becomes an ellipse; an
edge-on circle becomes its full diameter. Normal-aligned straight edges become
point nodes. Other curves use OCCT deflection sampling, default 0.01 mm, with an
explicit approximation report. There is a 1000-segment sketch-path limit and a
4096-source-edge operation limit. Unsupported/stale selections fail atomically.

These are editable copies with new authored contour/segment/vertex identities.
They do **not** follow changes to the source model. UI text and agent results
state this limitation. Existing linked projections of other sketches remain a
different feature. No Part schema or canonical Animation codec change is needed
for independent copies in the existing drawing format.

## Module ownership

| Module | Responsibility |
| --- | --- |
| Engine `sketch/model-projection.ts` | Shared request/result contract and validation |
| Engine `kernel/sketch-projection/sources.ts` | Strict evaluated source selection and native-wrapper lifetime |
| Engine `kernel/sketch-projection/edge.ts` | Analytic conversion and explicitly reported approximation |
| Engine `kernel/sketch-projection/{frame,deduplicate,index}.ts` | Coordinate mapping, duplicate removal and operation composition |
| App `sketch/model-include.ts` | Shared copy insertion, earlier-history scope and cancellable UI transaction |
| App `sketch/tool-commands.ts` | One registration/availability catalog for sketch editing tools |
| App `automation/model-projection.ts` | Validated editable-sketch adapter and live tool schema |
| Worker/browser entry points | Thin routing to those same modules |

Live agents use `aether_cad_sketch_include_model`; saved files use
`cad.sketch.includemodel` with Studio's normal expected-revision/save boundary.
These async operations are not yet steps in the synchronous modeling-program
adapter. Select transient topology from the current model; do not persist an
edge index as an associative identity. UI and live-agent candidates reject
intervening edits, closed contexts and cancellation before committing.

## Remaining associative work

1. Persist stable model-source references and resolve them at the target sketch's
   history position. Define split-edge, deleted-edge and merged-body behavior;
   never silently substitute the nearest unrelated edge.
2. Expose resolved geometry as fixed reference context, with dimensions and
   constraints retaining side/branch intent when the source moves.
3. Add break-link, repair/lost-reference presentation, copy/undo/reopen and
   canonical portable-codec gates. Choose the document-format change explicitly.
4. Verify source edits through UI, live and saved agents, using the local
   reference tests for behavior and independent analytic geometry checks.

The parity tracker remains **partial** until these gates pass. See the source
reality status for qualification and release state; no installation is implied.
