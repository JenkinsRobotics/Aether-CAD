# CAD agent access

## Deferred agent modeling benchmark

[Spacecraft MCP benchmark prompt](../../docs/ai-agent/SPACECRAFT_MCP_BENCHMARK.md)
contains Jonathan's reference image and a reusable prompt for a future agent to
model it through the CAD MCP pipeline, verify editable geometry and persistence,
and report capability gaps. Prepared 2026-10-16; **not executed or scheduled**.

## Use the running app — 2026-10-13

The qualified CAD agent build is installed at `http://localhost:8780`, with a
matched Rust host, CAD worker and image-capable provider adapters. Sign in to
Studio, connect a provider in **Plugins → My connections**, open a Part or
Assembly in CAD, then open **AI advisor**. Provider accounts belong to the user;
installing the tools does not sign in to a provider automatically.

Try this in an empty Part:

> Build an 80 × 50 × 10 mm plate with a centered 10 mm diameter through-hole.
> Use one undoable program. Verify its dimensions and exact volume, calculate
> its mass at 7,800 kg/m³, and show me the rendered result.

The live adapter offers 16 Part tools and 5 Assembly tools. Part discovery,
bounded programs, exact measurements and viewport PNG feedback use the same
validated modeling operations as the editor. Assembly discovery/inspection,
recipe composition and undo/redo use the existing native assembly transaction.
Part and Assembly tool sets follow the active document. These are real edits
with normal undo and autosave; the agent must inspect evidence before reporting
success. A failure does not turn into a simulated model.

The installed worker independently built and reopened the plate above:
39,214.6018366 mm³, 0.3058738943 kg. A real browser with a scripted provider also
qualified construction, exact proof, rendered pixels, undo/redo and save/reopen,
plus an eight-instance Assembly. A real provider's sign-in and inference have
not yet been qualified. This is useful modeling support, not full ClassCAD AI
parity: general JavaScript, arbitrary sketch constraints, nested assemblies,
additional mates, drawings, agent file creation/exports, multi-view/section/diff
rendering and offline/WASM execution remain incomplete.

The CLI/MCP instructions below concern saved documents. For an agent to edit the
currently open editor, use the in-app provider integration above.

Aether Studio exposes the installed CAD service through its scoped agent
connections, command API and MCP bridge. Create a connection in Studio's Agent
connections panel and grant CAD access. Saved-content edits require both write
and edit-content permissions; read-only connections can inspect and preview.
The platform owns authentication, file access, optimistic revisions, audit and
recoverable history. No command accepts executable code or arbitrary paths.

## Commands

The installed catalog contains 17 commands: 14 Part commands and 3 Assembly
commands, filtered by the connection's current permissions.

### Saved Assemblies

- `cad.assembly.inspect` reads an ordinary saved `.acad`/assembly archive.
  `assembly_id` defaults to the root. `section` selects `parts`, `instances`,
  `mates` or `assemblies`; `offset` pages twenty entries. It returns the same
  recipe example as the editor, with current reusable Part IDs. No engine starts.
- `cad.assembly.preview` accepts `recipe_json`, rebuilds its Parts and solves
  the candidate with the native engine. It returns exact Part volumes, counts
  and candidate identities without changing the saved file. It returns no pixels.
- `cad.assembly.compose` applies that recipe as one revision, requiring the
  current saved-file `expected_revision`. Native failure or stale authority
  prevents saving. Use an operation ID for safe retry after an uncertain result.

Recipe v1 is the existing editor format: reusable Part templates, instances,
Fastened/Revolute/Prismatic mates and linear/circular instance arrays. Arrays
produce editable instances sharing one Part; they are not associative features.
Unrelated Parts are preserved. Inspection reports positions in millimeters and
rotations as XYZW quaternions. `workspace_revision` is internal to the archive;
use `document.revision` for the next guarded save. Preview does not reserve IDs.

Limits: 4 MiB compressed saved content, 6 MiB aggregate decompressed archive,
2 MiB recipe, 64 recipe templates, 512 total instances and 511 recipe mates.
The native host's existing process/time limits apply. Main saved-file access only;
no branch argument, nested assembly authoring, extra mate kinds, saved undo command
or offline qualification is implied. Studio history retains previous archives.

