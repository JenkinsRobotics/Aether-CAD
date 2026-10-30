## Maintainable feature modules — Jonathan, 2026-10-24

Keep each key feature in a focused, clearly named file or directory with its
related tests. Separate document contracts, geometry, UI presentation and agent
adapters by responsibility; UI and agents reuse the same validated operations.
Keep application entry points and routers as composition, not feature
implementations. Extract cohesive helpers as a feature grows instead of building
a single large catch-all file. Prefer readable formatting and explicit resource
ownership over compressed statements. Generated bundles are build outputs;
maintain and review their source modules, never hand-edit the bundles.

## Independent app releases — Jonathan, 2026-10-24

This repository is the authoritative source for this app. Develop on `alpha-0.1`.
`aether-release.json` identifies its frontend and optional worker/player outputs.
Build and verify here, commit the source locally, then stage an immutable
`alpha-0.1.N` package through Studio's operator tooling. Studio serves the selected
release; it must not run a development checkout or overwrite another app.
See `RELEASING.md`. Do not push or promote to master without separate approval.

## GitHub checkout handoff — 2026-10-10

Active development is now in `Aether-CAD`. The existing app snapshot was
imported from `Temp Aether` into this GitHub-linked checkout. Source history and
original starter files are preserved there; this checkout keeps its GitHub
history and origin. No upload or running-installation cutover was performed.
Studio (server, Drive and shared packages) lives in `../AetherStudio`.
Earlier migration notes below describe historical folder names.

# aether-cad contributor contract

## Product ownership — Jonathan, 2026-10-13

This single CAD repository owns the engine, document model, validated command API,
UI and CAD-specific MCP/CLI tools. Keep them as internal modules/packages. Browser,
desktop and headless execution reuse the same product through runtime adapters;
they do not become separate CAD products or repositories. UI and agent commands
must use the same validated modeling operations as coverage is completed.

Studio owns PDM/Drive, permissions, centralized storage, revisions and releases;
CAD retains feature history, local document files, undo/redo and crash recovery.
Generic protocol/transport packages can be shared without moving CAD semantics
into Studio. This records ownership and the implementation target, not completed
offline or agent parity. See the approved boundaries and gates in
`../AetherStudio/dev/docs/roadmap/Aether_Architecture_Integration.md`.
The FreeCAD default and parked-engine policy below are unchanged.

This is the product's new local development home. The previous monorepo is
retained for historical reference and the currently running deployment. Make new
changes here; do not edit both copies. Local migration evidence and suite setup
are in `../AetherStudio/migration/` and `../AetherStudio/suite.py`.
Read `SOURCE_HISTORY.json` for preserved ancestry. The GitHub origin is configured; see SOURCE_HISTORY.json.

- This product owns its domain engine, document meaning, UI, and runtime adapters.
- Consume shared UI/artwork/session/sketch as versioned packages; do not import a
  sibling project's source or copy shared icon geometry.
- CAD's parked `@aether/core` belongs exclusively to CAD. New parametric features
  use its FreeCAD adapter; read its ATTRIBUTION.md before changing it.
- Animation semantics belong to `aether_animation`, not the UI or renderer.
- Shared UI must not import a product engine or implement network transport.
- Keep original artwork and third-party attribution. Never overwrite branding/originals.
- Test changes in the owning project and record remaining limitations honestly.

Original architecture contracts are preserved in the original Aether Studio
checkout. Web frontends remain React/TypeScript. Native desktop packaging is
planned; this extraction does not add Tauri or replace engines with Rust.

## Engine decision — Jonathan, 2026-10-20

Aether CAD adopts the SolidCraft engine (https://github.com/tangency-labs/solidcraft, MIT OR
Apache-2.0; the snapshot in `solidcraft-main/` is 0.16.2) as its parametric geometry engine,
replacing FreeCAD as the default. The engine runs in-process — in the browser as WebAssembly, on
the desktop, and headless — driven by its command registry (`sketch.create`, `solid.extrude`,
`timeline.edit`, 401 commands), the same commands its UI, CLI and MCP agents use. Measured on
this machine (`engine-solidcraft/spike/`): a sketch + extrude builds in 12 ms in wasm (3 ms
native) and a parametric edit in 1 ms, against ~800 ms per FreeCAD request over the host.

