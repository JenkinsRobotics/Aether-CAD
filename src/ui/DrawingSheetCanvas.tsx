import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from "react";
import type {
  DrawingAnnotationProjection,
  DrawingLayerProjection,
  DrawingPrimitive,
  DrawingSheetProjection,
  DrawingStyleProjection,
  DrawingViewProjection,
  SheetPoint,
} from "../core/cad-drawing-bridge";
import {
  clampViewBox,
  clientToSheetMm,
  defaultViewBox,
  DRAWING_PLACEMENT_TOOLS,
  findNearestSnapPoint,
  zoomViewBoxAt,
  type DrawingPlacementTool,
  type SheetViewBox,
  type SnapCandidate,
} from "../drawing/canvas-interaction";

export interface DrawingSheetCanvasProps {
  readonly sheet: DrawingSheetProjection;
  readonly styles: readonly DrawingStyleProjection[];
  readonly selectedIDs?: ReadonlySet<string>;
  readonly showSnapPoints?: boolean;
  readonly placementTool?: DrawingPlacementTool;
  readonly editable?: boolean;
  readonly viewBox?: SheetViewBox;
  readonly onViewBoxChange?: (next: SheetViewBox) => void;
  readonly onSelect?: (id: string) => void;
  readonly onMoveView?: (viewId: string, deltaMm: [number, number]) => void;
  readonly onMoveAnnotation?: (annotationId: string, deltaMm: [number, number]) => void;
  readonly onPlaceAnnotation?: (
    tool: Exclude<DrawingPlacementTool, "select">,
    pointsMm: [number, number][],
    snappedViewId?: string,
  ) => void;
  readonly className?: string;
}

function pointAtEllipse(
  center: SheetPoint,
  major: SheetPoint,
  minorRadius: number,
  parameter: number,
): SheetPoint {
  const majorRadius = Math.hypot(major[0], major[1]);
  if (majorRadius === 0) return center;
  const ux = major[0] / majorRadius;
  const uy = major[1] / majorRadius;
  const vx = -uy;
  const vy = ux;
  return [
    center[0] + ux * majorRadius * Math.cos(parameter) + vx * minorRadius * Math.sin(parameter),
    center[1] + uy * majorRadius * Math.cos(parameter) + vy * minorRadius * Math.sin(parameter),
  ];
}

function arcPath(
  center: SheetPoint,
  radius: number,
  start: number,
  end: number,
  counterclockwise: boolean,
): string {
  const startPoint: SheetPoint = [center[0] + radius * Math.cos(start), center[1] + radius * Math.sin(start)];
  const endPoint: SheetPoint = [center[0] + radius * Math.cos(end), center[1] + radius * Math.sin(end)];
  let delta = counterclockwise ? start - end : end - start;
  while (delta < 0) delta += Math.PI * 2;
  while (delta >= Math.PI * 2) delta -= Math.PI * 2;
  const largeArc = delta > Math.PI ? 1 : 0;
  const sweep = counterclockwise ? 0 : 1;
  return `M ${startPoint[0]} ${startPoint[1]} A ${radius} ${radius} 0 ${largeArc} ${sweep} ${endPoint[0]} ${endPoint[1]}`;
}

function ellipsePath(primitive: Extract<DrawingPrimitive, { kind: "ellipse" }>): string {
  const majorRadius = Math.hypot(...primitive.major_axis_sheet_mm);
  if (majorRadius === 0) return "";
  const startPoint = pointAtEllipse(
    primitive.center_sheet_mm,
    primitive.major_axis_sheet_mm,
    primitive.minor_radius_mm,
    primitive.start_parameter_rad,
  );
  const endPoint = pointAtEllipse(
    primitive.center_sheet_mm,
    primitive.major_axis_sheet_mm,
    primitive.minor_radius_mm,
    primitive.end_parameter_rad,
  );
  let delta = primitive.end_parameter_rad - primitive.start_parameter_rad;
  while (delta < 0) delta += Math.PI * 2;
  while (delta >= Math.PI * 2) delta -= Math.PI * 2;
  const rotationDegrees = Math.atan2(
    primitive.major_axis_sheet_mm[1],
    primitive.major_axis_sheet_mm[0],
  ) * 180 / Math.PI;
  return `M ${startPoint[0]} ${startPoint[1]} A ${majorRadius} ${primitive.minor_radius_mm} ${rotationDegrees} ${delta > Math.PI ? 1 : 0} 1 ${endPoint[0]} ${endPoint[1]}`;
}