### Saved Parts

- `cad.part.inspect`: saved feature identities, parameters and body identities.
- `cad.part.evaluate`: native rebuild, volumes (mm³) and topology counts.
- `cad.part.docs`: paged executable program-step schemas and a working plate
  example. Optional `query` and `offset`; discovery does not launch FreeCAD.
- `cad.part.runprogram`: one version-1 JSON program in `program_json`, using
  ordinary editor operations. Native evaluation resolves feature/body references
  between steps. The complete candidate saves once, or nothing saves.
- `cad.part.verify`: exact volume, area, bounds and center; optional
  `density_kg_m3` adds mass/inertia. Twenty bodies per page using `offset`.
- `cad.part.topology`: up to 20 exact face references and snap candidates for a
  specified body, with a pagination offset. Coordinates are millimeters. Treat
  face references as belonging to the returned saved document revision.
- `cad.extrude.preview` / `cad.extrude.setdepth`: propose/change a Blind or
  Symmetric extrusion depth in millimeters.
- `cad.extrude.previewoffset` / `cad.extrude.setoffset`: propose/change an
  Up-to-next end offset. Positive stops before the next face; negative extends
  beyond it. The native engine currently requires a fully covering parallel
  planar stopping face.
- `cad.feature.suppress`: dependency-aware suppression or restoration.
- `cad.feature.move`: move one feature up or down in dependency-valid history.

All commands require `app: "cad"` and a saved file `id`. Feature commands take
`feature_id`; writes also require the current `expected_revision`. Discover
exact argument schemas from the command catalog rather than guessing fields.
MCP tool names replace periods with underscores, for example
`cad_extrude_setdepth`. The installed platform CLI provides the same commands.

- `cad.revolve.preview` / `cad.revolve.setextent`: propose/change angular extents
  of an unsuppressed saved Revolve. Supply `feature_id`, `angle_deg`,
  `second_angle_deg`, `symmetric` and `reversed`; the last two are JSON booleans.
  Primary angle is positive, opposite angle nonnegative, total at most 360°.
  Symmetric centers the primary angle and requires zero opposite angle. Writes
  also require `expected_revision`. Native validation/history rules are identical.
  Requires platform 0.2.0a4 or newer for strict boolean schema validation.

## Safety and limitations

Changes reuse the editor's document parser, history operations and FreeCAD
translator. The complete visible native history must rebuild without diagnostics
before saving; resolved body identities and attached-sketch frames are persisted
through the same editor helpers. Invalid edits and stale revisions do not save.
No-op changes do not create another revision. Preview commands never save.

This is saved-document access: no unsaved editor state, viewport selection,
pixel preview, arbitrary code execution or AI model is included. Reload an
open editor after an external saved edit. Its normal revision checks protect
against overwriting a newer save. Rolled-back histories must return to the end
before these feature edits. Document limit: 4 MiB; feature limit: 512.

### Programs

Programs share `src/ai/program.ts` with the open editor. Supported step tools are
solid primitive, rectangle/circle/polygon sketch, extrude, revolve, extrusion
depth and suppression. Discovery returns their actual argument schemas; these
eight step names are not eight additional saved-file transport endpoints.
Use `{"$ref":"earlier_step.feature_id"}` or `{"$ref":"earlier_step.body_id"}`
to consume a qualified earlier result. If multiple bodies are produced, an
ambiguous body reference is refused rather than guessed.

Limits: 1–16 steps, 64 KiB program, 25-second program budget checked between
steps and before returning. The native host's 35-second process deadline remains
the overall bound; an in-progress native exchange retains its own 25-second bound.
No-op programs do not add revisions. Failed later steps return no partial content.
Use the same operation ID when retrying an uncertain write; Studio records one
receipt and rechecks current permissions. Assembly recipes use the commands above;
script loops, custom
JavaScript, viewport images and WASM execution are outside this adapter's scope.

The Part program/proof and Assembly commands were promoted together on
2026-10-13. Other installations need the matched host and CAD worker versions.

## Installation

