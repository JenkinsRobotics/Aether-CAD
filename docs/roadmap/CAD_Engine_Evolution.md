# Aether CAD engine evolution roadmap

Updated 2026-10-13 for Jonathan's FreeCAD replacement direction.

Aether CAD should own its document, parametric features, references and command
API, with a replaceable exact geometry kernel underneath. Keep the working
FreeCAD backend while qualifying that replacement. Compare direct OCCT with
SMLib from NVIDIA USD BRep before choosing the long-term kernel. Rust remains
the target for Aether's native engine orchestration; React/TypeScript remains
the UI. A Rust wrapper alone does not make existing C++ geometry faster.

This is a staged implementation plan. No replacement kernel has passed Aether's
workloads yet. It complements the [feature inventory](ClassCAD_Feature_Integration.md)
and the suite's [runtime decision](../../../../AetherStudio/dev/docs/roadmap/Runtime_Language_Decision.md).
The current FreeCAD default and existing file formats remain in force.

## What the references provide

| Reference | Actual layer | Aether use |
| --- | --- | --- |
| FreeCAD and OCCT | FreeCAD supplies application features and constraints above the OCCT geometry kernel. Our adapter invokes it through Python. | Working baseline and compatibility oracle; separate feature-engine replacement from kernel replacement. |
| NVIDIA USD BRep | The repository includes SMLib solid modeling, a C-style API and bindings as well as USD integration. It is more than a USD schema. | Evaluate its geometry independently from the optional USD exchange integration. |
| SMLibPy and SMLibWasm | Modeling libraries over that SMLib kernel; Python and JavaScript/WebAssembly surfaces. | Study their compact deployment, selections, diagnostics and verification; qualify any reused components. |
| ClassCAD | Feature history, references, constraints and application APIs above SMLib. | Model the separation between geometry and editable CAD semantics in our own engine. |
| ClassCAD AI | API discovery, program execution, numerical checks and visual verification. | Extend AetherCAD.AI over the same validated operations used by the editor. |

