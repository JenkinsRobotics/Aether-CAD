# Aether-CAD releases

This repository owns the `cad` source. Development branch: `alpha-0.1`.
Each independently staged release receives the next `alpha-0.1.N` index.
Package-manager versions and the shared UI dependency version are separate.

1. Restore exact dependencies with `python3 tools/fetch-vendor.py`.
   The default local cache is `~/Library/Caches/Aether/packages`; override it with
   `AETHER_PACKAGE_CACHE`. Unpublished dependencies must be supplied by SHA-256.
   Product source must not import another repository's source files.
2. Run `npm ci`, tests and `npm run build` from `.`.
   Also run the owning engine's tests/type check from `aether-engine/`. Qualify
   the rebuilt worker with `node scripts/verify-headless-kernel.mjs` and
   `node scripts/verify-sketch-regions.mjs`, then run
   `AETHER_TEST_FREECAD=1 <python-3.11-or-3.12> -m pytest service/tests -q`.
   The historical flag enables the required native release tests; geometry uses
   the Aether/OCCT runner. The test oracle imports the hash-pinned workspace-codec
   wheel from `vendor/python/`, never an editable sibling Animation checkout.
   A default pytest run skips release gates and is insufficient for qualification.
   Kernel feature changes also require `scripts/verify-modeling-browser.mjs`
   through Studio's disposable authenticated browser fixture with the candidate
   frontend and matching worker. It covers sketch creation, additive/subtractive
   extrusion, revolve, finishing, shell, mirror, pattern, Boolean, hole, surfaces
   and sheet-metal export. Every step must pass with no server geometry requests;
   there is no tolerant mode. For implementation-only module extractions, compare
   saved models against the previous worker: stable IDs, anchors, measurements,
   body outputs, reference scopes and frames must remain equivalent. OCCT traversal
   order and diagnostic incidence indexes are not stable identities.
   Model-to-sketch projection additionally requires the packaged
   `service/tests/test_native_model_projection.py` cases and
   `scripts/verify-model-projection-browser.mjs` through that disposable host.
   Exercise the actual Include command, local undo/redo, live MCP refusal and
   commit, exact extrusion of the projected profile and saved reopen. Analytic
   curves, collapsed points/diameters and explicit spline approximation require
   independent geometry checks. Independent copies must not be reported as
   associative links; preserve the separate coplanar face-auto-projection path.
   Drawing changes also require `node scripts/verify-drawings.mjs`. Sections require
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