function nurbsBasis(index: number, degree: number, parameter: number, knots: readonly number[], end: number): number {
  if (degree === 0) {
    return (knots[index] <= parameter && parameter < knots[index + 1]) ||
      (parameter === end && knots[index + 1] === end)
      ? 1
      : 0;
  }
  const leftDenominator = knots[index + degree] - knots[index];
  const rightDenominator = knots[index + degree + 1] - knots[index + 1];
  const left = leftDenominator === 0
    ? 0
    : (parameter - knots[index]) / leftDenominator * nurbsBasis(index, degree - 1, parameter, knots, end);
  const right = rightDenominator === 0
    ? 0
    : (knots[index + degree + 1] - parameter) / rightDenominator * nurbsBasis(index + 1, degree - 1, parameter, knots, end);
  return left + right;
}

/** Renderer-only NURBS sampling. It approximates already-projected sheet
 * geometry for SVG display; it does not create or classify Drawing curves. */
export function sampleDrawingNURBS(
  primitive: Extract<DrawingPrimitive, { kind: "nurbs" }>,
  sampleCount = 48,
): readonly SheetPoint[] {
  const points = primitive.control_points_sheet_mm;
  const weights = primitive.weights;
  const knots = primitive.knots;
  const degree = primitive.degree;
  const lastControlIndex = points.length - 1;
  const structurallyUsable = points.length > degree &&
    weights.length === points.length &&
    knots.length === points.length + degree + 1;
  if (!structurallyUsable) return points;
  const start = knots[degree];
  const end = knots[lastControlIndex + 1];
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return points;
  const output: SheetPoint[] = [];
  for (let sample = 0; sample <= sampleCount; sample += 1) {
    const parameter = start + (end - start) * sample / sampleCount;
    let x = 0;
    let y = 0;
    let divisor = 0;
    for (let index = 0; index <= lastControlIndex; index += 1) {
      const weightedBasis = nurbsBasis(index, degree, parameter, knots, end) * weights[index];
      x += points[index][0] * weightedBasis;
      y += points[index][1] * weightedBasis;
      divisor += weightedBasis;
    }
    if (divisor !== 0 && Number.isFinite(divisor)) output.push([x / divisor, y / divisor]);
  }
  return output.length > 1 ? output : points;
}

