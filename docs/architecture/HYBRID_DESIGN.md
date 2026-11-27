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

## Part and Assembly workflow

Create Parts inside **This design**, then open an Assembly and use **Insert Part**
or drag a Part from Files onto the viewport. The first active occurrence is
grounded automatically; later occurrences are free. Each inserted Part has an
origin connector, so the supported mate tools are available without separately
creating a datum. Additional connectors can locate mates away from that origin.

Double-click a component, or choose **Component properties** from its right-click
menu, to rename it, set position/XYZ rotation, ground it or change visibility.
Each coordinate vector occupies one row using the shared UI controls. An active
mate controls a free component's placement: change its mate coordinate or
suppress the mate before moving it directly. Edits are validated as one atomic
Assembly change and support undo/redo.

**Open source Part** opens the component's internal Part Studio. Save/edit it and
return to the Assembly through Files; all occurrences sharing that definition
use the edited geometry. An external saved Part inserted from **Other designs**
is an independent copy. Nested Assemblies and associative external design links
remain outside this workflow.
