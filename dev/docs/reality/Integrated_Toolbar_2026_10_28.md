# Integrated CAD toolbar — 2026-10-28

The shared `WorkspaceRibbon` integrated variant combines the former top workspace
selector and both bottom command/tool bars into one container. Its header contains
Design/Assembly/Drawing, application command search, document-specific Undo/Redo,
camera/display/ground controls, Frame, selection filters and toolbar settings. The
category strip and grouped tools retain CAD's catalog, variant pickers, contextual
Sketch tools, feature library and availability checks. Drawing keeps its dedicated
workspace controls.

Aether UI owns the variant, layout, container responsiveness and gallery specimen
(`?demo=integrated-toolbar`, also under Top tool bars). CAD adopts the hash-pinned
`@aether/ui` 0.2.0-alpha.243 package. Existing product preferences retain a separate
integrated-toolbar density key. Old ribbon presentations remain available in the
shared library; CAD uses the integrated presentation by default.

## Qualification

- Shared UI suite: 966 cases covered; the initial icon-catalog fixture false positive
  was corrected and the catalog/integrated tests rerun successfully. Type check,
  library packaging and production gallery build pass.
- CAD suite: 2,035 cases covered, one existing integration skip. Four assertions
  about the superseded presentation were updated and their owning suites passed
  on focused reruns. TypeScript and production/automation build pass.
- DOM coverage verifies Part, Assembly and Sketch history dispatch and disabled
  state; camera intent, display registry state, selection filters, category changes,
  feature library and continued left-panel selection.
- `scripts/verify-toolbar-presets-browser.mjs` exercises the actual integrated
  controls through the disposable authenticated Studio fixture. It checks one
  toolbar/selector, search, tabs, camera projection, wireframe/shaded icons,
  selection filters, settings, container bounds at 1,100 pixels and screenshots.
  Native Union/Subtract/Intersect commits, toolbar undo/redo, saved reopen and
  unavailable-command gating pass with no browser errors or server geometry calls.
- Final logs/screenshots are under `.verification/integrated-toolbar-2026-10-28/`.

This release changes frontend presentation and shared UI dependencies. It does not
change the document format, modeling implementation, server or worker protocol.
Install the immutable frontend package through Studio's app-update tooling; do not
serve the source checkout or overwrite another app's release.
