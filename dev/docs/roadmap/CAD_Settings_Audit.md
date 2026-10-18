# CAD settings functional audit — 2026-10-11

Requested by Jonathan: evaluate each settings area against a complete CAD product,
not just a visual mockup. This is a code-based product acceptance plan, not a claim
of Onshape parity. The shared Appearance/StyleProperties/transform inspectors are
the visual authority. Do not implement another product-specific widget skin.

## Current implementation and completion gates

| Area | Required behavior for a complete product | Current behavior / remaining gap | Persistence and acceptance |
|---|---|---|---|
| Appearance | Palette, mixer, valid hex/RGB, opacity, finish; clear target selection; override/reset | Shared palette/mixer/hex/RGB/opacity now connected to the viewport. Matte/satin/gloss and roughness/metallic are connected. Targets are currently all displayed bodies, not a selected face/part. | Preview defaults persist on this device. Saved per-entity assignments need document schema, stable IDs, undo, autosave, history, reopen and export tests. Never claim device defaults are document materials. |
| Material editor | Physical material vs visual finish distinguished; material library, assign to selection, remove overrides, density, texture mapping, preview | Roughness/metallic preview works; no saved assignment graph or material library. No fake Assign/Node Editor buttons. | Material IDs/parameters belong in CAD documents; libraries may be workspace-owned. Validate unit-aware density and mass, missing textures and referenced material versions. |
| Rendering environment | Background, light preset/intensity, ground/grid, shadows, HDR environment rotation/exposure, quality controls | Background, light presets/intensity, ground/grid opacity and shadows work. HDR environments, rotations and selectable sampling quality are absent. | Device view preferences by default; saved scenes require an explicit document contract. Verify each setting on a populated scene, including transparency and hidden-line mode. |
| Camera/display | Perspective/orthographic, FOV where applicable, standard/named views, fit selection, edges, sections, origin/axes | FOV, standard views, fit, surface styles, edges and origin work. Orthographic and saved named views are unavailable; axes/section controls are disabled. | Camera bookmarks require document persistence and stable references. FOV should disable under orthographic. Test fit on empty, tiny, huge and off-origin geometry. |
| Configurations | Create/duplicate/rename/remove/activate variants, typed inputs and overrides, suppression, validation and comparison | Assembly saved configurations and active state are readable. Editing/activation and Part configurations are absent. | Canonical CAD engine/document owns evaluation; server owns durable revisions/permissions. Atomic activation, failed rebuild rollback, undo, reopen and assembly references must pass. |
| Properties | Selection-specific editable name/description/part number; read-only calculated topology/mass; multi-selection and mixed values | Shared projected readouts exist. Assembly detection corrected to use loaded data. Full editable/mixed property transactions remain incomplete. | Document properties must use guarded transactions, undo, autosave and revision history; selection changes cannot discard dirty edits silently. |
| Measure/inspect | Vertex/edge/face/body measures with units, distances/angles/radii, mass properties, interference/sections/curvature | Exact model readouts exist; advanced analysis is disabled. No placeholder numeric results should be shown. | Read-only calculations from the canonical geometry engine; test analytic fixtures, invalid selections and tolerances. |
| Assembly | Structure/BOM, insert/reference resolution, mates/DOF, suppression, diagnostics and solve feedback | Existing canonical assembly tools and projections are retained. Configurations and other unsupported commands remain explicit. | Stable document/component links; verify save/reopen, revision references, failed solves, missing components and permission loss. |
| Performance | Actual renderer/kernel identity, frame/geometry/memory metrics, overlay, supported quality controls | Settings now reuses the live performance panel/overlay and CAD backend status. Other unsupported quality controls remain absent. | Device preference for overlay. Never infer active GPU backend from browser capability alone. Use measured values, mark unavailable metrics accurately. |
| Document units | Length/angle/mass units and precision, correct conversions, expression handling | Workspace document controls expose unit settings; some global Settings entries are disabled/fixed. | Units are document metadata; display changes must not rescale geometry. Test expressions, imported unitless files and export round-trips. |
| Application preferences | Theme, icon pack, density, layout, reduced motion, shortcuts, navigation and accessibility | Shared suite preferences exist, but older CAD Settings panes still duplicate some unavailable/stale choices. | Account preferences where connected; offline device fallback. Each preference has one owner/store, identical values across editor and settings dialog. |
| Document lifecycle | Autosave state/errors, recovery, offline behavior, import/export policy, permissions and history | Hosted saving and existing library/revision workflows are separate implementations; this appearance pass does not certify them. | End-to-end saved-file/revision/permission tests required. Never present a local-only preference as cross-device document data. |

## Required design behavior

- Use shared Inspector/InspectorSection/FieldRow and shared control components.
- Use flat sections, aligned labels, muted field fills, blue selection, visible
  keyboard focus and readable light/dark contrast. Responsive rows must not clip.
- Show the target and storage scope before editing: selected part/face, entire
  document, device preview, or account preference.
- Use the same editor in the sidebar and Settings dialog when editing the same
  state. Do not maintain two copies with different capabilities.
- Immediate preview controls apply immediately. Document mutations need undo and
  explicit transaction boundaries; canceled dialogs restore the previous state.
- Validate hex/numeric values, clamp bounded ranges, and reject nonfinite inputs.
- Hide unsupported optional controls in reusable editors rather than leaving a
  clickable no-op. Explain substantial missing capabilities concisely.

## Completion order

1. Finish live appearance editor and tests (current work).
2. Consolidate stale Settings entries with existing live panel projections.
3. Implement document-owned part/face material assignments and history/export.
4. Implement configurations through the owning canonical engine adapter.
5. Complete camera/inspection functionality and measured rendering quality controls.
6. Run populated-model acceptance, save/reopen/device-switch, keyboard and theme
   checks. Only then call the settings suite fully implemented.