export function drawingPrimitivePath(primitive: DrawingPrimitive): string {
  switch (primitive.kind) {
    case "line":
      return `M ${primitive.start_sheet_mm[0]} ${primitive.start_sheet_mm[1]} L ${primitive.end_sheet_mm[0]} ${primitive.end_sheet_mm[1]}`;
    case "arc":
      return arcPath(
        primitive.center_sheet_mm,
        primitive.radius_mm,
        primitive.start_angle_rad,
        primitive.end_angle_rad,
        primitive.counterclockwise,
      );
    case "circle":
      return `M ${primitive.center_sheet_mm[0] + primitive.radius_mm} ${primitive.center_sheet_mm[1]} A ${primitive.radius_mm} ${primitive.radius_mm} 0 1 0 ${primitive.center_sheet_mm[0] - primitive.radius_mm} ${primitive.center_sheet_mm[1]} A ${primitive.radius_mm} ${primitive.radius_mm} 0 1 0 ${primitive.center_sheet_mm[0] + primitive.radius_mm} ${primitive.center_sheet_mm[1]}`;
    case "ellipse":
      return ellipsePath(primitive);
    case "nurbs": {
      const points = sampleDrawingNURBS(primitive);
      return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point[0]} ${point[1]}`).join(" ");
    }
  }
}

function rgba(values: readonly [number, number, number, number]): string {
  const [red, green, blue, alpha] = values;
  const channel = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 255);
  return `rgba(${channel(red)}, ${channel(green)}, ${channel(blue)}, ${Math.max(0, Math.min(1, alpha))})`;
}

function styleForLayer(
  layer: DrawingLayerProjection | undefined,
  styles: ReadonlyMap<string, DrawingStyleProjection>,
): DrawingStyleProjection | undefined {
  return layer ? styles.get(layer.style_id) : undefined;
}

function dashArray(style: DrawingStyleProjection | undefined, primitive: DrawingPrimitive): string | undefined {
  if (primitive.visibility_class === "hidden") return style?.dash_pattern_mm.join(" ") || "3 2";
  if (primitive.visibility_class === "center") return style?.dash_pattern_mm.join(" ") || "6 2 1 2";
  if (style && style.line_pattern !== "solid") return style.dash_pattern_mm.join(" ") || "3 2";
  return undefined;
}

function selectionKeyDown(event: KeyboardEvent<SVGElement>, id: string, onSelect?: (id: string) => void): void {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  onSelect?.(id);
}

function PrimitivePath({
  primitive,
  layer,
  style,
  selected,
  onSelect,
}: {
  primitive: DrawingPrimitive;
  layer: DrawingLayerProjection | undefined;
  style: DrawingStyleProjection | undefined;
  selected: boolean;
  onSelect?: (id: string) => void;
}) {
  if (layer && !layer.visible) return null;
  const path = drawingPrimitivePath(primitive);
  if (!path) return null;
  return <g
    role={onSelect ? "button" : undefined}
    tabIndex={onSelect ? 0 : undefined}
    aria-label={`${primitive.visibility_class} ${primitive.kind}`}
    data-primitive-id={primitive.primitive_id}
    data-source-topology-ids={primitive.source_topology_ids.join(" ")}
    onClick={() => onSelect?.(primitive.primitive_id)}
    onKeyDown={(event) => selectionKeyDown(event, primitive.primitive_id, onSelect)}
  >
    <path
      d={path}
      fill="none"
      stroke={selected ? "#0b8fce" : style ? rgba(style.color_rgba) : "#1d2226"}
      strokeWidth={selected ? Math.max(style?.line_weight_mm ?? 0.25, 0.6) : style?.line_weight_mm ?? 0.25}
      strokeDasharray={dashArray(style, primitive)}
    />
  </g>;
}

function Annotation({ annotation, selected, onSelect, onDragStart }: {
  annotation: DrawingAnnotationProjection;
  selected: boolean;
  onSelect?: (id: string) => void;
  onDragStart?: (event: PointerEvent<SVGGElement>, id: string) => void;
}) {
  if (annotation.state === "suppressed") return null;
  const label = annotation.text || annotation.measurement?.display_text || (annotation.type_id === "center_mark" ? "" : annotation.type_id.replaceAll("_", " "));
  return <g
    role={onSelect ? "button" : undefined}
    tabIndex={onSelect ? 0 : undefined}
    aria-label={label || annotation.type_id.replaceAll("_", " ")}
    data-annotation-id={annotation.id}
    style={onDragStart ? { cursor: "grab" } : undefined}
    onClick={() => onSelect?.(annotation.id)}
    onPointerDown={onDragStart ? (event) => onDragStart(event, annotation.id) : undefined}
    onKeyDown={(event) => selectionKeyDown(event, annotation.id, onSelect)}
    fill={annotation.state === "dangling" ? "#c44343" : selected ? "#0b8fce" : "#1d2226"}
    stroke={annotation.state === "dangling" ? "#c44343" : selected ? "#0b8fce" : "#1d2226"}
  >
    {annotation.leader_points_sheet_mm.length > 1 ? <polyline points={annotation.leader_points_sheet_mm.map((item) => item.join(",")).join(" ")} fill="none" strokeWidth="0.25" /> : null}
    {annotation.geometry_lines_sheet_mm?.map(([a, b], index) => <line key={index} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} strokeWidth="0.2" />)}
    {label && <text textAnchor={annotation.text_alignment === "center" ? "middle" : "start"} x={annotation.text_origin_sheet_mm[0]} y={annotation.text_origin_sheet_mm[1]} fontSize="3.5" stroke="none">{label}</text>}
  </g>;
}

function DrawingView({
  view,
  layers,
  styles,
  selectedIDs,
  showSnapPoints,
  onSelect,
  onDragStart,
}: {
  view: DrawingViewProjection;
  layers: ReadonlyMap<string, DrawingLayerProjection>;
  styles: ReadonlyMap<string, DrawingStyleProjection>;
  selectedIDs: ReadonlySet<string>;
  showSnapPoints: boolean;
  onSelect?: (id: string) => void;
  onDragStart?: (event: PointerEvent<SVGElement>, viewId: string) => void;
}) {
  if (view.state === "suppressed") return null;
  const primitiveMap = new Map(view.geometry.primitives.map((primitive) => [primitive.primitive_id, primitive]));
  return <g
    data-view-id={view.id}
    opacity={view.state === "failed" ? 0.35 : 1}
    onDoubleClick={() => onSelect?.(view.id)}
  >
    {view.geometry.hatch_regions.map((region) => {
      const clipID = `drawing-hatch-${view.id}-${region.region_id}`.replace(/[^a-zA-Z0-9_-]/g, "-");
      const loopPaths = region.boundary_primitive_loops.map((loop) => loop
        .map((id) => primitiveMap.get(id))
        .filter((primitive): primitive is DrawingPrimitive => primitive !== undefined)
        .map(drawingPrimitivePath)
        .join(" "))
        .filter(Boolean);
      const hatchLineCount = Math.min(
        2_000,
        Math.ceil((view.geometry.bounds_sheet_mm[2] - view.geometry.bounds_sheet_mm[0] + view.geometry.bounds_sheet_mm[3] - view.geometry.bounds_sheet_mm[1]) / Math.max(region.spacing_mm, 0.1)) + 2,
      );
      const hatchStyle = styles.get(region.style_id);
      return <g key={region.region_id} data-hatch-region-id={region.region_id}>
        <defs>
          <clipPath id={clipID}>{loopPaths.map((path, index) => <path key={index} d={path} />)}</clipPath>
        </defs>
        <g
          clipPath={`url(#${clipID})`}
          stroke={hatchStyle ? rgba(hatchStyle.color_rgba) : "#687077"}
          strokeWidth={hatchStyle?.line_weight_mm ?? 0.18}
          strokeDasharray={hatchStyle?.line_pattern === "solid" ? undefined : hatchStyle?.dash_pattern_mm.join(" ")}
          opacity="0.65"
        >
          {Array.from({ length: hatchLineCount }, (_, index) => {
            const offset = (index - 1) * Math.max(region.spacing_mm, 0.1);
            return <line key={index} x1={view.geometry.bounds_sheet_mm[0] - 200} y1={view.geometry.bounds_sheet_mm[1] + offset} x2={view.geometry.bounds_sheet_mm[2] + 200} y2={view.geometry.bounds_sheet_mm[1] + offset} transform={`rotate(${region.angle_rad * 180 / Math.PI} ${view.origin_sheet_mm[0]} ${view.origin_sheet_mm[1]})`} />;
          })}
        </g>
      </g>;
    })}
    {view.geometry.primitives.map((primitive) => {
      const layer = layers.get(primitive.layer_id);
      return <PrimitivePath
        key={primitive.primitive_id}
        primitive={primitive}
        layer={layer}
        style={styleForLayer(layer, styles)}
        selected={selectedIDs.has(primitive.primitive_id)}
        onSelect={onSelect}
      />;
    })}
    <rect
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      aria-label={`${view.name} drawing view`}
      data-view-selector-id={view.id}
      x={view.boundary_sheet_mm[0]}
      y={view.boundary_sheet_mm[1]}
      width={Math.max(0, view.boundary_sheet_mm[2] - view.boundary_sheet_mm[0])}
      height={Math.max(0, view.boundary_sheet_mm[3] - view.boundary_sheet_mm[1])}
      fill="none"
      stroke={selectedIDs.has(view.id) ? "#0b8fce" : "transparent"}
      strokeWidth={selectedIDs.has(view.id) ? 0.6 : 2}
      vectorEffect="non-scaling-stroke"
      pointerEvents="visibleStroke"
      style={onDragStart ? { cursor: "grab" } : undefined}
      onClick={() => onSelect?.(view.id)}
      onPointerDown={onDragStart ? (event) => onDragStart(event, view.id) : undefined}
      onKeyDown={(event) => selectionKeyDown(event, view.id, onSelect)}
    />
    {showSnapPoints ? view.geometry.snap_points.map((snap) => {
      const [sx, sy] = snap.point_sheet_mm;
      if (snap.kind === "endpoint") {
        return <rect key={snap.snap_id} data-snap-id={snap.snap_id} data-snap-kind={snap.kind} x={sx - 0.9} y={sy - 0.9} width="1.8" height="1.8" fill="#0b8fce" opacity="0.82"><title>{`Endpoint (${sx.toFixed(1)}, ${sy.toFixed(1)} mm)`}</title></rect>;
      }
      if (snap.kind === "midpoint") {
        return <polygon key={snap.snap_id} data-snap-id={snap.snap_id} data-snap-kind={snap.kind} points={`${sx},${sy - 1.1} ${sx + 1.1},${sy} ${sx},${sy + 1.1} ${sx - 1.1},${sy}`} fill="#16a34a" opacity="0.82"><title>{`Midpoint (${sx.toFixed(1)}, ${sy.toFixed(1)} mm)`}</title></polygon>;
      }
      return <circle key={snap.snap_id} data-snap-id={snap.snap_id} data-snap-kind={snap.kind} cx={sx} cy={sy} r="1.0" fill="#d97706" opacity="0.82"><title>{`${snap.kind} (${sx.toFixed(1)}, ${sy.toFixed(1)} mm)`}</title></circle>;
    }) : null}
    {view.display.show_view_label && view.label ? (
      <text
        x={view.origin_sheet_mm[0]}
        y={view.boundary_sheet_mm[3] + 6}
        textAnchor="middle"
        fontSize="3.5"
        fill="#1d2226"
        style={onDragStart ? { cursor: "grab" } : undefined}
        onPointerDown={onDragStart ? (event) => onDragStart(event, view.id) : undefined}
      >
        {view.label}
      </text>
    ) : null}
  </g>;
}