What stays ours: the Aether UI shell and widgets, Studio (PDM, Drive, versions, comments),
the agent protocol. What changes: `engine-solidcraft/` wraps the engine for our app; the FreeCAD
worker and `/api/cad/*` geometry services are retired as features move over, one tool at a time
(plan: `dev/docs/roadmap/SolidCraft_Engine_Adoption.md`). SolidCraft's egui UI is not used.
Keep its NOTICE and THIRD-PARTY-LICENSES with every build (`engine-solidcraft/ATTRIBUTION.md`).
This supersedes the FreeCAD-default and "no Rust engine" lines above.

## Engine decision, revised — Jonathan, 2026-10-20 (later the same day)

The product's parametric engine is the **Aether engine**: OpenCASCADE running in-process
(OpenCascade.js in a web worker in the browser, the same wasm in the desktop shell and
headless) with our own modeling layer in TypeScript (`aether-engine/src/kernel`, evolving the
parked `@aether/core`). Rationale: the server must never compute geometry per user (it serves
200+ seats), latency must be the lowest reachable, and the kernel must be production grade
today — OCCT, not SolidCraft's young truck kernel. The SolidCraft bridge from the morning
decision is **not** a product path: it and the FreeCAD worker remain selectable only as
benchmark references (Settings → Renderer → Modeling engine) until the three-way benchmark
shows ours is best and each feature is proven equivalent, then they are deleted. FreeCAD's
Python feature modules are the specification for the TypeScript ports; SolidCraft's structure
(command registry, stable naming, replay timeline, oracle tests) is taken as practice, not code.
No Python in the product. TypeScript and Rust each where they are strongest (Rust: server,
desktop shell, hot numeric routines if profiling shows one; TypeScript: modeling layer,
document, sketch solver, UI). Design: `dev/docs/roadmap/Aether_Engine_Design.md`.

## Releases — 2026-10-20

A CAD generation changes only the `cad` frontend; every other app (ui/gallery, drive, map, …)
is carried over unchanged from the current installation marker. A newer shared `ui` is built
fresh from core/ui at stage time and said so in the ledger, never copied from an older generation.

## SolidCraft reference deleted — 2026-10-20 (evening)

The three-way benchmark (r18) put the Aether engine ahead of SolidCraft and FreeCAD on every
measurement, previews included. The SolidCraft bridge (`engine-solidcraft/`, `src/engine/solidcraft/`,
`public/engine/solidcraft/`, the `solidcraft-main/` snapshot) is removed; its sources are archived at
`../AetherStudio/migration/archive/solidcraft-bridge-20261020.tar.gz` (build output excluded). The
engine selector offers Automatic, Aether and FreeCAD. FreeCAD remains the reference until every
feature is proven; see `dev/docs/roadmap/Aether_Engine_Design.md` for what it still carries.

## FreeCAD reference deleted — 2026-10-20 (night)

Every feature class the FreeCAD worker served is proven on the Aether engine (oracle: 124
fixtures against 113 captured FreeCAD answers; assemblies: 16; the CAD service suite and both UI
harnesses run on it), so the reference is gone: `freecad-engine/` (the Python adapter and the
browser bridge), `src/freecad-translate.ts`, `src/freecad-geometry.ts`, `src/freecad-assembly.ts`,
`src/native-part-evaluator.ts`, the Settings → Modeling engine selector, and the FreeCAD-contract
tests. Archive: `../AetherStudio/migration/archive/freecad-reference-20261020/`. The CAD product
worker (`service/aether_cad_service`) builds with the Aether engine in its Node runner; the host's
`/api/cad/geometry`, `export` and `analysis` routes answer 410 and the host needs no FreeCAD path.
No Python computes geometry anywhere in the product; the Python archive that remains orchestrates
agent commands and project containers (the shared workspace codec) only. The engine is the Aether
engine, full stop; the benchmark tables in `dev/docs/roadmap/Aether_Engine_Design.md` record why.


## Product-owned home — 2026-10-28

The app owns its home-page content, actions and destinations. Use the shared
`@aether/session/home` controller and Aether UI components for consistency; do not
add product actions to Studio. Studio supplies server files, identity and PDM.
Hosted pages never request local folders or install app-drawer clients. Standalone
homes use the local-file adapter; engine availability is a separate capability.
See `../AetherStudio/dev/rebuild/app-owned-homes/README.md` for runtime boundaries.
