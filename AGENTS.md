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
