# SolidCraft 0.47.0 Parity Audit & Improvement Plan (2026-11-22)

This document records the factual source-level comparison between SolidCraft 0.47.0 (`solidcraft-main/`) and Aether-CAD (`aether-engine/` + `src/`), superseding the historical 0.16.2/0.23.0 snapshots. Aether-CAD retains its OpenCASCADE (`aether-engine`) kernel, canonical TypeScript document model, and Aether UI shell (never copying SolidCraft's LICENSE-BRAND UI kit, themes, or icons).

## Summary by Domain

### 1. Sketch
- **Already at parity or ahead:** Core 2D primitives, 5 slot variants, elliptical arcs & ellipse quadrant constraints, Normal constraint, 2D vector booleans, pattern instance suppression/repair, retained text with embedded font digest, dimension driver links, DXF/SVG import, DXF export.
- **Key gaps to close:**
  1. Monolithic solver hard-capped at 512 constraints / 512 coordinates (`solve.ts`) and 256 diagnostic coordinates (`diagnostics.ts`) — needs connected-component decomposition, lifted limits, and exact per-constraint redundancy attribution (`redundantIds`, `determinedBy`).
  2. Axis-bisection dragging (`drag-entity.ts`) — needs feasible-manifold damped least-motion dragging.
  3. Missing high-frequency dimensions: `arc-length`, `arc-sweep`, `slot-overall-length`, `line-circle-distance`, `point-circle-distance`, `circle-circle-distance`, `linear-diameter` (2× across centerline), `line-angle`, `toggleRadiusDiameter`, and auto-scale sketch on first driving dimension.
  4. Missing creation/modify tools: `centerline` line type, analytic construction lines (horizontal, vertical, angle, parallel, perpendicular, bisector, tangent), 2-/3-tangent circles, rounded rectangle, divide curve (`point-along`), equation curves, multi-side/symmetric offset + break offset association, loose-ends untied detection + auto-tie, sketch replace, and constraint-adapting rotate/scale.
  5. Fragile face attachment (`planar-face-anchor.ts` + `part-evaluator.ts:807-825`) requiring exact unchanged area & centroid — needs resilient producer/normal/cap-side matching and associative model projections.
  6. 3D sketch constraints/dimensions & exact 3D arc (`curve3d.ts`).
  7. Granular agent/automation sketch commands (currently only 6 basic tools in `live-commands.ts`).

### 2. Solid, Surface, Construction, Sheet Metal, Plastic & Frames
- **Already strong:** 50+ evaluated OCCT feature types, full-featured Extrude/Revolve/Chamfer/Shell/Draft/Boolean/Split/Pipe/Boundary Fill/Surface Extrude/Stitch/Thicken, generic agent CRUD (`feature_add`/`update`/`delete`/`move`).
- **Key gaps & bugs to close:**
  1. Bug fix: `aether-engine/src/kernel/features/pattern.ts:57` rejects `sweep`/`loft`/`hole` despite `patternSourceTypes` declaring them.
  2. Unwired UI/ribbon gaps: `solid-variable-fillet` & `solid-face-fillet` placeholders in `src/tools/solid.ts` (already implemented in `filletEditor`), `bounding-solid` missing UI editor + 6-side margins, `shell.direction="both"`, `loft.startPoint`, `rest.alongMillimeters`, `surface-revolve.axisReference`, `surface-loft` >3 sections, `surface-fair.faces`, `output-3mf` ribbon button, advertised-but-throwing `BREP` import (`BRepTools.Read`), and reference-mesh export.
  3. Modeled threads (`solid.thread modeled: true`, multi-start, left-hand, trapezoidal/acme/buttress/pipe) + `model.threads`.
  4. Sheet Metal: `sheet-unfold` skipping `sheet-fold` bends and flange cuts/perforations, non-destructive `sheetFlatPattern()` with bend lines + layered DXF (`OUTLINE`/`CUT`/`BEND_UP`/`BEND_DOWN`/`BEND_NOTES`), named Sheet Metal Rules library.
  5. Construction geometry: missing `axis-point` plane, `square-to-line` plane, `through-cylinder` axis, angled `midplane` bisector.
  6. Wrap/Emboss (`emboss` feature wiring `solid-wrap-emboss`) and Frames/Weldments (`frame-member`, `frame-end-cap`, profile library, cut list wiring `src/tools/framing.ts`).
  7. Surface depth (`surface-match`, `surface-fair` G1 border preservation, `surface-blend` G1/G2, `surface-trim` by face), Fillet G2/setbacks, Loft guide rails/end conditions, Plastic Boss ribs/root fillet & Rest hollow & Snap Fit `base_height`.

### 3. Inspection, Analysis, Model Queries, Parameters, Configurations, Materials & Timeline
- **Already strong:** Interactive Measure, Live Section View, OCCT properties/interference/clearance/compare/continuity/curvature_comb/isocurve/minimum_radius, dimensional expression engine, history playback, folders, rollback.
- **Key gaps & bugs to close:**
  1. Bug fix: `applyConfigurationRow` / `openConfigurationsWindow` mutate variable expressions without calling `updatePartDocumentVariables()`, causing stale expression errors; `validateConfigurations`/`validateConfigRules` not called in `validatePartDocument()`; `src/react/panels/configurations.tsx` displays a dead "not available" stub.
  2. Bug fix: `analyzePart({ kind: "properties" })` silently ignores `bodyIds`.
  3. Physical Materials end-to-end: built-in + custom document material library, UI assignment persisted to `doc.bodyProperties`, automatic density lookup in `properties`, `Measure`, combined Center of Mass, and Assembly BOM.
  4. Part-Level Parameters panel (replacing dead `src/react/panels/parameters.tsx`, wiring `variable-tools.ts`, adding `renameVariable` & delete guard) + 3D Feature Parameter Expressions driving feature dimensions automatically.
  5. Configurable Surface Analysis Shaders (Draft pull vector & angle, Zebra stripe count, Curvature Map radius threshold, Accessibility direction, Environment Map) + Inspect sidebar wiring.
  6. Clearance/Interference depth (`bodyIds`/`against`/threshold/`nearest`/closest `from`–`to` points/mesh-unchecked reporting), exact `classify_points`, `parameter_sweep` & `parameter_variants`, Continuity G0 gap + tolerances, Minimum Radius trimmed-face check, clean `model.faces` / `model.edges` / `model.body_features` / `model.threads` / `model.mesh`.

### 4. 3D Annotations/Notes & 2D Drawings
- **Already ahead of SolidCraft 0.47:** Connected browser Drawing workspace UI (`DrawingWorkspace.tsx`), Center Marks, exact OCCT HLR + Boolean section hatching, embedded subsetted-font vector PDF, hole-clipped planar Decals.
- **Key gaps & bugs to close:**
  1. Bug fix: `src/drawing/presentation.ts:22` hardcodes `snap_points: []`, making the Drawing "Snap points" toggle non-functional.
  2. Interactive Drawing viewport: populated snap points, hit-testing (`drawingHitTest` / `drawingLineAt`), pan/zoom, click-to-place and drag support.
  3. Resilient Drawing attachments: view-relative topological refs + graceful `dangling`/`lost` states instead of aborting `buildDrawing()`, plus `repair`.
  4. Missing Drawing dimensions & standards annotations: Ordinate dimensions, Tolerances & `{value}` override text, Model Dimensions import (`from_model`), Leader Notes with dynamic fields, Centerlines, Hole Callout, Chamfer Note, GD&T Feature Control Frames, Datum Symbols, Surface Texture, Weld Symbols, Revision Table & Tags, ISO/ANSI sheet templates, Flat Pattern View, and `auditDrawing()` (`drawing.check`).
  5. Current-View DXF Export (`file.export_view_dxf` via `hidden-line.ts`, wiring `output-dxf`).
  6. Persisted 3D Notes / PMI Annotations on `PartDocument` + live `src/react/panels/notes.tsx` (replacing mock placeholder).

### 5. Assembly, Joints, Motion, Standard Parts, Files/IO & Agent Surface
- **Already strong:** Transactional assembly controller, 12-kind LM solver, contact sets with exact OCCT overlap, hierarchical/flattened BOM, 7 ISO standard fastener families, STEP/STL/OBJ/GLB/3MF Part export, STEP/IGES/STL/OBJ/PLY/OFF import.
- **Key gaps to close:**
  1. Assembly solver & kinematics: joint limit enforcement in `assembly-solver.ts`, true damped-LM Inverse Kinematics for `joint.reach` (replacing rest-transform translation hack), `joint.drive` (clamping + contact stop), `joint.sweep`, `joint.find_limits`, and `cam` relation evaluation.
  2. Assembly inspection & BOM: wire `assembly-mass`, `assembly-clearance`, `assembly-interference` in `src/tools/assembly-inspect.ts`, multi-occurrence world mass/COM/inertia (parallel-axis theorem), BOM `bom_type`/revision/renumber/geometry-derived mass.
  3. Standard parts: expand M2–M30, ISO 7380-1 button head, ISO 10642 countersunk, ASME/ANSI inch UNC fasteners, and bore/hole seat resolver (`resolveFastenerSeats`).
  4. IO: URDF export, ASCII STL, OBJ `.mtl`, deflated 3MF, BREP import, reference-mesh export, `output-3mf` / `output-dxf`.
  5. Unified Agent/MCP command discovery (`aether_cad_commands`, `aether_cad_describe`) + full live tool parity across Sketch, Inspection, Parameters, Configs, Materials, Notes, Selection, Standard Parts, Export, and Drawings.

## Completed Parity Implementation (2026-11-22)

### Sketch (`aether-engine/src/sketch/`, `aether-engine/src/document/curve3d.ts`)
- Connected-component LM constraint solver (lifted to 4096 constraints / 2048 vars per component), 2-pass Gram-Schmidt exact redundancy attribution (`redundantConstraints`, `determinedBy`), feasible-manifold soft-target dragging with bit-exact `fix` snap.
- 9 new dimensions/constraints (`arc-length`, `arc-sweep`, `line-angle`, `linear-diameter`, `point-circle-distance`, `line-circle-distance`, `circle-circle-distance`, `slot-overall-length`, `point-along` with `gapMode`).
- Creation & modify tools: `centerline` paths, 10-mode analytic construction lines, 2-point & 2-/3-tangent circles, rounded rectangle, curve division, equation curves (parametric/explicit), toggle radius/diameter, auto-scale first driving dimension, advanced multi-instance/symmetric offset & break association, loose-ends inspect/tie, sketch replace.
- 3D sketch exact 3-point circular arc (`curve3d.kind === "arc"`) and 10-constraint 3D LM solver (`solve3DConstraints`).

### Solid, Threads, Sheet Metal, Construction, Emboss, Frames & IO (`aether-engine/src/kernel/`, `aether-engine/src/document/`)
- Fixed feature patterning for `sweep`, `loft`, and `hole`.
- Modeled 3D helical threads (V60, trapezoidal 30°, ACME 29°, buttress; internal/external; left-hand; 1–8 multi-start).
- Planar & cylindrical Wrap/Emboss + Deboss (`emboss`); Structural Frames (`frame-member`, `frame-end-cap`, 14 EN/ISO profiles, parametric shapes, miter/butt trim, cut-list & CSV).
- Sheet Metal named rule library (7 gauges), non-destructive flat pattern extractor & layered DXF (`OUTLINE`/`CUT`/`BEND_UP`/`BEND_DOWN`/`BEND_NOTES`); Current-View HLR DXF (`exportCurrentViewDXF`).
- Construction geometry (`axis-point`, `square-to-line`, angled `mid` bisector, `through-cylinder` axis), 6-side `bounding-solid` margins, `BREP` import via `BRepTools.Read_2`, ASCII STL & reference-mesh export fallback, and UI wiring (`shell.direction`, `loft.startPoint`, `rest.alongMillimeters`, `output-3mf`, `solid-variable-fillet`/`solid-face-fillet`).

### Inspection, Materials, Parameters & Configurations
- 15-material physical library (`PHYSICAL_MATERIAL_LIBRARY`) with orthotropic elastic modulus & validation cards; automatic density lookup in `properties` and combined `center_of_mass`.
- Fixed `properties` `bodyIds` filter; added exact `classify_points`, `center_of_mass`, upgraded `clearance`/`interference` (`againstBodyIds`, `clearance_mm`, `nearest`, closest `from_mm`/`to_mm`), and `runParameterSweep`/`compareParameterVariants`.
- 3D feature parametric expressions (`applyFeatureExpressions`), `renameVariable` & `safeDeleteVariable`, configuration material columns + `updateConfigurationFromDesign`, fixed stale-expression activation in `configurations-window.ts`, hooked configuration validation in `validatePartDocument()`, replaced stub in `src/react/panels/configurations.tsx`, and added `environment-map` + configurable surface analysis shader parameters.

### 3D Notes & 2D Drawings (`aether-engine/src/document/notes.ts`, `aether-engine/src/drawing/`)
- Persisted 3D/PMI `DocumentNote[]` on `PartDocument` + live interactive `DocumentNotesPanel` in `src/react/panels/notes.tsx`.
- Drawing Format v6 (keeping v1–v5 byte-identical): tolerances & `{value}` overrides, `ordinate`, `centerline`, `leader-note` with dynamic fields, `hole-callout`, `chamfer-note`, `gdt`, `datum`, `surface-texture`, `weld-symbol`, `revision-tag`, `revisions` & `revisionTable` rendered across SVG, DXF, and PDF.
- ISO/ANSI templates (`DRAWING_SHEET_TEMPLATES`), 4-view `createStandardDrawing`, `importModelDimensions`, `extractProjectionSnapPoints` (fixing `snap_points: []` in `src/drawing/presentation.ts`), `drawingHitTest`, `drawingLineAt`, `auditDrawing`, graceful `allowDangling` + `repairDrawingAnnotation`, and `reorder-sheets`.

### Assembly Kinematics, Mass/BOM, Standard Parts & URDF (`aether-engine/src/kernel/assembly-kinematics.ts`, `aether-engine/src/assembly/`)
- Joint limit enforcement & periodic piecewise-linear `cam` relations in `assembly-solver.ts`.
- Damped-LM Inverse Kinematics (`solveAssemblyIK`) wired into `cad-assembly-controller.ts` (`reachPoint`), plus `driveJoint` (clamped + contact stop), `sweepJoint`, and `findJointLimits`.
- World parallel-axis mass/COM/3×3 inertia (`computeAssemblyMassProperties`), BOM types (`normal`/`phantom`/`reference`/`purchased`/`inseparable`) with locking & renumbering, ROS/Gazebo `exportAssemblyURDF`.
- Standard parts expanded to 13 families (ISO M2–M30, button head, countersunk, ASME/ANSI inch UNC) + exact OCCT topology `resolveFastenerSeats`.

### Agent & MCP Parity (`src/automation/parity-tools.ts`, `src/automation/drawing-agent.ts`)
- Expanded Part agent surface from 26 → 41 schema-validated tools (adding `commands`, `describe`, `model_query`, `analyze`, `parameter_sweep`, `parameters_inspect`/`edit`, `material_library`/`assign`, `configurations_inspect`/`edit`, `notes_inspect`/`edit`, `sketch_operation`, `standard_parts`) plus Drawing `drawing_audit` and `drawing_hit_test`, sketch diagnostics/loose-ends in `sketch_inspect`, regenerated canonical feature schemas (including `emboss`, `frame-member`, `frame-end-cap`), and strict read-only classification in `src/ai/read-only-tools.ts`.

## Completed Parity Implementation — Pass 2 (2026-11-23)

### UI Feature Editors, Panels & Ribbon Wiring (`src/features/`, `src/tools/`, `src/react/panels/`, `src/framing-commands.ts`)
- **Modeled 3D Threads UI (`src/features/thread.ts`)**: Added `modeled` ("Model 3D helical thread"), `form` (`v60`, `trapezoidal`, `acme`, `buttress`), `leftHand`, and `starts` (1–8) while keeping cosmetic thread defaults unchanged.
- **Wrap / Emboss & Structural Framing UI (`src/features/emboss.ts`, `src/features/frame.ts`, `src/framing-commands.ts`)**: Added canonical feature editors for `emboss`, `frame-member` (populated with `FRAME_PROFILE_LIBRARY`), and `frame-end-cap`; wired `solid-wrap-emboss`, `framing-frame`, `framing-trim`, `framing-end-cap`, `framing-cut-list` (CSV download), `output-dxf` (current-view R2000 HLR DXF download), and `output-cut-list`.
- **Live Document Parameters & Notes Wiring (`src/react/panels/parameters.tsx`, `src/main.ts`)**: Bound `documentNotesBridge` and `documentParametersBridge` to the active Part document in `src/main.ts`; upgraded `ParametersPanel` with live Document Parameters authoring (add/edit/rename/delete/favorite/comment, live SI-to-display evaluation, cycle/error diagnostics, CSV export) while preserving quick width/height/depth controls.

### Drawing Dialog & Sheet-Metal Flat-Pattern Views (`aether-engine/src/drawing/`, `aether-engine/src/kernel/drawing-projection.ts`, `src/drawing/DrawingAuthorDialog.tsx`)
- **Flat-Pattern Drawing Views**: Extended `DrawingView` with `flatPattern?: boolean` and wired `projectPartDrawing` to automatically unfold active sheet-metal bodies non-destructively via `extractSheetFlatPattern`, emitting `OUTLINE`/`CUT` as visible curves and `BEND_UP`/`BEND_DOWN` as hidden bend lines.
- **Format-v6 Drawing Authoring UI**: Upgraded `DrawingAuthorDialog.tsx` with ISO/ANSI sheet templates (`DRAWING_SHEET_TEMPLATES`), revision rows & revision table placement, `"flat-pattern"` view creation, all 10 Format-v6 annotations (`ordinate`, `centerline`, `leader-note`, `hole-callout`, `chamfer-note`, `gdt`, `datum`, `surface-texture`, `weld-symbol`, `revision-tag`), plus dimension tolerances (`toleranceUpperMm`/`toleranceLowerMm`) and `{value}` `overrideText`.

### Sketch Transform Depth, Plastic Feature Depth & Mesh Export (`aether-engine/src/sketch/operations/transform-contours.ts`, `aether-engine/src/document/plastic.ts`, `aether-engine/src/kernel/`)
- **Constraint-Adapting Sketch Rotate & Scale**: Added `rotateSketchContours` (swapping `horizontal`↔`vertical` and `horizontal-distance`↔`vertical-distance` on 90° turns, adapting `line-angle`, cleanly dropping oblique axis locks) and `scaleSketchContours` (scaling internal length/distance/radius/diameter dimensions proportionally).
- **Plastic Feature Depth**: Extended `BossFeature` with radial mounting gusset `ribs` (2–12 ribs fused into the boss), `RestFeature` with `wallThicknessMillimeters` (hollow interior pocket cut for round and rectangular rests), and `SnapFitFeature` with `baseHeightMillimeters` (thickened root pedestal at cantilever base); regenerated canonical feature schemas via `scripts/generate-feature-schemas.mjs`.
- **OBJ+MTL & Compressed 3MF Export**: Added `meshOBJWithMTL` & `exportPartOBJWithMTL` (emitting `mtllib`/`usemtl` + `.mtl` material colors from `bodyProperties` / physical material cards) and `mesh3MFCompressed` (`deflate-raw` via `CompressionStream` with automatic stored-ZIP fallback) wired into `exportPart(..., { format: "3mf" })`.

### Inspection UI, Analysis Depth & Assembly Agent Parity (`aether-engine/src/kernel/analysis.ts`, `src/react/panels/inspect.tsx`, `src/automation/assembly-parity-tools.ts`, `src/automation/assembly-agent.ts`)
- **`mesh_inspect` Analysis**: Added watertightness, vertex/triangle counts, bounding box, surface area, signed volume, boundary edge count, and non-manifold edge count (with 1e-4 mm vertex quantization for unwelded triangle meshes) to `analyzePart` and `aether_cad_analyze`.
- **Surface Analysis & Material Assignment UI**: Added `"environment-map"` and configurable `analysisParams` (Zebra stripe count, Draft pull axis & min angle, Accessibility axis) to `src/cad-appearance-store.ts`, `src/viewport-appearance.ts`, and `src/viewer.ts`; upgraded `src/react/panels/inspect.tsx` with live Surface Analysis Shader controls and a Physical Material library assignment card.
- **Assembly Agent & Inspect Ribbon Parity**: Added 5 schema-validated read-only Assembly agent tools (`aether_cad_assembly_mass`, `aether_cad_assembly_ik`, `aether_cad_assembly_sweep`, `aether_cad_assembly_find_limits`, `aether_cad_assembly_urdf`) in `src/automation/assembly-agent.ts` & `src/ai/read-only-tools.ts`, added `rotate_contours`/`scale_contours` to `aether_cad_sketch_operation`, and wired `assembly-mass`, `assembly-clearance`, `assembly-interference`, and `assembly-export-urdf` in `src/tools/assembly-inspect.ts` & `src/main.ts`.

## Completed Parity Implementation — Pass 3 (2026-11-26)

### Solid Primitives, Bounding Solid UI & G2 Fillet (`aether-engine/src/document/primitive.ts`, `aether-engine/src/kernel/features/primitive.ts`, `aether-engine/src/kernel/features/edge-finish.ts`, `src/features/`)
- **Exact 3D Solid Primitives (`primitive`)**: Added direct `box`, `cylinder`, `sphere`, `cone` (including frustums via exact 2π revolution), and `torus` primitives supporting `new` / `add` / `cut` / `intersect` boolean operations, wired into `part-evaluator.ts`, `src/features/primitive.ts`, and `src/tools/solid.ts`.
- **Bounding Solid UI (`src/features/bounding-solid.ts`)**: Added canonical feature editor with uniform and independent 6-side `marginsMillimeters` (`[-X, +X, -Y, +Y, -Z, +Z]`), wired into the Solid ribbon and command registry.
- **G2 Curvature-Continuous Fillet & Vertex Setbacks (`edge-finish.ts`, `src/features/fillet.ts`)**: Extended `EdgeFinishFeature` (`fillet`) with `continuity: "g1" | "g2"` (`ChFi3d_QuasiAngular` + `GeomAbs_G2`) and per-vertex `setbacks` (`SetRadius_6`), enabling **Curvature (G2)** control in the Fillet dialog while continuing to report conic (rho) as a kernel gap.

### Advanced Surface Modeling (`aether-engine/src/kernel/features/surface-advanced.ts`, `aether-engine/src/document/surface.ts`, `src/features/surface.ts`, `src/features/surface-trim.ts`)
- **G1 / G2 Surface Blend (`surface-blend`)**: Upgraded `surface-blend` with optional `continuity: "g0" | "g1" | "g2"` powered by OCCT `BRepOffsetAPI_MakeFilling` constrained to adjacent support faces (`Add_2`).
- **Surface Match (`surface-match`)**: Added boundary control-net matching (auto-interpolating unbounded analytic surfaces into bounded cubic B-spline patches via `GeomAPI_PointsToBSplineSurface`) to align source edges to target surface edges with G0, G1, or G2 continuity.
- **Surface Fillet (`surface-fillet`)**: Added constant-radius rolling-ball filleting across shared or intersecting seams between one or two sheets via `BRepBuilderAPI_Sewing` + `BRepFilletAPI_MakeFillet`.
- **Body-Tool Surface Trim (`surface-trim`)**: Extended `surface-trim` to accept `toolBodyId` (another surface or solid body) via general-fuse face splitting + cut-boundary flood-fill keeping the region containing `keepPointMillimeters`, alongside plane trimming.

### Sheet Metal Depth (`aether-engine/src/document/sheet-metal.ts`, `aether-engine/src/document/sheet-metal-rules.ts`, `aether-engine/src/kernel/features/sheet-metal-flat.ts`, `src/features/sheet-metal.ts`)
- **Persisted Sheet Metal Rules (`sheetMetalRules`)**: Added document-level `SheetMetalRulesTable` with `setSheetMetalRule`, `removeSheetMetalRule`, `setActiveSheetMetalRule`, `assignSheetMetalRule`, `sheetMetalRuleFor`, and preset selectors in `sheetBaseEditor` and `sheetConvertEditor`.
- **Convert to Sheet Metal (`sheet-convert`)**: Converts uniform-thickness solids into sheet-metal bodies (auto-measuring thickness from opposing parallel planar faces when omitted) so flanges, hems, folds, bends, and flat patterns work directly on them.
- **Contour / Edge-Path Flange (`sheet-path-flange`)**: Thickens open or closed multi-segment sketch contours by the sheet rule and extrudes along picked edges or width onto the sheet body.
- **Fold Unfolding & Real Layered Flat-Pattern DXF**: Updated `sheet-unfold` to support `sheet-convert` and inverse-map post-`sheet-fold` flange edges back onto the flat plate; upgraded `extractSheetFlatPattern` & `sheetFlatPatternToDXF` to emit real `OUTLINE` (outer wire), `CUT` (interior holes/perforations), `BEND_UP`, `BEND_DOWN`, and `BEND_NOTES` layers.

### Structural Framing & Loft Guide Rails (`aether-engine/src/document/frame.ts`, `aether-engine/src/kernel/features/frame.ts`, `aether-engine/src/kernel/features/section-loft.ts`, `src/features/frame.ts`, `src/features/loft.ts`)
- **Frame Trim (`frame-trim`) & Frame Gusset (`frame-gusset`)**: Added multi-member `cope`, `butt`, and mutual `miter` trimming with weld gap support plus triangular/polygonal corner gusset plates with weld-relief corner chamfers; wired `framing-trim` and `framing-gusset` in `src/tools/framing.ts` (zero disabled buttons remaining on the Framing tab).
- **Loft Guide Rails (`guideRails`)**: Added guide-rail constrained solid lofting (`guidedSectionLoft`) sampling intermediate cross-sections warped to follow 1+ sketch or 3D curve rails, wired into `src/features/loft.ts`.

### Inspection, Resilience, Script Export & Drawing Interactive UI (`aether-engine/src/kernel/analysis.ts`, `curve-analysis.ts`, `part-evaluator.ts`, `script-export.ts`, `src/react/DrawingWorkspace.tsx`)
- **Silhouette / Parting Analysis (`inspect.silhouette`)**: Added directional HLR silhouette projection computing 2D bounds, projected area (`mm²`), and 3D viewport parting curve overlays, wired into `src/modeling/part-analysis.ts`, `src/tools/solid.ts`, `src/react/panels/inspect.tsx`, `src/main.ts`, and `aether_cad_analyze`.
- **Continuity Gap & Trimmed Minimum Radius**: Added `max_gap_mm` and configurable `position_tol_mm` / `tangent_tol_deg` / `curvature_tol` tolerances to `continuity`; filtered `minimum_radius` UV samples to points strictly on the trimmed face boundary (ignoring holes/cutouts).
- **Resilient Single-Face Planar Anchors**: Upgraded `planarFaceOf` in `part-evaluator.ts` so anchored features (e.g., shells, holes, drafts) on a unique same-normal planar face survive upstream parametric dimension resizes, while preserving strict ambiguity refusal when multiple same-normal faces or curved anchors exist.
- **Parametric Script Export (`timeline.export_script`)**: Added `exportPartScript(doc)` generating a runnable TypeScript reconstruction script, exposed via `"export-part-script"` command and read-only agent tool `aether_cad_export_script` (expanding Part agent tools to 42).
- **Drawing Command Bar & Snap Markers**: Added one-click **4-View** (`add-standard-views`), **Import dims** (`import-dimensions`), and **Audit** (`audit-drawing`) actions to `DrawingWorkspace.tsx` & `routes.tsx`, plus distinct endpoint/midpoint/center SVG snap-point markers with tooltips in `DrawingSheetCanvas.tsx`.

### Right-Side Inspector Reorganization & Interactive Canvas / 3D PMI Pins (2026-11-26)
- **Right-Side Inspector & Popup Polish (`src/react/chrome/right-panels.ts`, `src/react/CADInspector.css`, `src/react/CADPopups.css`, `src/react/panels/`)**: Reorganized the right-side rail into clear non-overlapping domains (**Properties** with dynamic context banner, **Appearance** for materials + surface shaders + lighting, **Inspect** for model health & geometry/assembly diagnostics, **Parameters**, **Configurations**, **Notes**, **History**, **View**), eliminating duplicate controls across panels and unifying card/table/pill styling across floating dialogs and popups.
- **Interactive 2D Drawing Canvas (`src/drawing/canvas-interaction.ts`, `src/react/DrawingSheetCanvas.tsx`, `src/react/DrawingWorkspace.tsx`, `src/react/chrome/routes.tsx`)**: Added cursor-centered wheel zoom, zoom toolbar (`− / % / + / Fit`), Shift+drag / middle-button pan, thresholded drag-to-move for drawing views and annotations with live `Δx, Δy mm` ghost previews, and magnetic snap-assisted 1-click / 2-click placement tools for all 12 Format-v6 annotation kinds (`point-distance`, `ordinate`, `centerline`, `note`, `leader-note`, `hole-callout`, `chamfer-note`, `datum`, `gdt`, `surface-texture`, `weld-symbol`, `revision-tag`), routed through canonical `drawingEditor.execute(...)` commands with full undo/redo support.
- **Interactive 3D Viewport PMI / Note Pins (`src/viewport/notes-3d-overlay.ts`, `src/react/panels/notes.tsx`, `src/main.ts`)**: Projects persisted `DocumentNote` records with `positionMillimeters` as live screen-tracked 3D callout badges in the 3D viewport via `aether-measure-project`, synchronized bidirectionally with `DocumentNotesPanel` (including **Pin to 3D selection**, **Pin to 3D / Unpin** per note, and **Show 3D viewport pins** visibility toggle).

## Remaining Deferred Items & Product Boundaries
- **KiCad / Gerber PCB import**: Owned by **Aether Circuit** (not a gap in Aether-CAD).
- **E57 / PCD point-cloud pipelines**: Out of current mechanical CAD scope.
- **Full multibody rigid-body dynamics**: Gravity/friction time-integration physics engine remains deferred (kinematics, IK, cam, limits, sweep, and contact stop are implemented).
- **Interactive nested sub-assembly editing**: Dependent on external Python workspace backend container support.
