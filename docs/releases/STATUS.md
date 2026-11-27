### Section cut boundaries and rotation orbits — 2026-10-26

Section caps now require material on both sides of each closed intersection loop.
Touching an exterior face no longer paints that original face with a false cap;
duplicate coincident planes do not draw overlapping caps. GPU clipping retains
the Float32 cut boundary, preventing oblique caps from clipping themselves into
speckles. Topology and measurement coordinates remain on the mathematical plane.

Rotation arrows now follow the projected dashed orbit. The full orbit accepts
drags using the same world-space circle and ray/plane angle calculation; pivot
position, normal arrows, Shift snapping, keyboard steps and Escape rollback are
retained. Source review: SolidCraft's viewport section, GPU cut-depth rendering
and gizmo ring picking in the local reference. Section view remains a reversible
inspection cut; Split Body is the operation that changes saved model geometry.
Curved cap measurements retain their explicit display-mesh approximation.

Qualification uses analytic ray/box/half-space pixel checks on WebGPU and WebGL,
coincident/diagonal/disconnected/hollow cap tests, and built-app ring dragging,
pivot retention, cancellation and concurrent measurement. Evidence is in
`.verification/section-cut-orbits-2026-10-26/`.

### Measurement snap anchors — 2026-10-26

Point-to-point and 3-point angle now use the exact topology inference shared
with Place Mate Connector. Hovering a face highlights it and exposes screen-sized
corner, edge midpoint, face-center and analytic circle/shaft/other curved-feature
anchors. Picks acquire within 14 CSS pixels, including just outside silhouettes.
The active point shows a ring and label. Hidden, section-clipped and occluded
surface points are excluded; internal analytic centers are exposed for their own
hovered solid, never through another component. Camera changes re-evaluate picks.

Measurements resolve candidate origins through the occurrence transform. Shared
corners have one selection identity across adjacent faces, while connector picks
retain the chosen face's exact local frame. Inferred points are distinct from
native edge/vertex references used by minimum-distance analysis. No document,
engine, schema or product worker change is required. Mesh-only imports do not gain
invented analytic topology.

Verification: 1,967 app tests passed with one existing skip; 27 final focused
checks; production build; disposable built CAD checks for face clouds, corner
picks outside silhouettes, midpoint/center distances, angle/units/zoom, actual
connector placement, circular centers and shaft-axis stations, cleanup and both
themes. Browser script: `scripts/verify-measure-anchors-browser.mjs`. Worker
manifest and runner hashes match the preceding release.

### Section, Measure, and property content — 2026-10-26

The right auxiliary controls use shared tape-measure and hatched-section artwork.
Section previews a default plane or planar face with a unit-aware panel offset,
reversed cut, plane visibility and include/exclude body scope; accept keeps the
view, cancel restores it, and the active tool offers Edit / Turn off. Measure adds
Objects, Point-to-point and 3-point angle modes, exact native Part body volume,
surface area, bounds and centroid, and camera-tracking viewport labels. Point
modes pick exact model vertices; the second angle point is its vertex. Assembly
world-space vertex/topology measurements are available; whole-body properties
and minimum distance requiring a Part document direct users to the source Part.
Display tools do not change the document. Selection filters and overlays are
cleaned up when the tool closes or another inspection tool opens.

UI alpha.230 / assets alpha.31 apply the StylePropertiesPanel content standard:
flat sections, inline labels, soft fields with units, consistent XYZ controls and
readable property outputs. Popup header and transaction variants are preserved.
Verification: 1,959 app tests plus one existing skip; final 21 focused tests;
production build; disposable built-app browser checks for exact values, vertex
picks, units, zoom-following labels, section offset/flip/accept/cancel/off, and
light/dark UI. The CAD worker manifest and runner hashes remain unchanged.