function BOMTables({ sheet }: { sheet: DrawingSheetProjection }) {
  return <>{sheet.bom_tables.map((table) => {
    const rowHeight = 5;
    const columns = Math.max(1, table.visible_column_ids.length);
    const columnWidth = table.width_mm / columns;
    return <g key={table.id} data-bom-table-id={table.id} transform={`translate(${table.origin_sheet_mm[0]} ${table.origin_sheet_mm[1]})`}>
      <rect width={table.width_mm} height={(table.rows.length + 1) * rowHeight} fill="white" stroke="#1d2226" strokeWidth="0.25" />
      {Array.from({ length: columns - 1 }, (_, index) => <line key={index} x1={(index + 1) * columnWidth} x2={(index + 1) * columnWidth} y1="0" y2={(table.rows.length + 1) * rowHeight} stroke="#1d2226" strokeWidth="0.18" />)}
      {Array.from({ length: table.rows.length }, (_, index) => <line key={index} x1="0" x2={table.width_mm} y1={(index + 1) * rowHeight} y2={(index + 1) * rowHeight} stroke="#1d2226" strokeWidth="0.18" />)}
      {table.visible_column_ids.map((column, index) => <text key={column} x={index * columnWidth + 1} y="3.6" fontSize="2.8" fontWeight="700">{column.replaceAll("_", " ")}</text>)}
      {table.rows.map((row, rowIndex) => table.visible_column_ids.map((column, columnIndex) => {
        const fallback = column === "item" ? row.item_number : column === "quantity" ? String(row.quantity) : "";
        const value = row.cells.find((cell) => cell.column_id === column)?.display_text ?? fallback;
        return <text key={`${row.row_key}-${column}`} x={columnIndex * columnWidth + 1} y={(rowIndex + 1) * rowHeight + 3.6} fontSize="2.8">{value}</text>;
      }))}
    </g>;
  })}</>;
}

