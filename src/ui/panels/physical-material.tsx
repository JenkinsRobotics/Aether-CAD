/** Physical engineering material assignment — lives under Properties › Material
 *  alongside visual Appearance, and follows the active viewport body selection. */
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button, EmptyState, FieldRow, InspectorActions, InspectorSection, SelectField } from "@aether/ui";
import {
  assignBodyMaterial,
  availableBodies,
  clearBodyMaterial,
  findPhysicalMaterial,
  materialForBody,
  PHYSICAL_MATERIAL_LIBRARY,
} from "@aether/core/document";
import { cadSelection } from "../../core/stores/cad-selection-store";
import { documentParametersBridge } from "./parameters";
import "../CADInspector.css";

export function PhysicalMaterialPanel() {
  const { doc, onApply } = useSyncExternalStore(
    documentParametersBridge.subscribe,
    documentParametersBridge.snapshot,
    documentParametersBridge.snapshot,
  );
  const selection = useSyncExternalStore(cadSelection.subscribe, cadSelection.snapshot, cadSelection.snapshot);
  const bodies = doc ? availableBodies(doc) : [];
  const selectedPartId = selection.items.find((item) => item.partId && bodies.some((b) => b.id === item.partId))?.partId ?? "";

  const [manualBodyId, setManualBodyId] = useState("");
  const [selectedMaterialId, setSelectedMaterialId] = useState(PHYSICAL_MATERIAL_LIBRARY[0].id);

  // Follow viewport selection dynamically when a body/face belonging to the active Part is picked.
  useEffect(() => {
    if (selectedPartId) setManualBodyId(selectedPartId);
  }, [selectedPartId]);

  const activeBodyId =
    manualBodyId && bodies.some((b) => b.id === manualBodyId)
      ? manualBodyId
      : bodies[0]?.id ?? "";

  const assignedMaterial = doc && activeBodyId ? materialForBody(doc, activeBodyId) : undefined;
  const assignedCard = assignedMaterial ? findPhysicalMaterial(assignedMaterial.name) : undefined;
  const previewCard = PHYSICAL_MATERIAL_LIBRARY.find((m) => m.id === selectedMaterialId) ?? PHYSICAL_MATERIAL_LIBRARY[0];

  // Sync the material selector to the currently assigned material when switching bodies.
  useEffect(() => {
    if (assignedCard) setSelectedMaterialId(assignedCard.id);
  }, [activeBodyId, assignedCard?.id]);

  return (
    <section className="cad-property-sheet" data-panel="physical-material" aria-label="Engineering physical material">
      {bodies.length === 0 ? (
        <EmptyState
          title="No solid bodies"
          description="Create or open a solid Part to assign engineering materials for mass, center of mass, inertia, and BOM."
        />
      ) : (
        <>
          <InspectorSection defaultOpen title="Target body">
            <FieldRow label="Body" htmlFor="inspect-material-body">
              <SelectField
                id="inspect-material-body"
                aria-label="Material target body"
                value={activeBodyId}
                options={bodies.map((b) => ({
                  value: b.id,
                  label: materialForBody(doc!, b.id) ? `${b.name} · ${materialForBody(doc!, b.id)!.name}` : b.name,
                }))}
                onChange={(e) => setManualBodyId(e.target.value)}
              />
            </FieldRow>
            <div className="cad-spec-card">
              <div className="cad-spec-header">
                {assignedCard?.colorHex && <span className="cad-swatch-dot" style={{ background: assignedCard.colorHex }} />}
                <span className="cad-inspector-card-title">
                  {assignedMaterial ? assignedMaterial.name : "No material assigned"}
                </span>
                <span className={`cad-pill ${assignedMaterial ? "cad-pill--ok" : ""}`}>
                  {assignedMaterial ? "Assigned" : "Default"}
                </span>
              </div>
              {assignedMaterial && (
                <dl className="cad-spec-grid">
                  <dt>Density</dt>
                  <dd>{assignedMaterial.densityKgPerM3.toLocaleString()} kg/m³</dd>
                  {assignedCard?.youngsModulusGPa !== undefined && <>
                    <dt>Young's modulus</dt>
                    <dd>{assignedCard.youngsModulusGPa} GPa</dd>
                  </>}
                  {assignedCard?.yieldStrengthMPa !== undefined && <>
                    <dt>Yield strength</dt>
                    <dd>{assignedCard.yieldStrengthMPa} MPa</dd>
                  </>}
                </dl>
              )}
            </div>
          </InspectorSection>

          <InspectorSection defaultOpen title="Material library">
            <FieldRow label="Material" htmlFor="inspect-material-choice">
              <SelectField
                id="inspect-material-choice"
                aria-label="Physical material"
                value={selectedMaterialId}
                options={PHYSICAL_MATERIAL_LIBRARY.map((m) => ({
                  value: m.id,
                  label: `${m.name} (${m.densityKgPerM3} kg/m³)`,
                }))}
                onChange={(e) => setSelectedMaterialId(e.target.value)}
              />
            </FieldRow>

            <div className="cad-spec-card" aria-label="Selected material properties">
              <div className="cad-spec-header">
                <span className="cad-swatch-dot" style={{ background: previewCard.colorHex }} />
                <span className="cad-inspector-card-title">{previewCard.name}</span>
                <span className="cad-pill">{previewCard.category}</span>
              </div>
              <dl className="cad-spec-grid">
                <dt>Density</dt>
                <dd>{previewCard.densityKgPerM3.toLocaleString()} kg/m³</dd>
                {previewCard.youngsModulusGPa !== undefined && <>
                  <dt>Elastic modulus (E)</dt>
                  <dd>{previewCard.youngsModulusGPa} GPa</dd>
                </>}
                {previewCard.orthotropicModuliGPa !== undefined && <>
                  <dt>Moduli (Ex, Ey, Ez)</dt>
                  <dd>{previewCard.orthotropicModuliGPa.join(" / ")} GPa</dd>
                </>}
                {previewCard.poissonRatio !== undefined && <>
                  <dt>Poisson's ratio (ν)</dt>
                  <dd>{previewCard.poissonRatio}</dd>
                </>}
                {previewCard.yieldStrengthMPa !== undefined && <>
                  <dt>Yield strength (σy)</dt>
                  <dd>{previewCard.yieldStrengthMPa} MPa</dd>
                </>}
                {previewCard.thermalConductivityWPerMK !== undefined && <>
                  <dt>Thermal cond.</dt>
                  <dd>{previewCard.thermalConductivityWPerMK} W/m·K</dd>
                </>}
              </dl>
            </div>

            <InspectorActions>
              <Button
                primary
                disabled={!doc || !activeBodyId}
                onClick={() => {
                  if (!doc || !activeBodyId) return;
                  const next = assignBodyMaterial(doc, activeBodyId, selectedMaterialId);
                  void onApply?.(next);
                  documentParametersBridge.bind(next, onApply);
                }}
              >
                Assign material
              </Button>
              <Button
                disabled={!doc || !activeBodyId || !assignedMaterial}
                onClick={() => {
                  if (!doc || !activeBodyId) return;
                  const next = clearBodyMaterial(doc, activeBodyId);
                  void onApply?.(next);
                  documentParametersBridge.bind(next, onApply);
                }}
              >
                Clear
              </Button>
            </InspectorActions>
          </InspectorSection>
        </>
      )}
    </section>
  );
}
