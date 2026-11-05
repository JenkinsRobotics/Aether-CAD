import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import init from 'replicad-opencascadejs';
import { drawCircle, drawRectangle, isShape3D, measureVolume, setOC } from 'replicad';
import './booleans';
import { writeBrep } from './brep-bytes';

beforeAll(async () => {
  setOC(await (init as any)({ wasmBinary: readFileSync(new URL('../../node_modules/replicad-opencascadejs/src/replicad_single.wasm', import.meta.url)) }));
}, 30000);

it.each(['cut', 'fuse', 'intersect'] as const)('%s preserves exact inputs shared by history and previews', operation => {
  const body = drawRectangle(20, 20).sketchOnPlane('XY').extrude(10);
  const tool = drawCircle(5).sketchOnPlane('XY').extrude(15).translate(9, 0, 0);
  if (!isShape3D(body) || !isShape3D(tool)) throw new Error('Expected solid test inputs.');
  const beforeBody = writeBrep(body), beforeTool = writeBrep(tool);
  // Integrate the cylinder's circular segment inside the box (x <= 10).
  const overlap = 10 * (Math.sqrt(24) + 25 * (Math.asin(1 / 5) + Math.PI / 2));
  const expected = operation === 'cut' ? 4000 - overlap
    : operation === 'fuse' ? 4000 + 375 * Math.PI - overlap : overlap;
  try {
    // A repeated preview must neither accumulate native changes nor depend on
    // a previously simplified result. Compare B-rep as well as visible volume.
    for (let preview = 0; preview < 3; preview++) {
      const result = body[operation](tool);
      try {
        expect(measureVolume(result)).toBeCloseTo(expected, 7);
        expect(writeBrep(body)).toEqual(beforeBody);
        expect(writeBrep(tool)).toEqual(beforeTool);
      } finally { result.delete(); }
    }
  } finally { body.delete(); tool.delete(); }
});
