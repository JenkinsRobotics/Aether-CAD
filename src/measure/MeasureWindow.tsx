/** Measure — the standard compact floating tool window (Onshape's Measure):
 *  pick faces, edges and vertices; exact minimum distance comes from the CAD
 *  engine, per-entity values from the exact topology already in the viewer. */
import { useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { openCompactFeatureWindow, PropertyGrid, type PropertyGridSection } from "@aether/ui";
import "./measure-window.css";
import { displayQuantity, unitCatalog, unitChoice, type UnitPreferences } from "@aether/core/units";
import type { PartDocument } from "@aether/core/document";
import { cadSelection } from "../cad-selection-store";
import { documentUnits } from "../document-preferences";
import { analyzePart } from "../modeling/part-analysis";
import { selectedTopologyAngle, type SelectedTopologyMeasurement } from "../viewport/topology-measurement";
import { measureReference } from "./measure-reference";

type Vec = readonly [number, number, number];
type Point = { candidateId: string; partId: string; positionMillimeters: Vec };
type Distance = { distance_mm: number; points: [Vec, Vec] };
const MEASURE_TYPES = ["Show all", "Minimum", "Center"] as const;
type MeasureType = typeof MEASURE_TYPES[number];
const UNIT_NAMES: Record<string, string> = { mm: "Millimeter", cm: "Centimeter", m: "Meter", in: "Inch", ft: "Foot", deg: "Degree", rad: "Radian" };
const named = (family: "length" | "angle") => Object.keys(unitCatalog[family].options).map(unit => UNIT_NAMES[unit] ?? unit);
const unitFor = (name: string) => Object.keys(UNIT_NAMES).find(unit => UNIT_NAMES[unit] === name) ?? name;

let closeOpen: (() => void) | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach(listener => listener());
/** Whether the window is open, for the toolbar's pressed state. */
export const measureWindowOpen = () => closeOpen !== null;
export const subscribeMeasureWindow = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** Open Measure, or close it when it is already open (the ruler toggles). */
export function toggleMeasureWindow(currentPart: () => PartDocument | null): void {
  if (closeOpen) { closeOpen(); return; }
  const close = (clear = false) => {
    if (!closeOpen) return;
    // Cancel also drops the picked entities; Done leaves the selection as it is.
    if (clear) cadSelection.dispatch({ type: "clear" });
    closeOpen = null;
    window.dispatchEvent(new CustomEvent("aether-measure-picking", { detail: false }));
    root.unmount(); win.close(); changed();
  };
  const win = openCompactFeatureWindow({ className: "cad-measure-window", viewport: document.querySelector<HTMLElement>(".cad-studio-viewport") ?? document.body,
    title: "Measure", icon: "measure", acceptLabel: "Done", onAccept: () => close(), onDiscard: () => close(true) });
  const entities = win.entitiesBox("Select entities to measure");
  const units = documentUnits();
  const render = () => root.render(<MeasureResults currentPart={currentPart} entities={entities}
    type={type.value() as MeasureType} lengthUnit={unitFor(length.value())} angleUnit={unitFor(angle.value())} />);
  const type = win.picker(MEASURE_TYPES, { value: "Show all", ariaLabel: "Measure type", onChange: () => render() });
  const length = win.picker(named("length"), { value: UNIT_NAMES[unitChoice(units, "length").unit], ariaLabel: "Length unit", onChange: () => render() });
  const angle = win.picker(named("angle"), { value: UNIT_NAMES[unitChoice(units, "angle").unit], ariaLabel: "Angle unit", onChange: () => render() });
  win.row("Measure type", type.element);
  win.row("Length unit", length.element);
  win.row("Angle unit", angle.element);
  const host = document.createElement("div");
  host.className = "cad-measure-results";
  win.body.append(host);
  const root = createRoot(host);
  closeOpen = () => close();
  window.dispatchEvent(new CustomEvent("aether-measure-picking", { detail: true }));
  render(); changed();
}

function MeasureResults({ currentPart, entities, type, lengthUnit, angleUnit }: {
  currentPart: () => PartDocument | null;
  entities: { render: (rows: { label: string; onRemove: () => void }[]) => void };
  type: MeasureType; lengthUnit: string; angleUnit: string;
}) {
  const { items } = useSyncExternalStore(cadSelection.subscribe, cadSelection.snapshot, cadSelection.snapshot);
  useEffect(() => entities.render(items.map(item => ({ label: item.label, onRemove: () => cadSelection.dispatch({ type: "toggle", items: [item] }) }))), [entities, items]);
  // The part rebuilds after edits: re-read geometry and re-measure.
  const [revision, setRevision] = useState(0);
  useEffect(() => { const bump = () => setRevision(value => value + 1); window.addEventListener("aether-part-updated", bump); return () => window.removeEventListener("aether-part-updated", bump); }, []);
  const [geometry, setGeometry] = useState<{ points: Point[]; measurements: SelectedTopologyMeasurement[] }>({ points: [], measurements: [] });
  useEffect(() => {
    const receive = (event: Event) => { const detail = (event as CustomEvent).detail; setGeometry({ points: detail.points ?? [], measurements: detail.measurements ?? [] }); };
    window.addEventListener("aether-plane-geometry", receive);
    window.dispatchEvent(new Event("aether-plane-geometry-request"));
    return () => window.removeEventListener("aether-plane-geometry", receive);
  }, [items, revision]);
  const references = items.length === 2 ? items.map(measureReference) : [];
  const key = JSON.stringify([references, revision]);
  const [distance, setDistance] = useState<{ key: string; value?: Distance; error?: string } | null>(null);
  useEffect(() => {
    const part = currentPart();
    if (references.length !== 2 || references.some(reference => !reference) || !part) { setDistance(null); return; }
    const controller = new AbortController();
    setDistance({ key });
    analyzePart(part, { kind: "distance", entities: references as object[] }, controller.signal)
      .then(result => setDistance({ key, value: result.measurements[0] as unknown as Distance }))
      .catch(error => { if (!controller.signal.aborted) setDistance({ key, error: error instanceof Error ? error.message : String(error) }); });
    return () => controller.abort();
  }, [key]);

  const base = documentUnits();
  const preferences: UnitPreferences = { ...base,
    length: { unit: lengthUnit, decimals: unitChoice(base, "length").decimals },
    angle: { unit: angleUnit, decimals: unitChoice(base, "angle").decimals } };
  const factor = unitChoice(preferences, "length").factor * 1000;
  const lengthText = (mm: number) => `${displayQuantity(mm / 1000, preferences, "length")} ${lengthUnit}`;
  const output = (id: string, label: string, text: string) => ({ id, label, readOnly: true, editor: <output>{text}</output> });
  const deltas = (a: Vec, b: Vec) => b.map((value, axis) => output(`d${axis}`, `Δ${"XYZ"[axis]}`, lengthText(value - a[axis])));

  const all = type === "Show all", sections: PropertyGridSection[] = [];
  if ((all || type === "Minimum") && items.length === 2) {
    const current = distance?.key === key ? distance : null;
    sections.push({ id: "minimum", label: "Minimum distance", properties: !references.every(Boolean)
      ? [output("unavailable", "Distance", "Select bodies, faces, edges or vertices")]
      : current?.value ? [output("distance", "Distance", lengthText(current.value.distance_mm)), ...deltas(...current.value.points)]
      : [output("distance", "Distance", current?.error ?? "Measuring…")] });
  }
  const pointOf = (id: string) => geometry.points.find(point => id === `vertex:${point.partId}:${point.candidateId}`)?.positionMillimeters;
  const measured = (id: string) => geometry.measurements.find(measurement => measurement.id === id);
  if ((all || type === "Center") && items.length === 2) {
    const [a, b] = items.map(item => pointOf(item.id) ?? measured(item.id)?.centerMillimeters as Vec | undefined);
    if (a && b) sections.push({ id: "center", label: "Center distance", properties: [output("center", "Distance", lengthText(Math.hypot(...b.map((value, axis) => value - a[axis])))), ...deltas(a, b)] });
  }
  if (all) {
    const angle = items.length === 2 ? selectedTopologyAngle(items.map(item => measured(item.id)).filter(Boolean) as SelectedTopologyMeasurement[]) : null;
    if (angle) sections.push({ id: "angle", label: angle.label, properties: [output("angle", "Angle", `${displayQuantity(angle.radians, preferences, "angle")} ${angleUnit}`)] });
    for (const item of items) {
      const m = measured(item.id), point = pointOf(item.id);
      const properties = [
        ...(point ? point.map((value, axis) => output(`p${axis}`, `${"XYZ"[axis]}`, lengthText(value))) : []),
        ...(m?.lengthMillimeters === undefined ? [] : [output("length", "Length", lengthText(m.lengthMillimeters))]),
        ...(m?.areaSquareMillimeters === undefined ? [] : [output("area", "Area", `${(m.areaSquareMillimeters / factor ** 2).toFixed(unitChoice(preferences, "length").decimals)} ${lengthUnit}²`)]),
        ...(m?.radiusMillimeters === undefined ? [] : [output("radius", "Radius", lengthText(m.radiusMillimeters)), output("diameter", "Diameter", lengthText(m.radiusMillimeters * 2))]),
      ];
      if (properties.length) sections.push({ id: item.id, label: item.label, properties });
    }
  }
  // Nothing measured yet: no results area at all, so the window stays condensed.
  return sections.length ? <PropertyGrid ariaLabel="Measurements" sections={sections}/> : null;
}
