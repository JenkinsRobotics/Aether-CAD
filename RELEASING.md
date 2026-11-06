# Aether-CAD releases

This repository owns the `cad` source. Development branch: `alpha-0.1`.
Each independently staged release receives the next `alpha-0.1.N` index.
Package-manager versions and the shared UI dependency version are separate.

1. Install Git LFS and run `git lfs pull` to retrieve the large tracked assets
   archives, then verify exact dependencies with `python3 tools/fetch-vendor.py`.
   The default local cache is `~/Library/Caches/Aether/packages`; override it with
   `AETHER_PACKAGE_CACHE`. Unpublished dependencies must be supplied by SHA-256.
   Product source must not import another repository's source files.
2. Run `npm --prefix aether-engine ci`, then `npm ci`, tests and
   `npm run build` from `.`.
   Every frontend release must also pass `scripts/verify-home-browser.mjs` against
   its built frontend (`AETHER_HOME_FRONTEND=/absolute/path/to/dist`) and through
   Studio's disposable authenticated browser fixture. This guards `/cad/` and
   `/cad/index.html` as app-owned homes, standalone Home, explicit document and
   recovery-draft routes, creation, and return to Home from the editor/Examples.
   A healthy server or successful engine test alone does not verify Home routing.
   Include the committed home modules and pinned session SDK in each release;
   never build a source snapshot that omits them as unrelated local changes.
   Also run the owning engine's tests/type check from `aether-engine/`. Qualify
   the rebuilt worker with `node scripts/verify-headless-kernel.mjs` and
   `node scripts/verify-sketch-regions.mjs`, then run
   `AETHER_TEST_NATIVE=1 <python-3.11-or-3.12> -m pytest service/tests -q`.
   The historical flag enables the required native release tests; geometry uses
   the Aether/OCCT runner. The test oracle imports the hash-pinned workspace-codec
   wheel from `vendor/python/`, never an editable sibling Animation checkout.
   A default pytest run skips release gates and is insufficient for qualification.
   Native Extrude direction references use Part27 and canonical codec30. Run
   `test_native_extrude_direction.py` and
   `node scripts/verify-extrude-direction-format.mjs /path/to/Part26/native-worker.json`.
   Both browser control gates must cover native edge selection, saved-history
   removal, shared depth handles, construction-axis selection and saved reopen.
   The previous reader refuses Part27; restoring an older app cannot discard its
   direction references. Boundary picking must retain visibility and section rules.
   Native cylindrical/conical face-axis directions use Part28 and canonical
   codec31. Run `test_native_extrude_face_axis.py` and
   `node scripts/verify-extrude-face-axis-format.mjs /path/to/Part27/native-worker.json`.
   Verify Solid/Thin/Surface geometry, upstream axis edits, missing/ambiguous source
   refusal, shared handles, persistent selected/error highlights, repeat-click and
   × removal, saved reopen and the Part27/codec30 refusal boundary. Unique analytic
   surfaces follow edits; anchored faces must still resolve exactly. Rollback does
   not downgrade Part28 documents.
   Kernel feature changes also require `scripts/verify-modeling-browser.mjs`
   through Studio's disposable authenticated browser fixture with the candidate
   frontend and matching worker. It covers sketch creation, additive/subtractive
   extrusion, revolve, finishing, shell, mirror, pattern, Boolean, hole, surfaces
   and sheet-metal export. Every step must pass with no server geometry requests;
   there is no tolerant mode. For implementation-only module extractions, compare
   saved models against the previous worker: stable IDs, anchors, measurements,
   body outputs, reference scopes and frames must remain equivalent. OCCT traversal
   order and diagnostic incidence indexes are not stable identities.
   Signed projected dimensions require `test_native_distance_intent.py` and
   `scripts/verify-projected-distance-browser.mjs`: source crossings, real UI
   dimension editing/undo/redo, live-agent edits/refusals, exact rebuild and
   saved reopen. Part22/clipboard2 require the prior readers to refuse new intent;
   codec22 must match its canonical Animation commit. Package rollback does not
   downgrade Part22 files to an older reader's format.
   Unified Surface extrusion writes Part23 and consumes the canonical codec26
   wheel. Run `test_native_surface_extrusion.py` and
   `node scripts/verify-surface-format.mjs /path/to/previous/native-worker.json`:
   both ends, direction and offset must survive agent edits and saved reopen;
   codec25 and the previous Part22 worker must refuse the new records. Run
   `scripts/verify-feature-controls-browser.mjs` on Chromium and WebKit for the
   real Surface tab, native preview, shared depth control, removal and cancel.
   Older Parts remain readable; rollback does not downgrade new Part23 files.
   Multi-source Extrude output identity uses Part24 and canonical codec27.
   Run `test_native_extrusion_sources.py` and
   `node scripts/verify-extrusion-sources-format.mjs /path/to/prior/native-worker.json`
   against the released Part23 reader. Verify source reordering/removal, exact
   geometry, saved output IDs, refusal by codec26/Part23 and the actual Solid,
   Thin and Surface workflows in both browser control gates. Rollback cannot
   discard the output lineage or downgrade Part24 files.
   Independent Surface extrusion outputs use Part25 and canonical codec28.
   Run `test_native_extrusion_sources.py` and
   `node scripts/verify-surface-output-format.mjs /path/to/Part24/native-worker.json`.
   Verify native connected sheets, stable IDs through source reorder/removal,
   whole-sketch selection excluding construction, downstream single-sheet edits,
   legacy compound preservation, and actual Part24/codec27 refusal of Part25.
   Both browser control gates must retain independent Surface output IDs on reopen.
   Rollback does not downgrade Part25 files.
   Connected Surface Add uses Part26 and canonical codec29. Run the native
   Surface Add grouping/history suite, packaged agent/codec tests, and
   `scripts/verify-surface-add-format.mjs` against the installed Part25 worker.
   Disconnected additions retain their respective target IDs; a bridge keeps
   the primary ID; detached tool pieces and unrelated explicit targets fail.
   Both browser control gates must author automatic/explicit groups and bridges,
   save/reopen them, remove curves after a failed preview, and preserve Cancel.
   Existing Add records without `connectedMerge` retain their compound semantics.
   Older readers must refuse Part26; never downgrade a saved file for rollback.
   Angled Extrude Draft requires `extrusion-oblique-draft.test.ts`, the packaged
   `test_native_thin_draft.py` agent cases and both browser control gates. Check
   native wall angles against the pull direction, analytic volumes, the neutral
   sketch plane, starting offsets, independent ends, exact stopping limits and
   shared draft/thickness control positions. Smooth closed curved boundaries also
   require `extrusion-curved-draft.test.ts` and `extrude-curved-draft.test.ts`:
   native validity, independent support-function volumes, neutral boundaries,
   inner-wall winding, exact native wall angles, tilted stopping planes and
   explicit-target booleans. Both browser gates exercise curved Solid and Thin
   drafts, shared controls, failed-preview removal and saved reopen. Curved walls
   use checked native B-spline surfaces, not a shear of normal-direction draft.
   Sharp corners joining curved edges remain an explicit trimming gap.
   Normal-direction curved drafts retain their existing behavior.
   Extrude selection changes also require both feature-control browser gates to
   switch between profile and stopping-reference fields, remove/reselect native
   faces and parts during history previews, and preserve saved limits. Re-run
   the reported Part 1 face-removal workflows on both browsers. Hidden fields
   must not consume picks, and pointer focus must not replace a pending × row.
   Creation-mode changes must retain explicit removals, including an empty
   selection. Exercise whole-sketch handoff, connected multi-line boundaries,
   incompatible open profiles, saved Solid-to-Surface history edits and reopen
   in both browser gates. Never reinterpret a face-cell index as a curve index
   or widen a partial arrangement boundary into entire authored contours.
   Model-to-sketch projection additionally requires the packaged
   `service/tests/test_native_model_projection.py` cases and
   `scripts/verify-model-projection-browser.mjs` through that disposable host.
   Exercise the actual Include command, local undo/redo, live MCP refusal and
   commit, exact extrusion of the projected profile and saved reopen. Analytic
   curves, collapsed points/diameters and explicit spline approximation require
   independent geometry checks. Independent copies must not be reported as
   associative links; preserve the separate coplanar face-auto-projection path.
   Live viewport section changes require `node scripts/verify-section-render.mjs`
   (pixel checks on WebGPU and WebGL, including cached hover/selection materials)
   and `scripts/verify-live-section-browser.mjs` through the disposable host.
   Also run `scripts/verify-assembly-section-browser.mjs` with
   `AETHER_SECTION_BROWSER=webgpu` and `AETHER_SECTION_BROWSER=webkit`: the real
   robot must lose the removed half, retain the opposite half, flip and restore
   correctly without saving a document. A section outline or cap alone is not
   proof that the original surfaces were clipped.
   Repeat the assembly check with `AETHER_SECTION_FACE_FIRST=1`: pick optical
   carrier Face 4 and enter -79.195 mm before any origin-plane cut. Preview,
   flip and cancel must work with the dialog still open. The metrics must report
   the actual renderer backend (WebGL2 on Safari/WebKit, WebGPU on Chromium).
   Safari currently selects the qualified WebGL2 compatibility path. Removing
   that policy requires the same check in actual Safari WebGPU, not just
   Chromium WebGPU or Playwright WebKit. For section CPU-work comparisons use
   `node scripts/profile-section-render.mjs build/section-performance.json`;
   these timings measure cut updates, not overall FPS.
   History playback changes require `scripts/verify-history-playback-browser.mjs`
   through the disposable host on Chromium and with `AETHER_HISTORY_BROWSER=webkit`.
   Verify visible geometry at each feature, pause/resume, stop/Escape, the original
   rollback position and unchanged saved documents with no persistence requests.
   Playback uses transient canonical rebuilds; Build and Present timings are not
   a GPU benchmark. Picking changes also require `node scripts/profile-picking.mjs`:
   preserve every hit and triangle identity, including walls retained by sections.
   `node scripts/profile-kernel-scope.mjs` compares exact scoped cut/intersection
   geometry and timings; do not generalize this fixture to whole-model loading.
   Drawing changes also require `node scripts/verify-drawings.mjs`. Drawing sections require
   analytic hole/hatch clipping and all-six-orientation checks, paper-spacing and
   source-refresh tests, actual UI/agent invalid-cut refusal/history/reopen, SVG/DXF
   hatch export, and a frozen format-1 reader refusing new format-2 content. Run
   `scripts/verify-drawings-browser.mjs` through Studio's disposable authenticated
   browser fixture with the candidate frontend and matching worker. It covers
   source editing, associative rebuild, keyboard history, SVG/DXF/PDF (active and all sheets), portable file reopen, independent Studio autosave/reload, read-only revisions and live MCP drawing edits. It imports `verify-drawing-agent-browser.mjs` for the actual shared-editor broker checks.
   PDF changes additionally require `node scripts/verify-drawing-pdf.mjs` and
   `python scripts/verify-drawing-pdf.py` (pypdf/pdfplumber) against the same output
   directory. Render every PDF page with Poppler and visually inspect it. Verify
   embedded font/license equality in the frontend, standalone runner and zipapp.
   Browser qualification includes UI/agent/read-only PDFs and all-sheet ordering;
   route/agent tests cover revision changes, cancellation and workspace switches.
   Assembly edit changes require `scripts/verify-assembly-edit-browser.mjs` through
   the same disposable fixture. It exercises actual MCP editor calls, native
   assembly solves, guarded joint/relation/mate edits, history and saved reopen.
   The disposable host caps each complete browser invocation at 480 seconds.
   Run the same script once with `AETHER_ASSEMBLY_BROWSER_CORE_ONLY=1` (six core
   edit/history workflows) and once with `AETHER_ASSEMBLY_BROWSER_POSE_ONLY=1`
   (both joint poses, compound copy and contact management) when the combined
   run exceeds that budget. Both groups must pass; neither replaces the other
   and every per-operation and final error assertion remains enabled.
   Check the common bottom Undo/Redo buttons as well as keyboard/agent history.
   Check multiple undo/redo steps spanning composition, UI coordinate edits and
   agent edits; a failed edit preserves the redo branch, a new edit clears it,
   and saved reopen clears local history. Compound UI insertion/copy/grouping must
   publish once and undo as one action, including definition and occurrence changes.
   Test selecting each free coordinate
   and its limits with explicit angle/distance units, plus canonical component rows.
   It must also assert no `/cad/rpc` requests: Assembly metadata is served by CAD's
   released worker through `/api/cad/assembly` with `operation: workspace`. The
   legacy assembly-solve request remains supported. The new path uses no host
   session handle, filesystem path, database or changed request/response limit.
   Contact tests must exercise the visible list/dialog create/edit/member/remove
   flows, retained suppressed members, stale/read-only refusal, visible overlap
   errors, undo/reopen, enable/refusal, suppression, exact overlap checks,
   retained authored placements and graph-schema-2 save/reopen. Include combined
   Ball and Pin Slot edits/reopen with contacts enabled. Saved-worker pose
   comparisons must cover all eight mate types, both grounded endpoints, rotated
   connectors, signed/offset relations and dependency chains, against the pinned
   canonical codec. Never infer pose equivalence from displayed DOF fields alone.
   The frozen codec19
   reader must reject contact/cam files; ordinary graph-schema-1 files retain
   identical old/new/old roundtrips. New contact/cam intent requires a new reader
   and cannot be opened after restoring an older CAD release. Never convert it
   to schema 1 merely to make an old reader accept it.
   Mutating live Assembly tools require `expected_revision` from inspection;
   provider fixtures must pass it for compose, edit, undo and redo too. This opaque
   editor token is distinct from the saved counter (`source_revision`) and changes
   after undo/reopen even when the archive counter repeats. Also run
   Studio's existing CAD assembly-agent regression after updating that consumer.
   Finish building before starting worker qualification: the automation build
   replaces its output directory, so tests must not read it during a rebuild.
   Example authoring or source-history navigation changes also require
   `node scripts/examples/collection/verify-native-history.mjs`, which inspects
   the actual packaged archives. Run `verify-authoring-browser.mjs` from that
   directory through the disposable authenticated browser fixture, both normally
   and with `AETHER_EXAMPLE_AUTHOR_ONLY=1`. The first run edits a saved example
   through the visible sketch UI and live MCP, checks exact rebuild, shared
   undo/redo and saved reopen. The second creates native example Parts from empty
   documents through the live editor's MCP tools and compares exact volume with
   the shipped recipe. Existing feature names or screenshots alone are not proof.
