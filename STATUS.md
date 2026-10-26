
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