`npm run build` builds the web app and the fixed Node.js automation bundle into
`service/aether_cad_service/runtime/runner.mjs`. Build before producing the
Python wheel. The wheel includes that bundle, this guide, the compatibility
manifest and the replaceable FreeCAD adapter/worker with attribution.
Node.js must be available to the server; native commands additionally need the
supported FreeCAD installation. Missing dependencies return an availability
error, never a fallback geometry save. Runtime preparation/finalization is
bounded to 15 seconds; native jobs retain the adapter's own timeout.


## Native Rust Studio adapter

The seventeen installed commands run on native Studio through the packaged
`runtime/runner.pyz` and hashed `runtime/native-worker.json`. Build them with
`npm run build:automation`; both ship in the service wheel. The zipapp includes
CAD's prepare/finalize JavaScript and replaceable FreeCAD boundary with its
attribution, and runs without Python Studio or Python site packages. Configure
absolute Node, Python and FreeCAD executable paths in the Studio operator product
configuration. The engine remains FreeCAD; this is a host integration migration.

Rust owns current user/app/file authority, guarded saves, history and atomic
operation receipts. CLI and MCP exact retries share those receipts, including
validated no-ops that do not add a revision. The worker receives saved content
only; it never reads the Studio document database or accepts executable paths
from an agent request. Workers have a 35s overall deadline and 25s FreeCAD exchange
limit, isolated temporary directories, bounded I/O and Unix process-group cleanup.
Total native memory and abrupt-host-death cleanup remain unqualified. Python3.11+
and a supported FreeCAD must be installed; no browser/native editing fallback is
inferred. In-app agents use the separate live-editor adapter and its published scope.

Assembly archives use a trusted manifest `binary_commands` declaration. The updated
Rust host base64-encodes those inputs, validates returned base64 and decoded size,
and stores the resulting bytes through the same guarded save/receipt transaction.
Part and existing Node commands retain UTF-8 transport. Encoding is not an agent
argument. Both the updated host and CAD worker must be promoted together; older
hosts reject the extended manifest rather than interpreting binary data as text.


## Native browser geometry service

The same hashed zipapp also supplies the six existing stateless CAD browser
engine endpoints. `browser_runtime.py` is shared with the legacy Python service;
`browser-services.json` is the package's canonical service list. `build:automation`
includes both in the installed bundle. Browser sessions and current CAD app access
are checked by native Studio before/after computation. These endpoints consume
caller-provided feature/assembly data; they do not read or write a saved document
and do not accept agent bearer keys. CLI/MCP uses the saved-file commands
and guarded edit authority above. Native `/api/cad/engine` omits the operator's
executable path. The project-container migration below is separate; this does not implement offline desktop CAD. Qualification and installation live in Studio's
`crates/server/NATIVE_PRODUCTS.md`.


## Native project container transport

Rust Studio now supplies the existing project create/read/edit library routes,
including embedded Parts, Assemblies and linked Part snapshots. `project_runtime.py`
calls the canonical workspace codec packaged from `vendor/python/workspace-codec.json`.
Those internal services receive Studio-authorized bytes and never query storage.
Studio owns current permissions, branches, immutable history, guarded saves and
retry receipts. This transport does not add CLI/MCP command descriptors;
these are browser compatibility routes, not extra agent commands.

## Native document settings

The same bundle supplies internal settings-read/settings-edit services using the
canonical CADDocument codec. Units are a build-time resource from the pinned
shared-assets archive, checked against its recorded fingerprint; the wheel and
zipapp include it without any Studio Python dependency. Studio owns saved-file
metadata, source authorization, atomic name/content revisions and retries.
Details, units, properties, delete/restore item, rename and private copy are
qualified. Browser branch selection and uncertain-save handling are preserved.
The legacy adapter refuses non-Main settings instead of silently targeting Main.
Main-file moves and linked-source/feature updates are now integrated as described
below; the long-term engine replacement remains separate.

### Native settings move/update — 2026-10-12

The installed settings codec now also normalizes documents for folder moves and
applies existing feature upgrades/linked-part refreshes. Studio alone resolves
source access, folder destinations and SQL/history commits. Native Main moves
require owner access; named-branch moves remain unsupported. Updates preserve
branch selection and exact committed snapshots across retries, rechecking current
target/source access. These are existing browser settings operations; this does
not expand the saved-part CLI/MCP commands.