3. Commit the qualified source locally on `alpha-0.1`. Do not include scratch
   output, secrets or another contributor's unfinished work. Staging refuses
   tracked modifications and validates repository identity and artifact paths.
4. From Studio's operator checkout run:

   ```sh
   python3 dev/rebuild/app_update.py stage --app cad \
     --repo /absolute/Aether-CAD --frontend /absolute/Aether-CAD/dist \
     --backward-compatible
   ```

   Add `--worker /absolute/Aether-CAD/service/aether_cad_service/runtime/native-worker.json` for the product-packaged matching compatible worker.

5. Inspect `app_update.py status`, then activate the returned release and SHA-256
   with the app's exact `--expected-current`. Staging alone never activates.
   Studio copies and verifies releases; later checkout changes cannot affect
   installed apps. Other apps and their versions remain untouched.



Current source setup is local. Installed app bytes remain unchanged.
Stable `0.1` on `master` and remote publication are later release operations.

Hybrid design browser changes require `scripts/verify-hybrid-files-browser.mjs`
through the disposable authenticated fixture with the matching CAD worker. It
checks explicit Part-to-Hybrid copying, internal Parts/Assemblies/Drawings,
Drawing autosave/reopen, Drive navigation and scope isolation. Run
`service/tests/test_native_design_drawings.py` for graph schema 3 round trips,
metadata, recycle/restore and refusal by the previous released codec. Older
installed CAD/Animation readers cannot open schema 3; they refuse rather than
remove embedded Drawings. Do not downgrade the graph version for rollback.

Design thumbnail changes also require `scripts/verify-part-thumbnails-browser.mjs`
through the disposable host on Chromium and with `AETHER_THUMBNAIL_BROWSER=webkit`.
All native robot Parts must have nonblank previews before opening any Part, retain
their images through navigation/reload, and leave the main viewport rendered.
Previewing must not save documents or fetch the container once per thumbnail.

Assembly history playback changes also require
`scripts/verify-assembly-history-browser.mjs` through the disposable browser host
in Chromium and with `AETHER_HISTORY_BROWSER=webkit`. The gate must finish all
224 native Scifirobot source features, preserve solved placements, scroll the
active history row into view, restore the original scene on Stop/Escape, and
perform no document writes. Run the existing Part playback gate on both browsers.