export function DrawingSheetCanvas({
  sheet,
  styles: styleList,
  selectedIDs = new Set(),
  showSnapPoints = false,
  placementTool = "select",
  editable = false,
  viewBox: controlledViewBox,
  onViewBoxChange,
  onSelect,
  onMoveView,
  onMoveAnnotation,
  onPlaceAnnotation,
  className,
}: DrawingSheetCanvasProps) {
  const styles = new Map(styleList.map((style) => [style.id, style]));
  const layers = new Map(sheet.layers.map((layer) => [layer.id, layer]));
  const margin = sheet.border;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [localViewBox, setLocalViewBox] = useState<SheetViewBox>(() => defaultViewBox(sheet.width_mm, sheet.height_mm));
  const vb = controlledViewBox ?? localViewBox;
  const setVb = (next: SheetViewBox) => {
    if (onViewBoxChange) onViewBoxChange(next);
    else setLocalViewBox(next);
  };

  type DragState =
    | { kind: "pan"; startClient: [number, number]; startVb: SheetViewBox }
    | { kind: "view" | "annotation"; id: string; startMm: [number, number]; currentMm: [number, number] };
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hoverMm, setHoverMm] = useState<[number, number] | null>(null);
  const [activeSnap, setActiveSnap] = useState<SnapCandidate | null>(null);
  const [firstPick, setFirstPick] = useState<{ pointMm: [number, number]; viewId?: string } | null>(null);

  useEffect(() => {
    setFirstPick(null);
  }, [placementTool, sheet.id]);

  useEffect(() => {
    if (!firstPick) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setFirstPick(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [firstPick]);

  const toolMeta = DRAWING_PLACEMENT_TOOLS.find((t) => t.id === placementTool) ?? DRAWING_PLACEMENT_TOOLS[0];
  const placing = editable && placementTool !== "select" && Boolean(onPlaceAnnotation);
  const canDragView = editable && placementTool === "select" && Boolean(onMoveView);
  const canDragAnnotation = editable && placementTool === "select" && Boolean(onMoveAnnotation);

  const eventToMm = (clientX: number, clientY: number): [number, number] | null => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return clientToSheetMm(clientX, clientY, rect, vb);
  };

  const handleWheel = (event: WheelEvent<SVGSVGElement>) => {
    const pt = eventToMm(event.clientX, event.clientY);
    if (!pt) return;
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.16 : 1 / 1.16;
    setVb(zoomViewBoxAt(vb, sheet.width_mm, sheet.height_mm, factor, pt));
  };

  const handleSvgPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button === 1 || (event.button === 0 && event.shiftKey)) {
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setDrag({ kind: "pan", startClient: [event.clientX, event.clientY], startVb: vb });
      return;
    }
    if (placing && event.button === 0) {
      const raw = eventToMm(event.clientX, event.clientY);
      if (!raw) return;
      event.preventDefault();
      const snapped = findNearestSnapPoint(sheet, raw, Math.max(3.5, vb[2] * 0.015));
      const pt: [number, number] = snapped ? [snapped.snap.point_sheet_mm[0], snapped.snap.point_sheet_mm[1]] : raw;
      const viewId = snapped?.viewId;
      if (toolMeta.clicks === 1) {
        onPlaceAnnotation?.(placementTool as Exclude<DrawingPlacementTool, "select">, [pt], viewId);
      } else if (!firstPick) {
        setFirstPick({ pointMm: pt, viewId });
      } else {
        onPlaceAnnotation?.(
          placementTool as Exclude<DrawingPlacementTool, "select">,
          [firstPick.pointMm, pt],
          firstPick.viewId ?? viewId,
        );
        setFirstPick(null);
      }
    }
  };

  const startEntityDrag = (kind: "view" | "annotation", id: string, event: PointerEvent<SVGElement>) => {
    if (event.button !== 0 || event.shiftKey || placing) return;
    const pt = eventToMm(event.clientX, event.clientY);
    if (!pt) return;
    event.stopPropagation();
    svgRef.current?.setPointerCapture?.(event.pointerId);
    setDrag({ kind, id, startMm: pt, currentMm: pt });
  };

  const handleSvgPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (drag?.kind === "pan") {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) return;
      const dx = ((event.clientX - drag.startClient[0]) / rect.width) * drag.startVb[2];
      const dy = ((event.clientY - drag.startClient[1]) / rect.height) * drag.startVb[3];
      setVb(clampViewBox([drag.startVb[0] - dx, drag.startVb[1] - dy, drag.startVb[2], drag.startVb[3]], sheet.width_mm, sheet.height_mm));
      return;
    }
    const raw = eventToMm(event.clientX, event.clientY);
    if (!raw) return;
    if (drag && (drag.kind === "view" || drag.kind === "annotation")) {
      setDrag({ ...drag, currentMm: raw });
      return;
    }
    if (placing || showSnapPoints) {
      setHoverMm(raw);
      setActiveSnap(findNearestSnapPoint(sheet, raw, Math.max(3.5, vb[2] * 0.015)));
    } else if (hoverMm) {
      setHoverMm(null);
      setActiveSnap(null);
    }
  };

  const handleSvgPointerUp = (event: PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    svgRef.current?.releasePointerCapture?.(event.pointerId);
    if (drag.kind === "view" || drag.kind === "annotation") {
      const dx = drag.currentMm[0] - drag.startMm[0];
      const dy = drag.currentMm[1] - drag.startMm[1];
      if (Math.hypot(dx, dy) >= 1.5) {
        if (drag.kind === "view") onMoveView?.(drag.id, [dx, dy]);
        else onMoveAnnotation?.(drag.id, [dx, dy]);
      }
    }
    setDrag(null);
  };

  const dragViewTarget = drag?.kind === "view" ? sheet.views.find((v) => v.id === drag.id) : undefined;
  const dragDelta: [number, number] | null =
    drag && (drag.kind === "view" || drag.kind === "annotation")
      ? [drag.currentMm[0] - drag.startMm[0], drag.currentMm[1] - drag.startMm[1]]
      : null;
  const cursorPt: [number, number] | null = activeSnap
    ? [activeSnap.snap.point_sheet_mm[0], activeSnap.snap.point_sheet_mm[1]]
    : hoverMm;

  return <figure className={["cad-drawing-sheet", className].filter(Boolean).join(" ")}>
    <svg
      ref={svgRef}
      role="img"
      aria-label={`${sheet.name} technical drawing sheet`}
      viewBox={`${vb[0]} ${vb[1]} ${vb[2]} ${vb[3]}`}
      preserveAspectRatio="xMidYMid meet"
      data-sheet-id={sheet.id}
      data-projection-standard={sheet.projection_standard}
      data-placement-tool={placementTool}
      style={{ cursor: drag?.kind === "pan" ? "grabbing" : placing ? "crosshair" : undefined }}
      onWheel={handleWheel}
      onPointerDown={handleSvgPointerDown}
      onPointerMove={handleSvgPointerMove}
      onPointerUp={handleSvgPointerUp}
      onPointerLeave={() => { setHoverMm(null); setActiveSnap(null); }}
    >
      <title>{sheet.name}</title>
      <rect width={sheet.width_mm} height={sheet.height_mm} fill="#fff" />
      <rect
        x={margin.margin_left_mm}
        y={margin.margin_top_mm}
        width={sheet.width_mm - margin.margin_left_mm - margin.margin_right_mm}
        height={sheet.height_mm - margin.margin_top_mm - margin.margin_bottom_mm}
        fill="none"
        stroke="#1d2226"
        strokeWidth="0.35"
      />
      {sheet.views.map((view) => <DrawingView
        key={view.id}
        view={view}
        layers={layers}
        styles={styles}
        selectedIDs={selectedIDs}
        showSnapPoints={showSnapPoints || placing}
        onSelect={placing ? undefined : onSelect}
        onDragStart={canDragView ? (event, id) => startEntityDrag("view", id, event) : undefined}
      />)}
      {sheet.annotations.map((annotation) => <Annotation
        key={annotation.id}
        annotation={annotation}
        selected={selectedIDs.has(annotation.id)}
        onSelect={placing ? undefined : onSelect}
        onDragStart={canDragAnnotation ? (event, id) => startEntityDrag("annotation", id, event) : undefined}
      />)}
      <BOMTables sheet={sheet} />
      <g data-title-block-id={sheet.title_block.id} transform={`translate(${sheet.title_block.origin_sheet_mm[0]} ${sheet.title_block.origin_sheet_mm[1]})`}>
        <rect width={sheet.title_block.width_mm} height={sheet.title_block.height_mm} fill="white" stroke="#1d2226" strokeWidth="0.3" />
        {sheet.title_block.fields.map((field, index) => <g key={field.field_id} transform={`translate(2 ${4 + index * 5})`}>
          <text fontSize="2.2" fill="#626a70">{field.label}</text>
          <text x="22" fontSize="2.8" fill="#1d2226">{field.value}</text>
        </g>)}
      </g>
      {dragViewTarget && dragDelta && Math.hypot(dragDelta[0], dragDelta[1]) >= 1.5 && (
        <g data-drag-preview="view" pointerEvents="none">
          <rect
            x={dragViewTarget.boundary_sheet_mm[0] + dragDelta[0]}
            y={dragViewTarget.boundary_sheet_mm[1] + dragDelta[1]}
            width={Math.max(0, dragViewTarget.boundary_sheet_mm[2] - dragViewTarget.boundary_sheet_mm[0])}
            height={Math.max(0, dragViewTarget.boundary_sheet_mm[3] - dragViewTarget.boundary_sheet_mm[1])}
            fill="rgba(11, 143, 206, 0.08)"
            stroke="#0b8fce"
            strokeWidth="0.5"
            strokeDasharray="2.5 1.5"
          />
          <text
            x={dragViewTarget.origin_sheet_mm[0] + dragDelta[0]}
            y={dragViewTarget.boundary_sheet_mm[1] + dragDelta[1] - 2}
            textAnchor="middle"
            fontSize="3"
            fill="#0b8fce"
          >{`Δ ${dragDelta[0].toFixed(1)}, ${dragDelta[1].toFixed(1)} mm`}</text>
        </g>
      )}
      {drag?.kind === "annotation" && dragDelta && Math.hypot(dragDelta[0], dragDelta[1]) >= 1.5 && (
        <g data-drag-preview="annotation" pointerEvents="none">
          <line x1={drag.startMm[0]} y1={drag.startMm[1]} x2={drag.currentMm[0]} y2={drag.currentMm[1]} stroke="#0b8fce" strokeWidth="0.4" strokeDasharray="2 1.5" />
          <circle cx={drag.currentMm[0]} cy={drag.currentMm[1]} r="1.4" fill="none" stroke="#0b8fce" strokeWidth="0.45" />
          <text x={drag.currentMm[0] + 2.5} y={drag.currentMm[1] - 2} fontSize="2.8" fill="#0b8fce">{`Δ ${dragDelta[0].toFixed(1)}, ${dragDelta[1].toFixed(1)} mm`}</text>
        </g>
      )}
      {placing && firstPick && cursorPt && (
        <g data-placement-rubberband="true" pointerEvents="none">
          <line x1={firstPick.pointMm[0]} y1={firstPick.pointMm[1]} x2={cursorPt[0]} y2={cursorPt[1]} stroke="#0b8fce" strokeWidth="0.45" strokeDasharray="2.2 1.4" />
          <circle cx={firstPick.pointMm[0]} cy={firstPick.pointMm[1]} r="1.4" fill="#0b8fce" />
        </g>
      )}
      {placing && cursorPt && (
        <g data-placement-cursor="true" pointerEvents="none">
          <line x1={cursorPt[0] - 3} y1={cursorPt[1]} x2={cursorPt[0] + 3} y2={cursorPt[1]} stroke={activeSnap ? "#16a34a" : "#0b8fce"} strokeWidth="0.35" />
          <line x1={cursorPt[0]} y1={cursorPt[1] - 3} x2={cursorPt[0]} y2={cursorPt[1] + 3} stroke={activeSnap ? "#16a34a" : "#0b8fce"} strokeWidth="0.35" />
          {activeSnap && <circle cx={cursorPt[0]} cy={cursorPt[1]} r="2.2" fill="none" stroke="#16a34a" strokeWidth="0.5" />}
          <text x={cursorPt[0] + 3.2} y={cursorPt[1] - 2.5} fontSize="2.6" fill={activeSnap ? "#15803d" : "#0b8fce"}>
            {activeSnap ? `${activeSnap.snap.kind} (${cursorPt[0].toFixed(1)}, ${cursorPt[1].toFixed(1)})` : `${cursorPt[0].toFixed(1)}, ${cursorPt[1].toFixed(1)} mm`}
          </text>
        </g>
      )}
    </svg>
    <figcaption>{sheet.name} · {sheet.width_mm} × {sheet.height_mm} mm · {sheet.projection_standard.replace("_", " ")}</figcaption>
  </figure>;
}