Sources: our [FreeCAD attribution](../../../freecad-engine/ATTRIBUTION.md),
[USD BRep](https://github.com/NVIDIA-Omniverse/usd-brep),
[SMLibPy](https://github.com/awv-informatik/smlibpy),
[ClassCAD kernel architecture](https://classcad.ch/docs/architecture/classcad_and_smlib/)
and [ClassCAD AI](https://classcad.ai/).

USD BRep declares Apache-2.0 with separate dependency notices. SMLibPy declares
MIT and bundles Apache-2.0 kernel code. These are distinct from rights to the
ClassCAD application engine or its solver. Pin revisions, preserve notices and
record the actual redistributed dependency set before adoption.
[USD BRep license](https://github.com/NVIDIA-Omniverse/usd-brep/blob/c9c5979f04cea8c38213004d4f04df0dcfb40d05/LICENSE),
[dependency notices](https://github.com/NVIDIA-Omniverse/usd-brep/blob/c9c5979f04cea8c38213004d4f04df0dcfb40d05/THIRD_PARTY_NOTICES.md),
[SMLibPy notices](https://github.com/awv-informatik/smlibpy/blob/0aaa37f2e56962a0bd49dd5a52cc5f01e1e11574/NOTICE).

Upstream qualification risks are concrete. USD BRep documents healing that can
report success despite failure, errors around periodic surfaces, inaccurate
properties at some tolerances, and tessellation/import defects. SMLibPy adds
its own integration routines, workarounds and patched kernel sources. Benchmark
the exact build and patch set: results from SMLibPy cannot be attributed to the
unmodified kernel. These are mandatory regression cases, not grounds for claiming
one backend already wins.
[Known issues](https://github.com/NVIDIA-Omniverse/usd-brep/blob/c9c5979f04cea8c38213004d4f04df0dcfb40d05/KNOWN_ISSUES.md),
[SMLibPy kernel implementation](https://github.com/awv-informatik/smlibpy/blob/0aaa37f2e56962a0bd49dd5a52cc5f01e1e11574/docs/kernel.md).

Reviewed upstream revisions: USD BRep `c9c5979f04cea8c38213004d4f04df0dcfb40d05`,
SMLibPy `0aaa37f2e56962a0bd49dd5a52cc5f01e1e11574`, ClassCAD AI
`000a11c19bb7ebb3d60fc3921dce0fa8607b4907`. Upstream timings and browser/package
claims are comparison leads, not measurements of Aether or evidence of full
parametric/assembly parity.

## Current Aether baseline

| Area | Existing source | Implication for replacement |
| --- | --- | --- |
| Geometry boundary | `freecad-engine/aether_freecad/protocol.py`: describe/build, ordered features, rollback, diagnostics, bodies and tessellation tolerance | Extend/version this boundary and its fixtures; do not invent a second document truth. |
| Native lifecycle | `FreeCADEngine` can retain a child process, but `service/aether_cad_service/native_worker.py` is a bounded invocation that closes it on exit | Hosted calls do not automatically share a warm FreeCAD worker. Measure packaging, process start and transport separately from geometry. |
| Rebuild | `worker.py` creates and closes a document for each job | Full rebuild is the correctness baseline; incremental work needs explicit dependency and cache qualification. |
| References | `topology.py` uses geometric face signatures; `surface_reference.py` checks geometry and rejects ambiguous matches | Deterministic picking on unchanged geometry is not persistent identity through arbitrary edits, splits or merges. |
| Units | Part modeling uses millimeters/degrees; canonical assembly transforms cross a meters/quaternion boundary | Preserve explicit conversions and serialized meaning. A language port must not silently reinterpret values. |
| AI controls | `src/ai/`: discovery, bounded Part programs, exact properties and current-view PNG; live Part/Assembly adapters | Reuse these, then close saved-file/headless and proof gaps. Full agent coverage is not yet implemented. |
| Assembly compatibility | CAD-owned commands still consume the canonical codec/session implementation packaged from Animation | Transfer ownership through a versioned compatibility seam; keep one codec/solver authority throughout, without duplicating animation semantics. |

The October 13 assembly/AI source qualification includes a real native bored
plate, numerical properties, undo/save/reopen and eight rendered assembly
instances. It is functional evidence, not a kernel speed comparison. Details:
`../../../.verification/assembly-recipes-2026-10-13/summary.json` and Studio's
[agent coverage](../../../../AetherStudio/dev/rebuild/AGENT_COVERAGE.md).
Previously recorded startup/pad timings in adapter comments are historical
microbenchmarks, not current hosted latency or company-load capacity.

## Product architecture and language boundaries

```text
Aether CAD repository
  UI / CLI / MCP / in-app AI
             |
       Commands and document transactions
             |
       Engine
         Document + feature graph + persistent references
         Sketch constraints + assembly constraints
         Geometry adapter -> FreeCAD baseline / candidate kernel
         Inspection + tessellation + exchange

Aether Studio: accounts, PDM, permissions, revisions, collaboration, job scheduling
```

Keep the logical `AetherCAD.Engine`, `.Commands`, `.UI`, `.AI` and
`.Integrations` namespaces already defined in [ARCHITECTURE.md](../../../ARCHITECTURE.md).
Part, Assembly, Sketch, Curve, Solid and Drawing remain feature domains within
CAD. No additional product repositories or public CAD servers are needed.

Target Rust for the document/feature runtime, scheduling integration and native
adapters. Retain the mature C++ kernel through a narrow owned binding with opaque
handles, explicit ownership and structured errors; contain native faults in a
worker process. Rust does not make foreign C++ memory automatically safe.
Python remains the current FreeCAD adapter and can be an isolated comparison
harness. Avoid introducing a new scripting language, VM or parallel geometry
implementation simply to resemble ClassCAD.

Native desktop and headless adapters should run locally without Studio or an
account. Browser execution requires a separately qualified WebAssembly worker;
the current hosted FreeCAD path and parked OCCT browser path are not equivalent.
Measure memory, load size, cancellation and feature parity on each supported
browser. SMLibWasm is a useful feasibility reference, not a drop-in replacement
for Aether feature history. Keep WebGPU/WebGL presentation decoupled from exact
geometry: a GPU display backend does not imply GPU B-Rep operations.

## Backend controls to converge

These are contract responsibilities, not newly available endpoint names. Evolve
the current product protocol with compatibility tests and generated bindings.

| Control | Required behavior |
| --- | --- |
| Describe and discover | Versioned schemas, supported operation/parameter combinations, runtime availability, limits and units. Generate UI discovery and agent docs from the same executable catalog. |
| Open and inspect | One document snapshot/revision; paged feature tree, bodies, references, constraints and diagnostics. Workspace handles are scoped to the authorized caller. |
| Preview and apply | Evaluate a candidate against an expected revision. Preview never saves; apply publishes once, only after validation. Cancellation/stale results cannot commit. |
| Rebuild and resolve | Full or affected-subgraph evaluation with feature outcomes and explicit reference resolution states. No silent substitution of a nearby face. |
| Execute programs | Compose existing commands, bounded resources and step references; return useful model IDs and results. Preserve the current 1–16-step declarative Part program until expanded semantics are qualified. |
| Verify and render | Exact-geometry checks, measurements with units/tolerance/error information, immutable camera-controlled snapshots, sections and before/after proof. Current viewport PNG is only the first subset. |
| Import and export | Validate input and result, preserve original source, declare lossy conversions; use product file adapters. STEP geometry does not replace editable feature history. |
| Jobs and recovery | Progress, deadline, cancellation, backpressure, crash isolation and replay from a committed document. Normal editing undo/redo stays coherent across UI/CLI/MCP. |

Command envelopes need protocol/document versions, request and document IDs,
expected revision, explicit units and deadlines. Results need applied revision,
capability/error codes, feature diagnostics, reference provenance and timing
breakdown. A transport retry must not apply an edit twice. Studio retains
authentication, authorization and durable storage; a standalone file adapter
provides atomic local saving and recovery without a SQL/PDM server.

## Reliability and performance work

1. **References before more heuristics.** Track generated/modified/deleted
   topology through feature evaluation. Store references using producing feature,
   output role, source lineage and occurrence identity. Geometry can assist
   disambiguation; raw FaceN indices, hashes and nearest-center matching are not
   the durable identity. Splits and merges can produce multiple candidates or an
   explicit broken reference. Preserve repair/undo and test dependent sketches,
   fillets, mates and drawing dimensions after upstream edits.
2. **Incremental rebuilds with a full-build oracle.** Cache immutable feature
   results keyed by dependencies, parameters, units, tolerances and backend build.
   Invalidate affected descendants; compare every incremental fixture with a
   clean rebuild. Reuse assembly definitions and tessellation for instances.
   Bound and evict caches; they must never become the only copy of a document.
3. **Measure warm execution before replacing languages.** Separate queue wait,
   process/bundle startup, decoding, feature work, topology extraction,
   tessellation, encoding and first presented frame. Test a bounded warm worker
   pool against the current invocation model, with per-document serialization,
   tenant isolation and crash recycling. Audit kernel thread safety before using
   threads; cancel through process isolation when the kernel cannot interrupt.
4. **Separate exact geometry from display quality.** Cache adaptive tessellation
   by body/revision and quality; preserve face-to-triangle mappings for picking.
   Coarse previews may improve interaction but must be labeled and never used as
   the authority for STEP, constraints or physical properties. Verify normals,
   tiny features and screen-space quality at target display scales.
5. **Agent verification as a normal service.** Extend existing numerical proof
   with validity and geometric assertions; add fixed-camera multi-view, section
   and diff renders with renderer/version metadata. Use numeric assertions plus
   visual tolerances across GPUs, not universal pixel identity. Deliver the same
   commands and checkpoints through live editor, saved-file CLI and MCP.

## Candidate evaluation

| Candidate | Purpose | Required evidence before selection |
| --- | --- | --- |
| Current FreeCAD/OCCT | Baseline, compatibility and interim shipping path | Stage timings and accuracy at current production settings; full feature and failure corpus. |
| Aether runtime over direct OCCT | Initial replacement candidate consistent with the runtime decision | Reimplement needed FreeCAD feature semantics and solver integration, preserve documents/references, prove native/WASM packaging and measured benefit. |
| Aether runtime over SMLib from USD BRep | Alternative exact kernel candidate | Same corpus, known-issue regressions, independent exchange checks, pinned patches/build/licenses, solver/feature-history plan and deployable platform builds. |
| SMLibPy/SMLibWasm | Useful prototype and reusable-component candidate | Distinguish wrapper improvements from kernel results; qualify patch maintenance and direct Rust binding feasibility. Avoid making Python a new permanent requirement by accident. |

Start with the existing OCCT path as the continuity candidate and SMLib as the
challenger. Do not switch kernels per feature in a saved history without explicit
conversion and identity rules. Native B-Rep handles are not interchangeable.
A custom Rust NURBS/boolean kernel is not the first replacement milestone;
owning Aether's feature layer over a proven kernel is already substantial work.

### Workload and quality gates

Build a product-owned runner and manifest from existing native tests, with the
same dimensions, tolerances, mesh quality and requested outputs for each backend.
Use analytical fixtures in addition to the FreeCAD oracle; implementations may
agree on the same error. Compare geometry and design intent, not identical face
counts or binary exports across different kernels.

| Workload | Evidence |
| --- | --- |
| Plate with a centered bore | 80 × 50 × 10 mm, bore radius 5 mm through thickness: volume `40000 - 250*pi` mm³; centroid (40,25,5) mm; bounds, topology validity and STEP round trip. |
| Feature families | Extrude limits/draft, revolve, loft/sweep, boolean, fillet/chamfer, shell, patterns and direct edits; accepted cases plus expected refusal without mutation. |
| History and references | Parameter edits at the start/middle/end of 10/100/500-feature histories; rollback, suppress/restore, split/merge ambiguity, full versus incremental agreement. |
| Curved and difficult geometry | Periodic seams, tangent contacts, near-coincident faces, thin walls, slivers, large coordinates, small parts, imported NURBS; bounded tolerance and no silent repair loss. |
| Sketch and assembly | Under/fully/overconstrained sketches; redundant/conflicting constraints; repeated parts and real mate solves at 10/100/1000 instances. Report supported subsets separately. |
| Interchange and recovery | STEP analytic geometry and assembly round trips, units/names/placements, existing native document migrations, kill/timeout/retry/reopen. USD BRep separately where useful. |
| Human and agent workflow | Same command sequence through UI, CLI and MCP; one valid history, save/reopen, numerical proof, fixed views and failure preservation. |

Pin hardware/OS, CPU/memory, power state, compilers, runtime/kernel/patch hashes,
input hashes, tolerances and cache mode. Record cold runs separately from warmed
runs. Start with 10 cold trials and at least 100 warm samples for selected latency
fixtures; publish sample count and distributions, not a single best run. Record
p50/p95, peak process-tree memory, startup/package size, result bytes, failures and
queued work at 1/4/16/32 concurrent jobs. Report throttled/rejected jobs separately.
A company's 500 connected users are not 500 simultaneous geometry rebuilds.

Initial **proposed** budgets, to calibrate against that baseline:

- Selection/cached inspection: p95 at most 16 ms on the reference workstation.
- Small warm exact preview: p95 at most 100 ms; small committed edit including
  presentation: at most 250 ms locally. Heavy operations remain cancellable jobs.
- Reference viewport: at most 16 ms per frame at a declared resolution/model size;
  measure separately from geometry and preserve the suite cold-start target.
- A replacement must pass every required compatibility/quality fixture and have
  no unexplained p95 or memory regressions above 10% on named release workloads.
  Seek at least 25% improvement in the primary measured bottleneck, or an explicit
  documented portability/quality benefit. Speed cannot compensate for bad geometry.
- Set per-fixture numerical tolerances before comparison: for the analytical plate,
  start with relative volume error ≤ 1e-7 and coordinate error ≤ 1e-6 mm.
  Scale complex/imported-case tolerances to source accuracy and declared model
  tolerance; never loosen them silently to obtain a pass.

The older blanket “all local commands under 16 ms” target applies to interaction
and cached operations, not arbitrary exact modeling. Record calibrated budgets
in the manifest before candidate selection. No candidate performance result is
claimed by this roadmap.

## Implementation phases and exit criteria

| Phase | Deliverable | Exit criterion |
| --- | --- | --- |
| 1 Baseline and controls | Versioned capability/diagnostic inventory, stage timing, canonical workload manifest and current FreeCAD report | Reproducible cold/warm/end-to-end results, unsupported operations explicit, no saved-document change. |
| 2 Improve current execution | Qualified worker reuse, cancellation, bounded caches and preview quality where measurements justify them | Faster measured workflow with tenant/crash/retry isolation and identical accepted results; regressions pass. |
| 3 Kernel feasibility | Isolated direct-OCCT and SMLib prototypes, native builds and one browser-worker slice | Same analytic/feature/reference/exchange fixtures, memory/startup report and dependency/patch inventory; written candidate decision. |
| 4 Aether engine runtime | Rust-owned document/features/reference graph and validated commands over the selected adapter, ported by feature family | Edit/rebuild/undo/save/reopen, constraint semantics and UI/CLI/MCP parity for each completed family; FreeCAD stays default for incomplete coverage. |
| 5 Replacement qualification | Native offline, hosted and browser capability matrices; migration and recovery rehearsal on copies of real documents | Required workflows match, unresolved references are surfaced, numerical/render/exchange and multiuser job gates pass. |
| 6 Controlled adoption | Explicit document conversion, retained source snapshots and qualified installation | No in-place destructive conversion; only supported documents switch; reopening unsupported/new documents never silently downgrades features. |

Reference identity design starts in phase 1 and is exercised by phase 3; it cannot
be deferred until after a kernel is selected. Agent proof work can improve the
current FreeCAD path while runtime work proceeds. Complete the existing feature
roadmap through the default adapter until an individual replacement slice passes.
The parked TypeScript engine is a compatibility/design reference, not a parallel
new-feature lane.

Preserve original files, feature parameters, expressions, units, attachments,
instance definitions, materials, metadata and unknown extensions throughout
migration. Record engine/format versions and reference-conversion diagnostics.
Test importing old documents and editing/reopening them, not just viewing an
exported shape. If a new feature cannot be represented by the old engine, retain
the new document and its original snapshot; do not promise reverse conversion.

## First implementation packet

- Add product-owned stage telemetry and a benchmark runner around the existing
  native path; instrument both the inner engine and outer invocation so startup
  and transport costs stay visible. Use an isolated development host.
- Seed the manifest from plate/bore, compound properties, sketch constraints,
  referenced extrusion, curved surfaces, assembly recipes and saved-file tests.
- Version the capability matrix for native, browser, live-agent and saved-file
  adapters. Add contract tests preventing docs from advertising unavailable tools.
- Turn a measured bottleneck into a bounded optimization, then rerun the same
  workloads before starting any kernel migration.

USD exchange is a later optional adapter for exact geometry and scene integration
with other tools. Map/Animation may consume documented exports and metadata without
importing CAD's engine source. A CAD kernel change must not force every Aether app
to adopt a new document model or acquire an additional server dependency.
