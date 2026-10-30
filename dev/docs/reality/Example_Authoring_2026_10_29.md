# Native example history and shared editing

The installed Artemis/Orion example contained 34 native Part definitions and
85 sketches/features. Its archive matched the source artifact. The assembly UI
nevertheless showed `Features (0)` and fabricated `Import …` history rows: its
workspace projection interpreted every rendered body as an external import.
The error was in presenting and opening source history, not missing geometry
history in that archive.

`assembly/source-features.tsx` now reads the actual Part definitions used by an
assembly. Each definition appears once, with its real sketches and downstream
features, including suppressed and rolled-back entries. Repeated occurrences
share that source. The history panel uses those actual feature records; genuine
external imports retain their import entries. These are navigation references,
not synthetic features inserted into an assembly document.

Double-click a source row or choose **Open source Part** to enter the normal Part
editor. Built-in examples remain previews until **Save to My files** creates a
personal copy. Saving from a source Part keeps that Part open. Edits then use the
normal sketch/feature controls, validated operations, rebuild, undo and guarded
Studio saving. Live MCP tools address this same editor and canonical document.

## Qualification

- `verify-native-history.mjs` inspects every actual catalog archive, rather than
  trusting recipe counts or pictures. The audit found 12 examples, 158 native
  Parts and 649 sketches/features, with zero import features.
- `package.mjs` refuses an authored example without native sketch history or with
  import features, and checks its real feature counts against build evidence.
- `verify-authoring-browser.mjs` creates the Orion equipment deck, revolved capsule
  and cut-out panel frame from empty documents through the live browser editor's
  authenticated MCP tools. It checks exact volume against the authored example,
  saved native records and reload.
- The same browser gate opens the saved Orion source Part, changes its driving
  circle diameter using the visible sketch UI, inspects that change through MCP,
  changes it through MCP, uses keyboard undo/redo and reopens the saved file. It
  checks exact solid measurements and retained constraint values.
- Source-tree regression tests cover repeated occurrences, source ID routing,
  genuine imports, suppression/rollback and absence of document mutations.

The browser gate has two modes to fit the disposable host's 480-second budget.
Run it through `run-isolated-host.py`, setting `AETHER_QUALIFY_SCRIPT` to
`scripts/examples/collection/verify-authoring-browser.mjs`. Run once normally
and once with `AETHER_EXAMPLE_AUTHOR_ONLY=1`; both must pass.

## Limits

This does not establish parity for every CAD tool. The current example recipes
give circles driving diameters and fixed centers. Many polygon outlines use a
fixed contour constraint; they are editable native sketches, but do not yet have
a full set of human-designed driving dimensions. The audit distinguishes that
limitation from importing a finished solid. No existing user copy is rewritten.

Private run evidence is under `build/Example-Collection/native-history-*/host/`
and `.verification/example-native-history-2026-10-29/`. Final release evidence
must identify the qualified frontend, source commit and selected package.
