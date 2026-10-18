import { solveDrawingConstraints, type DrawingConstraint, type SketchDrawing, type SketchPoint } from '@aether/core/sketch';
import { bindDimensionInput } from './dimension-input';

type Options = { parent: HTMLElement; drawing(): SketchDrawing; commit(next: SketchDrawing, positions?: Record<string, SketchPoint>): void; report(message: string): void; focusCanvas(): void };
/** Optional creation dimensions, using the same length drivers as the Dimension tool. */
export function mountRecentRectangle(o: Options) {
  const row = document.createElement('div');
  row.className = 'sketch-recent-rectangle'; row.hidden = true;
  let target: number | undefined, square = false;
  const fields = ['Width', 'Height'].map(name => {
    const label = document.createElement('label'), caption = document.createElement('span'), input = document.createElement('input');
    input.type = 'text'; input.inputMode = 'decimal';
    const binding = bindDimensionInput(input, () => 'length', unit => {
      caption.textContent = `${name} (${unit})`;
      input.setAttribute('aria-label', `New rectangle ${name.toLowerCase()} (${unit})`);
    });
    label.append(caption, input); row.append(label);
    return { input, binding };
  });
  const clear = () => { target = undefined; row.hidden = true; };
  const submit = () => {
    if (target === undefined) return;
    try {
      const values = [fields[0].binding.read(), square ? fields[0].binding.read() : fields[1].binding.read()];
      if (values.some(v => !Number.isFinite(v) || v <= 0)) throw Error('Width and height must be positive lengths.');
      const source = o.drawing();
      const constraints: DrawingConstraint[] = [...source.constraints ?? []];
      const dimensionIds: string[] = [];
      for (const index of square ? [0] : [0, 1]) {
        let id = `rectangle-${index === 0 ? 'width' : 'height'}`;
        while (constraints.some(c => c.id === id)) id += '-';
        dimensionIds.push(id);
        constraints.push({ id, kind: 'length', a: { contour: target, kind: 'line', index }, value: values[index] });
      }
      const solved = solveDrawingConstraints({ ...source, constraints });
      const path = solved.contours[target];
      const positions: Record<string, SketchPoint> = {};
      if (path.type === 'path') {
        const vertices = [path.start, ...path.segments.map(s => s.end)];
        const center = [(vertices[0][0] + vertices[2][0]) / 2, (vertices[0][1] + vertices[2][1]) / 2];
        dimensionIds.forEach((id, index) => {
          const a = vertices[index], b = vertices[index + 1];
          const midpoint = [(a[0]+b[0])/2, (a[1]+b[1])/2];
          const normal = [-(b[1]-a[1]), b[0]-a[0]];
          const direction = normal[0]*(midpoint[0]-center[0]) + normal[1]*(midpoint[1]-center[1]) < 0 ? -1 : 1;
          const scale = direction * Math.max(3, Math.max(...values)*0.15) / Math.hypot(...normal);
          positions[id] = [midpoint[0]+normal[0]*scale, midpoint[1]+normal[1]*scale];
        });
      }
      o.commit(solved, positions);
      clear(); o.focusCanvas();
    } catch (error) { o.report((error as Error).message); }
  };
  fields.forEach((field, i) => field.input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); clear(); o.focusCanvas(); }
    if (e.key !== 'Enter') return;
    e.preventDefault(); e.stopPropagation();
    if (i === 0 && !square) { fields[1].input.focus(); fields[1].input.select(); } else submit();
  }));
  const apply = document.createElement('button'); apply.type = 'button'; apply.textContent = 'Set rectangle dimensions'; apply.onclick = submit;
  row.append(apply); o.parent.append(row);
  return {
    clear,
    dispose() { fields.forEach(f => f.binding.dispose()); row.remove(); },
    offer(tool: string, contour: number) {
      clear();
      if (!['rectangle', 'center-rectangle', 'aligned-rectangle'].includes(tool)) return;
      const drawing = o.drawing(), path = drawing.contours[contour];
      if (path?.type !== 'path' || path.segments.length !== 4) return;
      target = contour;
      square = Boolean(drawing.constraints?.some(c => c.kind === 'equal' && !c.reference && c.a.contour === contour && c.b?.contour === contour && c.a.kind === 'line' && c.b.kind === 'line' && [c.a.index, c.b.index].includes(0) && [c.a.index, c.b.index].includes(1)));
      const a = path.start, b = path.segments[0].end, c = path.segments[1].end;
      fields[0].binding.write(Math.hypot(b[0] - a[0], b[1] - a[1]));
      fields[1].binding.write(Math.hypot(c[0] - b[0], c[1] - b[1]));
      fields[1].input.disabled = square;
      fields[1].input.title = square ? 'Height follows width through the Equal constraint.' : fields[0].input.title;
      row.hidden = false;
    },
    key(e: KeyboardEvent) {
      if (target === undefined || e.ctrlKey || e.metaKey || e.altKey || (e.target as Element | null)?.closest?.('input, textarea, select, [contenteditable=true]') || !/^[0-9.]$/.test(e.key)) return;
      e.preventDefault(); fields[0].input.focus(); fields[0].input.value = e.key === '.' ? '0.' : e.key;
    },
  };
}
