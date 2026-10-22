export const instructions: Record<string, string> = {
  conic: 'Click start, end and tangent control. Rho entry opens automatically; press Enter to accept, or set curvature with another click. Type rho or =#variable after the endpoints to size early. Drag the curve’s rho handle to adjust curvature; Alt bypasses the parabola snap. Escape cancels unfinished geometry.',
  "fit-spline":
    "Click fit points; double-click the final point, press Enter or Confirm spline to finish. Click the first point for a closed loop. Backspace or Undo removes the last unfinished point; Escape cancels the curve.",
  "tangent-arc":
    "Click an existing curve endpoint, then the arc endpoint, or drag from the endpoint and release. Escape cancels.",
  "insert-spline-point":
    "Click inside a cubic spline span to insert a smooth editable point without changing its shape.",
  split: "Click inside a curve to split it; choose two positions for a circle.",
  break: "Click a curve to break it at every crossing with another curve.",
  trim: "Click a curve portion or drag across curves to trim between boundaries.",
  extend:
    "Click near a free line, arc, or ellipse end to extend to a boundary, or click a new endpoint when no boundary exists.",
  point: "Click to place a sketch point.",
  "elliptical-arc":
    "Click center, primary radius, then arc start to size the second radius; click the end direction. For an axis start, first move to size the ellipse or set Secondary radius. Choose clockwise or counterclockwise.",
  ellipse: "Click center, major axis endpoint, then minor axis width.",
  "cubic-bezier": "Click start, first control, second control, then end.",
  "midpoint-line": "Click the midpoint, then one endpoint.",
  "center-rectangle": "Click the center then a corner, or drag from the center. Hold Alt for a square. Type a width, then Enter for height; Enter confirms both dimensions.",
  "aligned-rectangle":
    "Click the first edge endpoints, then set the perpendicular width.",
  "three-point-circle": "Click three points on the circumference.",
  "two-point-circle": "Click the two ends of a diameter.",
  "two-tangent-circle": "Set the radius; click two curves the circle should touch.",
  "three-tangent-circle": "Click three curves the circle should touch.",
  "rounded-rectangle": "Set the corner radius; click two opposite corners.",
  "edge-polygon": "Set the side count; click the two ends of one edge (the polygon grows to its left).",
  "center-slot": "Set the slot width; click the two arc centres.",
  "overall-slot": "Set the slot width; click the two overall ends.",
  "center-point-slot": "Set the slot width; click the slot centre, then one arc centre.",
  "center-arc-slot": "Set the slot width; click the centre arc's centre, its start, then its end direction.",
  "three-point-arc-slot": "Set the slot width; click three points on the centre arc: start, through, end.",
  "center-arc":
    "Click the center, start, then end direction. Choose clockwise or counterclockwise.",
  "inscribed-polygon": "Set the side count; click the center, then a vertex.",
  "circumscribed-polygon":
    "Set the side count; click the center, then the midpoint of a side.",
  select:
    "Select geometry, then choose a constraint; or choose a constraint first and click its targets. Ctrl/Command or Shift adds to the selection. Escape exits a tool.",
  line: "Click connected endpoints; click the starting point to close. New contour starts another chain.",
  arc: "Click start and end, or drag to set both endpoints. Then move and click to set curvature. Switch to Line to continue.",
  circle: "Click center, then a point on the circumference.",
  rectangle: "Click opposite corners or drag between them. Hold Alt for a square. Type a width, then Enter for height; Enter confirms both dimensions.",
};

export const modificationTools = [
  "offset",
  "slot",
  "chamfer",
  "fillet",
  "mirror",
  "linear-pattern",
  "circular-pattern",
  "transform",
] as const;
export type ModificationTool = (typeof modificationTools)[number];

export const directModificationTools = [
  "trim",
  "extend",
  "split",
  "break",
  "insert-spline-point",
] as const;
export type DirectModificationTool = (typeof directModificationTools)[number];

export function isDirectModificationTool(
  tool: string,
): tool is DirectModificationTool {
  return (directModificationTools as readonly string[]).includes(tool);
}
