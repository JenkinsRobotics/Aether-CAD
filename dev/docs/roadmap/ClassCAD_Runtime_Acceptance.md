# ClassCAD runtime and feature acceptance

Reviewed 2026-10-13. This is the implementation backlog and acceptance standard
for Jonathan's request that Aether CAD meet or exceed the reference. **Full
ClassCAD parity is not implemented or verified.** No comparative performance or
quality advantage has been measured. The review used public documentation;
ClassCAD's commercial engine was not installed or benchmarked.

## Reference scope

All seven public API pages were re-read and their method names compared with
[the reference inventory](ClassCAD_API_Reference.json): Part 76, Assembly 63,
Sketch 50, Curve 21, Solid 21, Drawing2d 11 and Common 22. The total remains 264,
with no name additions/removals on this review. Evidence is recorded in
`.verification/classcad-headless-2026-10-13/reference-check.json`.

Names alone do not establish semantic equivalence. Overloads, accepted geometry,
reference behavior, diagnostics, undo/recompute and exchange fidelity all need
fixtures. The existing [domain table](ClassCAD_Feature_Integration.md#remaining-domain-work)
records the remaining feature families. A tray entry or native solver capability
does not qualify an editor/agent workflow.

ClassCAD documents one API through either a browser Web Worker or a native
session process. Native availability is Windows x64 and Linux x64/arm64; browser
delivery loads the WASM engine and its key. Its SDK includes TypeScript, Python
and .NET clients. These are reference capabilities, not Aether's current support
matrix. Sources: [WASM](https://classcad.ch/docs/wasm/),
[native](https://classcad.ch/docs/native/),
[architecture](https://classcad.ch/docs/architecture/).

## Current Aether and required exit gates

| Area | Current verified scope | Required before parity is claimed |
| --- | --- | --- |
| Engine boundary | CAD owns its FreeCAD adapter, native operations and JSON contracts. Rust Studio hosts isolated requests. | One capability-negotiated CAD command contract across native, local desktop and browser adapters; unavailable operations explicitly refused. |
| Browser execution | React/TypeScript uses native CAD services for current feature development. The older OCCT/WASM path is retained. | Run the same acceptance corpus in a browser worker, with no native host. Verify cancellation, memory limits, UI responsiveness, exact geometry and document round trips. No new feature investment in the parked engine is implied. |
| Native execution | Packaged CAD worker runs real FreeCAD without importing the Studio host. Current acceptance was run on macOS. | Qualify the selected native distributions on macOS, Windows x64 and Linux x64/arm64; isolated concurrent sessions, crash recovery and installed-runtime discovery. |
| Local/offline | Product files and adapters are separated from Studio's PDM authority. | Open, edit, rebuild, save, reopen and export with networking disabled and no Studio account. Packaging alone is insufficient. |
| Typed access | Saved-command descriptors drive scoped CLI/MCP discovery; live tools have product-owned schemas. | A single versioned public command definition and generated clients. Add Python/.NET bindings only when consumers justify them; do not duplicate modeling semantics in those languages. |
| Session behavior | Each saved request is isolated; a program reuses its FreeCAD process across its steps. | Document-ordered commands, stale-result rejection, session fairness, cancellation and resource ceilings under representative company workloads. Measure persistent-worker benefits before changing lifecycle. |
| AI authoring | Live Part/Assembly tools; saved Part discovery/programs/exact proof and saved Assembly inspect/preview/compose. | Remaining feature coverage, actionable bounded diagnostics, deterministic multi-view/section/diff proof, and real provider task acceptance. |
| History and references | Shared canonical document operations; native identities resolved after each program step. | Provenance-based face/edge recovery across feature edits, splits/merges and import/export; incremental rebuild checked against full rebuild. Geometric signatures alone do not meet this gate. |
| Interchange | Existing import/export paths and scoped native round-trip fixtures. | Representative STEP, DXF, glTF and drawing deliverables with units, assembly structure, analytical geometry and documented losses checked. |

ClassCAD's Part/Solid guide itself distinguishes parametric Part history from
direct Solid operations and describes limitations on EntityInjection recompute.
Aether should preserve editable history for its supported operations and test
reference survival explicitly; it should not infer a blanket guarantee from
another product's marketing. [Part versus Solid](https://classcad.ch/docs/api-usage/classcadPartVsSolidApi/).

## Completed source slice: saved Part programs

The saved-file catalog grows from 11 to 14 commands:

- `cad.part.docs` returns paged schemas from the actual executable editor tools.
- `cad.part.runprogram` shares parsing, edit preparation and reference resolution
  with the live editor. Each candidate is rebuilt natively before another step
  may reference it. Only the finished candidate can become a saved revision.
- `cad.part.verify` returns exact native physical properties; it never saves.

The eight program step tools cover primitives, rectangle/circle/polygon sketches,
extrusion, revolve, extrusion depth and suppression. Programs are bounded JSON,
not arbitrary JavaScript or a general scripting language. Limits are 1–16 steps,
64 KiB program text, 512 features and 4 MiB document content. Studio retains
access control, current revision checks, atomic history and retry receipts.
Open editors must reload external saved changes. See the
[agent guide](../../../service/aether_cad_service/AGENT_ACCESS.md).

Acceptance uses an actual 80×50×10 mm plate with a radius-5 mm through bore:
volume `40000 - 250π` mm³, mass approximately 0.3058738943 kg at 7800 kg/m³.
It checks qualified references, reopen, unchanged programs and failure after
earlier successful steps. Rust-host tests exercise read-only denial, stale
revisions, one history revision, repeat receipts, real MCP/CLI transport and
worker cleanup against disposable PostgreSQL. No live user database is used.

## Next implementation packets (planned)

Saved Assembly access is now source-qualified through the existing recipe/solver
transaction, retaining reusable templates and one guarded binary-file revision.
See the [agent guide](../../../service/aether_cad_service/AGENT_ACCESS.md) and
`.verification/saved-assembly-2026-10-13/summary.json`. This expands the source
catalog to 17 commands and requires a matched host/worker promotion.

1. Close persistent mate and nested-assembly authoring gaps from the domain table.
2. Establish one public command contract with runtime capability reporting and
   a shared fixture corpus; make UI, CLI/MCP and backend coverage independently
   queryable. Do not expose all reference names as working commands.
3. Qualify datum axes/points/coordinate systems and independent curve operations;
   route each through ordinary editor history and the same agent operation.
4. Complete drawing command transport, associative views/dimensions and verified
   exports. A viewport capture does not satisfy technical-drawing acceptance.
5. Follow the [engine evolution roadmap](CAD_Engine_Evolution.md) for cold/warm
   measurements, persistent identity, incremental rebuilding and replacement
   kernel/native/WASM qualification. Retain FreeCAD until the exit gates pass.

To substantiate “better,” compare identical models and edits on declared hardware:
geometry tolerances and invalid-model rejection, reference recovery, exchange
fidelity, p50/p95 latency, memory, concurrent-user isolation and task completion.
Success on one plate is acceptance for that workflow, not a suite-wide score.
Source builds remain distinct from promotion into the installed application.
