import { useEffect, useState, useSyncExternalStore } from "react";
import { PropertyGrid, type PropertyGridSection } from "@aether/ui";
import { displayQuantity, unitChoice, type UnitPreferences } from "@aether/core/units";
import type { PartDocument } from "@aether/core/document";
import { cadSelection, type CADSelectionStore } from "../cad-selection-store";
import { documentUnits } from "../document-preferences";
import { analyzePart } from "../modeling/part-analysis";
import { selectedTopologyAngle, type SelectedTopologyMeasurement } from "../viewport/topology-measurement";
import { measureReference } from "./measure-reference";
import { pointDistance, threePointAngle, type MeasurePoint as Vec, type MeasurementMode } from "./measurement-geometry";
import type { MeasurementAnnotation } from "./measurement-overlay";
type Point = { selectionId?: string; candidateId: string; partId: string; positionMillimeters: Vec };
type Distance = { distance_mm: number; points: [Vec, Vec] };
export type MeasureType = "Show all" | "Minimum" | "Center";

export function MeasureResults({ currentPart, entities, type, lengthUnit, angleUnit, mode, annotate, selection = cadSelection }: {
  selection?: Pick<CADSelectionStore, "snapshot" | "subscribe" | "dispatch">;
  currentPart: () => PartDocument | null;
  entities: { render: (rows: { label: string; onRemove: () => void }[]) => void };
  type: MeasureType; lengthUnit: string; angleUnit: string; mode: MeasurementMode; annotate: (annotation: MeasurementAnnotation | null) => void;
}) {
  const { items } = useSyncExternalStore(selection.subscribe, selection.snapshot, selection.snapshot);
  useEffect(() => entities.render(items.map(item => ({ label: item.label, onRemove: () => selection.dispatch({ type: "toggle", items: [item] }) }))), [entities, items]);
  // The part rebuilds after edits: re-read geometry and re-measure.
  const [revision, setRevision] = useState(0);
  useEffect(() => { const bump = () => setRevision(value => value + 1); window.addEventListener("aether-part-updated", bump); return () => window.removeEventListener("aether-part-updated", bump); }, []);
  const [geometry, setGeometry] = useState<{ points: Point[]; measurements: SelectedTopologyMeasurement[] }>({ points: [], measurements: [] });
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("aether-plane-geometry-request", { detail: { items,
      respond: (detail: { points?: Point[]; measurements?: SelectedTopologyMeasurement[] }) =>
        setGeometry({ points: detail.points ?? [], measurements: detail.measurements ?? [] }),
    } }));
  }, [items, revision]);
  const references = mode === "Objects" && items.length === 2 ? items.map(measureReference) : [];
  const key = JSON.stringify([references, revision, currentPart()?.documentId]);
  const [distance, setDistance] = useState<{ key: string; value?: Distance; error?: string } | null>(null);
  useEffect(() => {
    const part = currentPart();
    if (references.length !== 2 || references.some(reference => !reference) || !part) { setDistance(null); return; }
    const controller = new AbortController();
    setDistance({ key });
    analyzePart(part, { kind: "distance", entities: references as object[] }, controller.signal)
      .then(result => { if (!controller.signal.aborted) setDistance({ key, value: result.measurements[0] as unknown as Distance }); })
      .catch(error => { if (!controller.signal.aborted) setDistance({ key, error: error instanceof Error ? error.message : String(error) }); });
    return () => controller.abort();
  }, [key]);

  const bodyIds = mode === "Objects" ? items.filter(item => item.kind === "body").map(item => item.partId) : [];
  const propertiesKey = JSON.stringify([bodyIds, revision, currentPart()?.documentId]);
  type BodyProperties = { body_id: string; volume_mm3: number; area_mm2: number; center_mm: Vec; bounds_mm: Vec };
  const [physical, setPhysical] = useState<{ key: string; values?: BodyProperties[]; error?: string } | null>(null);
  useEffect(() => {
    const part = currentPart();
    if (!part || !bodyIds.length) { setPhysical(null); return; }
    const controller = new AbortController();
    setPhysical({ key: propertiesKey });
    analyzePart(part, { kind: "properties", bodyIds }, controller.signal)
      .then(result => { if (!controller.signal.aborted) setPhysical({ key: propertiesKey, values: result.measurements as unknown as BodyProperties[] }); })
      .catch(error => { if (!controller.signal.aborted) setPhysical({ key: propertiesKey, error: error instanceof Error ? error.message : String(error) }); });
    return () => controller.abort();
  }, [propertiesKey]);

  const base = documentUnits();
  const preferences: UnitPreferences = { ...base,
    length: { unit: lengthUnit, decimals: unitChoice(base, "length").decimals },
    angle: { unit: angleUnit, decimals: unitChoice(base, "angle").decimals } };
  const factor = unitChoice(preferences, "length").factor * 1000;
  const lengthText = (mm: number) => `${displayQuantity(mm / 1000, preferences, "length")} ${lengthUnit}`;
  const output = (id: string, label: string, text: string) => ({ id, label, readOnly: true, editor: <output>{text}</output> });
  const deltas = (a: Vec, b: Vec) => b.map((value, axis) => output(`d${axis}`, `Δ${"XYZ"[axis]}`, lengthText(value - a[axis])));

  const all = type === "Show all", sections: PropertyGridSection[] = [];
  if (mode === "Objects" && (all || type === "Minimum") && items.length === 2) {
    const current = distance?.key === key ? distance : null;
    sections.push({ id: "minimum", label: "Minimum distance", properties: !references.every(Boolean)
      ? [output("unavailable", "Distance", "Select bodies, faces, edges or vertices")]
      : current?.value ? [output("distance", "Distance", lengthText(current.value.distance_mm)), ...deltas(...current.value.points)]
      : [output("distance", "Distance", !currentPart() ? "Open the source Part for exact minimum distance" : current?.error ?? "Measuring…")] });
  }
  const pointOf = (id: string) => geometry.points.find(point => id === (point.selectionId ?? `vertex:${point.partId}:${point.candidateId}`))?.positionMillimeters;
  const measured = (id: string) => geometry.measurements.find(measurement => measurement.id === id);
  const centerOf = (item: typeof items[number]) => pointOf(item.id) ?? measured(item.id)?.centerMillimeters
    ?? (physical?.key === propertiesKey ? physical.values?.find(body => body.body_id === item.partId)?.center_mm : undefined);
  if (mode === "Objects" && (all || type === "Center") && items.length === 2) {
    const [a, b] = items.map(centerOf);
    if (a && b) sections.push({ id: "center", label: "Center distance", properties: [output("center", "Distance", lengthText(Math.hypot(...b.map((value, axis) => value - a[axis])))), ...deltas(a, b)] });
  }

  const points = items.map(item => pointOf(item.id)).filter((point): point is Vec => !!point);
  const count = mode === "3-point angle" ? 3 : 2;
  const validPoints = mode !== "Objects" && items.length === count && points.length === count;
  const radians = validPoints && mode === "3-point angle" ? threePointAngle(points[0], points[1], points[2]) : null;
  const pointLabel = validPoints ? mode === "Point-to-point" ? lengthText(pointDistance(points[0], points[1]))
    : radians === null ? undefined : `${displayQuantity(radians, preferences, "angle")} ${angleUnit}` : undefined;
  if (mode !== "Objects" && validPoints) {
    sections.push({ id: "points", label: mode === "Point-to-point" ? "Point-to-point distance" : "3-point angle", properties: mode === "Point-to-point"
      ? [output("distance", "Distance", pointLabel!), ...deltas(points[0], points[1])]
      : [output("angle", "Angle", pointLabel ?? "Choose distinct points for both arms")] });
  }
  const minimum = distance?.key === key ? distance.value : undefined;
  const centers = items.map(centerOf);
  const annotation: MeasurementAnnotation | null = mode !== "Objects"
    ? { points, label: pointLabel, angle: mode === "3-point angle" }
    : type === "Center" && centers.length === 2 && centers.every(Boolean)
      ? { points: centers as Vec[], label: lengthText(pointDistance(centers[0]!, centers[1]!)) }
      : minimum ? { points: minimum.points, label: lengthText(minimum.distance_mm) } : null;
  const annotationKey = JSON.stringify(annotation);
  useEffect(() => { annotate(annotation); return () => annotate(null); }, [annotationKey, annotate]);

  if (mode === "Objects" && all) {
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
  if (mode === "Objects" && bodyIds.length) {
    const current = physical?.key === propertiesKey ? physical : null;
    for (const id of bodyIds) {
      const value = current?.values?.find(entry => entry.body_id === id);
      sections.push({ id: `body-${id}`, label: items.find(item => item.partId === id)?.label ?? "Body", properties: value ? [
        output("volume", "Volume", `${(value.volume_mm3 / factor ** 3).toFixed(unitChoice(preferences, "length").decimals)} ${lengthUnit}³`),
        output("area", "Surface area", `${(value.area_mm2 / factor ** 2).toFixed(unitChoice(preferences, "length").decimals)} ${lengthUnit}²`),
        ...value.bounds_mm.map((size, axis) => output(`bounds-${axis}`, `${"XYZ"[axis]} size`, lengthText(size))),
        ...value.center_mm.map((coordinate, axis) => output(`center-${axis}`, `Center ${"XYZ"[axis]}`, lengthText(coordinate))),
      ] : [output("pending", "Properties", !currentPart() ? "Open the source Part for exact body properties" : current?.error ?? "Measuring…")] });
    }
  }
  const pending = mode !== "Objects" && !validPoints ? `${points.length} / ${count} points selected` : null;
  return <>{pending && <p className="cad-measure-hint" role="status">{pending}</p>}{sections.length ? <PropertyGrid ariaLabel="Measurements" sections={sections}/> : null}</>;
}
