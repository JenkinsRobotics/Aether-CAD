# CAD 0.2 — FreeCAD gap closure

Started 2026-11-08 from released master (815ab4b). Development: alpha-0.2.
0.1.0 and its published installers remain frozen. No 0.2 deployment is implied.

## Baseline

FreeCAD is not a shipped CAD runtime dependency. Its installed application and
benchmark scripts remain comparison tools. Historical measurements have moved
out of engine source into test-fixtures/reference-measurements, with provenance
and unchanged bytes. This is reference isolation, not a parity claim.

The October 30 comparison contains historical rows; the November 5/6 additions
supersede some of them. For example, Drawing chains are implemented; ordinate
annotations and viewport point picking remain open. Do not repeat completed work
or interpret an old checkbox as current qualification.

## Development order

1. Establish 0.2 baseline tests and triage any remaining 0.1 CI failures.
2. Drawing usability and dimensions: viewport point selection, ordinate dimensions,
   persistent attachment references, and assembly drawing/BOM sources. Each needs
   UI and agent authoring, edit/undo/redo, export, save/reopen evidence.
3. Solid modeling: verify the current ledger before implementing remaining partial
   fillet, loft-guide/end-condition, face-pattern and offset-face gaps. Preserve
   shared controls and visible failed selections; no cosmetic enabled options.
4. Sketch: associative model references, carbon copy, solver scaling and units.
5. Benchmark model rebuild, display and sketch solve separately. Recheck the robot
   and annular-shell fixtures; no universal faster-than-FreeCAD claim without data.
6. Review remaining FreeCAD workbench coverage, then retire executable comparison
   scripts and the downloaded reference. Keep fixture measurements, licenses and
   provenance. SolidCraft comparison follows this FreeCAD pass.

## Reference retirement gate

The installed FreeCAD reference has not been deleted. Its location is
/Applications/FreeCAD.app; it is not part of this repository or an installer.
Remaining comparison tools are scripts/benchmarks/native/freecad.py,
solver-freecad.py and their orchestration scripts. Removal waits for the gaps
above to be reconciled and any useful behavior captured as independent Aether
requirements/tests. Captured numerical expectations remain test assets; deleting
or renaming them is not a substitute for closing functional gaps.

Detailed evidence and historical cases: FreeCAD_Comparison_2026_10_30.md,
Onshape_Feature_Parity.md, Handoff_Parity_2026_11_05.md.

## First-pass validation

143 solid oracle and assembly solver tests passed; TypeScript and diff checks
passed. Relocated fixture bytes match the released originals exactly. The two
packaged Python automation tests were attempted but could not collect in the
current shell: the host `core` test dependency is unavailable (Python 3.11 also
lacks pytest). This is an environment gap, not a passing service qualification.
The updated fixture path was independently checked.
