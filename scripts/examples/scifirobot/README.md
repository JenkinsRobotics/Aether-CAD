# Scifirobot feature example

CAD-owned reconstruction of the original Aether Model Studio artwork. The source
document contains **120 actual construction features and 39 solid bodies**:
editable circular, polygon and exact arc sketches, revolutions, pads, pockets,
fillets and chamfers. Dimensions are demonstration dimensions, in millimetres;
the authored asset uses +Y up. No imported display mesh is used to build a solid.

From Aether-CAD, with the installed FreeCAD executable available:

```sh
node scripts/examples/scifirobot/regenerate.mjs /absolute/export/directory
```

`author.ts` validates the native `.acpart` and translates it through the existing
CAD adapter. `export.py` evaluates the full document and every individual body
tip with the default FreeCAD engine. It refuses failed features, empty/invalid
body outputs or nonpositive volumes. `generated/proof.json` records the measured
66 solid tips. The export contains the native document, STEP solids, a generated
presentation manifest and triangle meshes in metres.

The shared assets copy belongs at `AetherStudio/core/assets/models/scifirobot/parametric`.
It contains generated data only. The gallery uses exact pre-evaluated tips for
rollback inspection; it does not evaluate suppression, parameter changes or
feature reordering. Those operations remain in Aether CAD. Preview placements
and finishes are saved in the gallery's separate study format, not written back
into the source CAD document. The original seven-group procedural artwork is
retained separately.

FreeCAD is external, replaceable and LGPL-2.1-or-later; see
`freecad-engine/ATTRIBUTION.md`. This example adds no new kernel or solver behavior.
