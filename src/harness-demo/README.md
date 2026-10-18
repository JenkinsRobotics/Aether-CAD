# Aether CAD harness demo

Launch `/cad/index.html?demo=harness`, or choose **Open harness demo** on the CAD start screen. The shared UI gallery links it under Widgets → Panels → Electronics + instruments.

- **Layout:** drag components, choose Bundle and click two endpoints, select a bundle to set its physical length or split it with a branch point.
- **Harness:** choose Wire and click source/destination pins. Select a wire to edit its color, stripe, gauge, part and identifier. Double-click its path to add a routing point; drag or Delete an individual routing point. Escape returns to selection.
- **Properties:** rename parts/pins, pair equal-size connectors, fill blank connected signals, and show a wiring table separately in each view. Drag the table header to reposition it.
- **Groups:** choose members in the left Groups panel, then create, rename, move, lock or ungroup them. Layout and Harness positions are independent.
- **Connections / Parts:** searchable, sortable shared tables; double-click part fields to edit. Quantities and lengths update from the physical layout.
- **Revisions:** name and restore browser snapshots. Undo/Redo also applies to connector deletion, routing, grouping and restores.
- **Save file / Open:** portable `.aetherharness` JSON. Browser autosave is a local demo convenience. Download files for durable checkpoints.
- **Document menu / Settings:** export SVG, connections CSV and BOM CSV; restore the example. Shared settings contain suite appearance, toolbar, sidebar and safety spacing controls.

The initial file is `public/examples/harness-demo.json`. Model coordinates are diagram coordinates, not manufacturing scale. Generic housing faces do not certify physical mating. The demo is separate from the solid-model CAD document and does not invoke the OCCT/FreeCAD engines.

Full feature inventory, ownership and remaining implementation gates: [`Aether_CAD_Harness.md`](../../../dev/docs/roadmap/Aether_CAD_Harness.md).
