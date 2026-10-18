# ClassCAD reference and feature integration

Jonathan requested the complete useful feature set, organized in the tool tray
as **Part, Assembly, Sketch, Curve, Solid and Drawing**. This is the target scope;
the first implementation below does not complete ClassCAD or Onshape parity.

## Product and command boundaries

One CAD repository owns the engine, document, command API, UI and product agent
adapters. Studio owns PDM, permissions and central revision/release services.
Retain the FreeCAD-backed exact engine. No ClassCAD engine, SDK or source code
was installed or incorporated in this work.

Part is the document/history domain; Solid contains geometric operations within
that history. Curve currently exposes curves in a sketch. It does not imply an
independent 3D curve engine. Drawing is an associative technical-document domain,
not a screenshot export. These categories organize the same tool definitions and
handlers used by the normal ribbon and command palette.

ClassCAD distinguishes history-based Part operations from direct Solid operations
and expressly limits automatic references and current EntityInjection recompute.
We therefore adopt the useful organization without promising those guarantees
for every Aether feature. See its [Part/Solid guide](https://classcad.ch/docs/api-usage/classcadPartVsSolidApi/).

## Implemented in source — 2026-10-13

- A Features tab groups the six domains; the compact toolbar has a Features entry.
  Existing ribbon variants are discoverable individually. Unimplemented commands
  are disabled with their actual reason. Context guards are shared with search.
- Search projects the canonical catalog, including shell actions such as primitive
  dialogs; it no longer stops at the former 59-command list. Aliases contribute
  keywords while one action appears once in results.
- Cone creates an editable XZ triangle and full Z revolve. UI and agents share
  this primitive operation; native evaluation must succeed before committing.
  No new kernel operation or saved-document format was needed.
- `aether_cad_solid_primitive` creates Box, Cylinder, Cone, Sphere or Torus with
  kind-specific millimeter dimensions. Both generated features are one edit.
- `aether_cad_feature_references` pages direct inputs/dependents from the canonical
  history graph, including suppressed and rolled-back features. Read-only Parts
  permit inspection. It explicitly does **not** certify face/edge correspondence.

Source routing is not the same as acceptance: some existing catalog actions open
tools with limited scope, and some concurrent changes remain unqualified. A
disabled entry is a discoverable gap, never a completed feature.

## Declarative assembly implementation — 2026-10-13

- `assembly-part-template` defines an exact reusable Part before placing it.
- `assembly-from-json` appends templates, instances and supported mates in a single
  candidate archive. Existing IDs and unrelated project Parts are retained.
- Linear/circular **instance arrays** reuse one Part definition. Count includes
  the seed; circular arrays support arbitrary axis/center and optional rotation.
  Members remain individual editable instances. Associative pattern history is
  still a separate missing feature and remains disabled in the catalog.
- UI and live-agent authoring share `CADAssemblyController.composeRecipe` and
  the CAD-owned `/api/cad/assembly-compose` service. Part translation/rebuild and
  native assembly solving precede commit. Saved and native placements must agree.
- Revision/context/access checks refuse stale results; cancel and failed rebuilds
  leave the current archive unchanged. The latest recipe supports one-step
  undo/redo until another assembly edit invalidates that checkpoint.
- Live Assembly agents can inspect templates/instances/mates, compose JSON and
  undo/redo through the same editor. This is live-editor coverage, not a claim of
  an external model test. Saved recipe access is now qualified below.
- The immutable codec13 dependency adds only the already-authored Part16 header
  whitelist. It preserves codec12 and does not qualify the paused move-face tools.

Recipe v1 uses `parts`, `instances`, optional `mates` and `patterns`. Definitions
accept either an existing `part_id` or a native Part `document`. Instance positions
and connector origins are millimeters; rotations are XYZW unit quaternions;
pattern steps are millimeters/degrees. Fastened, Revolute and Prismatic mates use
canonical Part-owned connector frames. Unknown fields, missing/duplicate aliases,
nonfinite coordinates, invalid frames, excess counts, ungrounded instance graphs,
unsupported mates and invalid/native-unbuildable geometry are refused.

Bounds:64 recipe templates,512 total document instances,511 recipe mates,
32 array operations,512 features per Part; existing container limits apply.
No nested assembly flattening, automatic mate inference or silent geometry fallback.
Qualification evidence: `.verification/assembly-recipes-2026-10-13/summary.json`.
The Part AI fixture checks an80×50×10mm plate with a5mm-radius through bore:
volume39214.6018366mm³ and mass0.3058738943kg at7800kg/m³, plus its
actual rendered viewport. Assembly fixtures retain one reusable Part definition
through UI placement, agent array creation, undo/redo and save/reopen.
Source development only; the installed generation is not changed by these builds.

## CAD.AI modules — source implementation, 2026-10-13

`src/ai/` implements the CAD-owned knowledge, program execution and proof layers,
consumed by the existing live-editor adapter. `AetherCAD.Engine`, `.Commands`,
`.UI`, `.AI` and `.Integrations` are internal responsibilities in this repository;
see [ARCHITECTURE.md](../../../ARCHITECTURE.md). Studio retains shared provider
connections, authentication, permissions and PDM.

- Discovery searches the executable tool descriptors, returns paged schemas and
  a plate-building example. It does not advertise the reference API as implemented.
- Part programs compose1–16 ordinary edits with references to earlier feature or
  body IDs. Native evaluation resolves body identities between steps; only the
  complete program commits, as one undoable edit. Invalid steps, native failures,
  cancellation or an intervening edit refuse the program. This is bounded JSON,
  not ClassCAD's arbitrary JavaScript execution environment.
- Exact proof reuses the existing native physical-property analysis: volume,
  area, bounds, center and optional density-based mass/inertia. Results page
  twenty bodies at a time and are rejected if the Part changes during analysis.
  Native compound results now integrate their constituent solids, including
  volume-weighted centers and parallel-axis inertia, fixing the properties panel
  and agent measurements after region cuts.
- Visual proof copies the current product viewport through the shared bounded
  PNG contract. It preserves camera/document state and excludes application
  panels. It is not deterministic multi-angle rendering, sections or pixel diffs.
- Current live tools:16 in a Part,5 in an Assembly. The saved-file MCP/CLI catalog
  now contains14 Part and3 Assembly operations, including program discovery,
  execution, exact verification and saved Assembly inspect/preview/compose.
  Full cross-adapter parity is outstanding; see the
  [runtime acceptance review](ClassCAD_Runtime_Acceptance.md).

Reference: [ClassCAD AI](https://classcad.ai/). No ClassCAD implementation or
runtime was imported. Source changes still require qualified installation
promotion before becoming available on the user's installed host.

### Saved Assembly recipe adapter — 2026-10-13

`cad.assembly.inspect`, `.preview` and `.compose` reuse the canonical archive,
editor recipe preparation and native template rebuild/assembly solve. Inspection
pages Parts, instances, mates and Assemblies with the editor's recipe example.
Preview leaves the source archive untouched. Compose returns one complete binary
candidate for Studio's guarded save and retry receipt; it never writes storage.
The generic product transport now supports manifest-declared binary commands,
with decoded-size checks and unchanged text behavior for existing commands.
This does not add new mate types or nested/associative Assembly features.
Evidence: `.verification/saved-assembly-2026-10-13/summary.json`.

## Remaining domain work

| Domain | Existing foundation surfaced in the tray | Remaining reference scope |
| --- | --- | --- |
| Part | Documents, feature history, rebuild, parameters, construction planes, import | Standalone datum axes/points/coordinate systems; broader parameter/configuration authoring; reliable topology repair and incremental recompute qualification |
| Assembly | Reusable Part templates, atomic JSON recipes, linear/circular instance arrays; insert/ground/remove instances; Fastened, Revolute and Slider; connectors; DOF editing and generic relations | Nested assembly templates, Cylindrical/Planar/Parallel/Spherical authoring, solver-backed rigid groups, dedicated gears and associative component patterns |
| Sketch | Planar entities, dimensions, constraints, trim/extend/split, patterns and projections | Rigid groups; complete reference linking/unlinking, automatic constraint and topology diagnostic parity; wider edit/rebuild fixtures |
| Curve | Lines/arcs/ellipses/splines and editing inside sketches | Independent 3D/composite curves, advanced polylines, shape cleanup and general curve-region boolean operations |
| Solid | Exact primitives, extrusion/revolve, existing booleans, fillet/chamfer, shell, pattern and transforms | Exact twist, sheet-based slicing, full direct-body offset/section coverage; broader feature edit/export acceptance and persistent reference recovery |
| Drawing | Drawing workspace entry and existing workspace implementation | Connected tray commands for base/projected/section views, placement, associative dimensions and verified DXF/SVG/PDF export |

The sixteen Assembly feature families in the supplied reference are all accounted
for in discovery: Part template, Instance (Insert Part), Assembly template, From
JSON, Fastened origin (Ground), Fastened, Revolute, Slider, Cylindrical, Planar,
Parallel, Spherical (Ball), Gear, Group, Linear pattern and Circular pattern.
Only the currently wired authoring subset can execute. A native solver supporting
a joint does not by itself provide a persistent editor command for it.

## Acceptance for every new operation

1. Typed product command with explicit units, validation, cancellation and stable
   document/feature/body references. Never add a second agent-only evaluator.
2. Real native result and diagnostics; failed or stale candidates never commit.
3. Tool-tray dialog, selection and search with context-aware availability.
4. One undoable transaction; edit/recompute and save/reopen without loss.
5. Agent invocation through that operation, with bounded inspection and results.
6. Native geometric assertions and appropriate exchange round trips; browser
   interaction evidence before marking the capability qualified.

The [engine evolution roadmap](CAD_Engine_Evolution.md) adds the backend replacement
track: measured FreeCAD baseline, direct-OCCT/SMLib comparison, persistent topology,
incremental rebuilds and shared UI/agent controls. These gates do not depend on
completing every reference feature or authorize enabling unsupported tools.

Next implementation priorities are the remaining persistent assembly commands,
datum/reference features, unified runtime capabilities and drawing transport.
Do not enable their catalog entries before these gates pass. Persistent topology
repair remains independent work; direct history inspection is not a substitute.

## Reference inventory

[ClassCAD_API_Reference.json](ClassCAD_API_Reference.json) records public method
names and documentation links: Part76, Assembly63, Sketch50, Curve21, Solid21,
Drawing2d11 and Common22 — **264 API methods**, not 264 distinct UI tools.
Create/update/get/delete variants map to one feature workflow. Queries belong in
inspectors or agent inspection; save/load/recalc belong in document commands.
The inventory is the full comparison scope, not a compatibility declaration.
The 2026-10-13 [runtime acceptance review](ClassCAD_Runtime_Acceptance.md) rechecked
all seven API pages without method-name drift and adds native/WASM/SDK gates.

Official references: [documentation](https://classcad.ch/docs/),
[architecture](https://classcad.ch/docs/architecture/),
[assembly construction](https://classcad.ch/docs/api-usage/assembly_building/),
[Assembly API](https://classcad.ch/docs/API/assembly/),
[Part API](https://classcad.ch/docs/API/part/),
[Sketch API](https://classcad.ch/docs/API/sketch/),
[Curve API](https://classcad.ch/docs/API/curve/),
[Solid API](https://classcad.ch/docs/API/solid/),
[Drawing API](https://classcad.ch/docs/API/drawing2d/).

Local verification evidence lives in `.verification/classcad-features-2026-10-13/`.
112 focused tests, TypeScript, production build, native Cone edit/STEP checks and
the119.62-second disposable native/browser gate pass. Actual tray/search dialogs,
agent creation/reference inspection, undo/redo, save/reopen and rendered bodies
are verified; the model is scripted. Screenshots were inspected.
The source update does not promote the installed runtime on port8780.
