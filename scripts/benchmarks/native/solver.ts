/** Matched sketch-solver benchmark. The same constrained sketches (a dimensioned
 *  rectangle plus a grid of circles, each with a radius and two distances) are
 *  solved after a width-dimension edit by our solver and by FreeCAD's PlaneGCS
 *  (the wasm spike); solver-freecad.py runs FreeCAD's own Sketcher on the fixtures
 *  this script writes. Run from the repository root with vite-node. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { solveDrawingConstraints } from '../../../aether-engine/src/sketch/drawing-constraints';
import { initPlanegcsSpike, solveDrawingConstraintsWithPlanegcs } from '../../../aether-engine/src/sketch/solver/planegcs-spike';
import type { SketchDrawing } from '../../../aether-engine/src/sketch/drawing';
import type { DrawingConstraint, SketchEntityRef } from '../../../aether-engine/src/sketch/solver/types';

const SIZE = 60, ROUNDS = Number(process.env.BENCH_RUNS ?? 6);
const point = (contour: number, index: number): SketchEntityRef => ({ contour, kind: 'point', index });
const line = (index: number): SketchEntityRef => ({ contour: 0, kind: 'line', index });

export function fixture(circles: number): SketchDrawing {
  const corners: [number, number][] = [[0, 0], [SIZE, 0], [SIZE, SIZE], [0, SIZE]];
  const constraints: DrawingConstraint[] = [
    { id: 'close', kind: 'coincident', a: point(0, 4), b: point(0, 0) },
    { id: 'fix', kind: 'fix', a: point(0, 0), point: corners[0] },
    { id: 'h0', kind: 'horizontal', a: line(0) }, { id: 'h2', kind: 'horizontal', a: line(2) },
    { id: 'v1', kind: 'vertical', a: line(1) }, { id: 'v3', kind: 'vertical', a: line(3) },
    { id: 'width', kind: 'horizontal-distance', a: point(0, 0), b: point(0, 1), value: SIZE },
    { id: 'height', kind: 'vertical-distance', a: point(0, 0), b: point(0, 3), value: SIZE },
  ];
  const drawing: SketchDrawing = { type: 'drawing', contours: [{ type: 'path', start: corners[0], segments: corners.slice(1).concat([corners[0]]).map(end => ({ type: 'line', end })) }], constraints };
  for (let i = 0; i < circles; i++) {
    const center: [number, number] = [5 + (i % 10) * 5.5, 5 + Math.floor(i / 10) * 5.5];
    drawing.contours.push({ type: 'circle', center, radius: 1.5 });
    constraints.push(
      { id: `r${i}`, kind: 'radius', a: { contour: i + 1, kind: 'circle' }, value: 1.5 },
      { id: `x${i}`, kind: 'horizontal-distance', a: point(0, 0), b: point(i + 1, 0), value: center[0] },
      { id: `y${i}`, kind: 'vertical-distance', a: point(0, 0), b: point(i + 1, 0), value: center[1] },
    );
  }
  return drawing;
}

/** Edit the width each round and time the solve; verify the solved width. */
function run(drawing: SketchDrawing, solve: (d: SketchDrawing) => SketchDrawing): number[] {
  const times: number[] = [];
  let current = drawing;
  for (let round = 0; round < ROUNDS; round++) {
    const value = SIZE + (round % 2 ? 1 : 0.5);
    const edited: SketchDrawing = structuredClone(current);
    edited.constraints!.find(c => c.id === 'width')!.value = value;
    const start = performance.now();
    current = solve(edited);
    times.push(performance.now() - start);
    const path = current.contours[0];
    if (path.type !== 'path' || Math.abs(path.segments[0].end[0] - path.start[0] - value) > 1e-6) throw Error(`Solved width is wrong after round ${round}`);
  }
  return times;
}

const sizes = (process.env.BENCH_CIRCLES ?? '0,20,100').split(',').map(Number);
mkdirSync('build/native-comparison/solver-fixtures', { recursive: true });
await initPlanegcsSpike();
const results: Record<string, unknown> = {};
for (const circles of sizes) {
  const drawing = fixture(circles);
  writeFileSync(`build/native-comparison/solver-fixtures/${circles}.json`, JSON.stringify({ size: SIZE, rounds: ROUNDS, drawing }, null, 2));
  let planegcs: number[] | string;
  try { planegcs = run(drawing, d => solveDrawingConstraintsWithPlanegcs(d)); } catch (error) { planegcs = String(error); }
  results[circles] = { constraints: drawing.constraints!.length, aetherMs: run(drawing, d => solveDrawingConstraints(d)), planegcsMs: planegcs };
}
writeFileSync('build/native-comparison/solver-aether.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
