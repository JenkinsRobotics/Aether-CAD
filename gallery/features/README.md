# Feature editors

One file per feature — `sketch.ts`, `extrude.ts`, `revolve.ts`, `sweep.ts`,
`loft.ts`, `thicken.ts`, `enclose.ts`, `plane.ts`, `mate.ts` — each owning
that feature's window layout, controls, dependent sub-settings, and
validation. `shared.ts` holds the plumbing they all use (window
construction, parameter-row helpers, and the Core-validated wrapper);
`index.ts` re-exports them.

Every editor is built from two shared pieces and nothing else:

- `@aether/ui`'s `openFeatureWindow` — the window chrome (title, ✓/✕,
  tabs, entities box, parameter rows, nested sub-settings, anchored
  pickers, property footer, error state).
- `@aether/core` — the engine's own types and validators, so an editor
  reports the errors the app would report.

To add a feature: copy the closest existing file, keep its layout in
Onshape order (body type → boolean → selection → end type → parameters →
nested options), and export one `build<Name>Demo(host)`.

These are the reference implementations the Aether CAD editors are ported
from; `Aether CAD/src/plane-window.ts` is the first app-side editor built
on the same window API.

The Sketch specimen and live editor use `src/sketch/window-fields.ts` for their
selection field and display rows. Change the plane through the selection chip's
remove control; do not add a separate button or explanatory paragraph. The gallery
retains the shared window's actual width rather than stretching it to its card.
Every example includes the shared `FeatureWindow.actionIcon` footer via
`src/features/view-controls.ts`; Sketch also retains View normal. Footer actions in
the gallery are demonstrations, while CAD connects them to viewport commands.

The shared UI88 feature window always includes a final accessory row and working
Help (`?`) at the far right. `actionIcon` inserts feature actions before Help; do
not create a product-specific footer. Help opens local instructions and Escape
returns focus without applying or canceling the feature. Optional feature-specific
copy is supplied through `openFeatureWindow({help: {summary, steps}, ...})`.
