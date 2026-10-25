# Hybrid design files

A Hybrid design (`.acad`) is one Studio file with internal Part Studios,
Assemblies and Drawings. `?document=` identifies its Drive file;
`?part=`, `?assembly=` or `?drawing=` selects an internal item. Changing items
flushes the current editor and preserves branch/revision context.

The Files panel has two scopes:

- **This design** projects only this container's items. For a standalone document
  it shows that one item and offers an explicit copy into a new Hybrid design.
  Creation in a Hybrid design adds internal items, never sibling Drive files.
- **Drive** starts in the current document's saved directory and uses Studio's
  permission-checked folder/workspace listing. It creates independent files in
  the displayed directory. The bottom tray remains the open-file/item switcher.

`src/design/` holds creation and drawing persistence adapters. Studio owns file
permissions, revisions and Drive hierarchy. CAD's packaged codec transforms a
captured archive; the normal document save compares the original revision before
committing it. Geometry remains in the browser's CAD engine. No host or database
changes are needed.

Embedded Drawings retain their portable document, source Part reference, sheets
and annotations inside the workspace graph. Schema 3 prevents old readers from
silently discarding them, including recycled drawings. Existing designs without
drawings keep schema 1/2. A release rollback does not convert saved files to an
older format. Drawing sources currently use Parts; Assembly drawing sources are
not introduced here. Browser tab folders/order remain device preferences.

The shared Aether UI document controls receive product-scoped creation actions,
so the plus menu and blank-space context menu use the same operation callbacks.
