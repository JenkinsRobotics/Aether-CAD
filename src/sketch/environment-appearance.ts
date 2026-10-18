import { cadAppearance } from '../cad-appearance-store';
import { resolveAppearance, type ResolvedAppearance } from '../viewport/appearance-themes';
import { readViewportThemeOverride } from '../viewport/suite-viewport-theme';
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** Restyle just the plane and grid. Entity IDs, constraints and snapping stay
 * in the sketch model; changing a visual grid never moves sketch geometry. */
export function updateSketchEnvironment(svg: SVGSVGElement, resolved: ResolvedAppearance = resolveAppearance(cadAppearance.snapshot(), readViewportThemeOverride())) {
  const plane = svg.dataset.environmentPlane;
  const style = resolved.planeTheme.style, color = resolved.planeTheme.colors[
    plane === 'front' || plane === 'right' || plane === 'custom' ? plane : 'top'
  ];
  const vars = {
    'plane-color': hex(color), 'plane-fill-opacity': style.fillOpacity, 'plane-border-opacity': style.borderOpacity,
    'plane-border-width': style.borderWidthPx, 'plane-label-color': style.labelColor, 'plane-label-opacity': style.labelsVisible ? style.labelOpacity : 0,
    'grid-color': hex(resolved.gridMinor), 'grid-opacity': resolved.gridOpacity, 'grid-width': resolved.grid.minorWidth,
    'grid-major-color': hex(resolved.gridMajor), 'grid-major-opacity': resolved.grid.majorOpacity, 'grid-major-width': resolved.grid.majorWidth,
    'axis': hex(resolved.grid.axisColor), 'axis-opacity': resolved.grid.axisOpacity, 'axis-width': resolved.grid.axisWidth,
    'geometry': hex(resolved.sketchStroke), 'open': hex(resolved.sketchStroke), 'line-width': resolved.sketchLineWidth,
  };
  for (const [key, value] of Object.entries(vars)) svg.style.setProperty(`--cad-sketch-${key}`, String(value));
  let grid = svg.querySelector<SVGGElement>('[data-environment-grid]');
  if (!grid) {
    grid = document.createElementNS('http://www.w3.org/2000/svg', 'g'); grid.dataset.environmentGrid = '';
    const face = svg.querySelector('.sketch-plane-face');
    if (face) face.after(grid); else svg.prepend(grid);
  }
  const half = 80, spacing = resolved.sketchGridSpacing;
  const key = `${spacing}:${resolved.grid.majorEvery}`;
  if (grid.dataset.key === key) return;
  grid.dataset.key = key; grid.replaceChildren();
  const count = Math.min(1000, Math.floor(half / spacing));
  const line = (attrs: Record<string, string | number>) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value)); grid!.append(el);
  };
  for (let i = -count; i <= count; i++) {
    if (!i || Math.abs(i * spacing) >= half) continue;
    const major = i % resolved.grid.majorEvery === 0;
    const attrs = { class: `sketch-grid${major ? ' sketch-grid-major' : ''}` };
    line({ ...attrs, x1: i * spacing, y1: -half, x2: i * spacing, y2: half });
    line({ ...attrs, x1: -half, y1: i * spacing, x2: half, y2: i * spacing });
  }
  line({ class: 'sketch-axis', x1: -half, y1: 0, x2: half, y2: 0 });
  line({ class: 'sketch-axis', x1: 0, y1: -half, x2: 0, y2: half });
}
