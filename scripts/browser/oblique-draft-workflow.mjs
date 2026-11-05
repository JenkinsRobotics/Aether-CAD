import assert from 'node:assert/strict';
import { join } from 'node:path';

/** Native preview, shared controls and saved history for an angled Thin draft. */
export async function verifyObliqueDraft({ page, expect, dialog, row, open, stored, accept, base, sketch, evidence, results }) {
  const doc = base('Angled draft controls');
  doc.features = [sketch('s', 'XY', [[0, 0], [20, 0], [20, 10], [0, 10]]), {
    id: 'e', type: 'extrude', name: 'Extrude 1', suppressed: false, profileFeatureId: 's', profileContourId: 'outline',
    operation: 'new', distanceMillimeters: 10, directionVector: [.6, 0, .8], startingOffsetMillimeters: 2,
    draftAngleDegrees: 3, thin: { thickness1Millimeters: 2, thickness2Millimeters: 1 },
  }];
  const file = await open(doc);
  await page.evaluate(() => window.__aetherSetView?.('isometric'));
  await row(/^Extrude 1/).dblclick();
  const ring = page.getByRole('button', { name: 'Draft angle', exact: true });
  await expect(ring).toHaveAttribute('aria-disabled', 'false', { timeout: 45000 });
  await ring.press('ArrowUp');
  await expect(dialog().locator('[aria-label^="Draft angle ("]')).toHaveValue('4');
  const wall = page.getByRole('button', { name: 'Wall thickness 1', exact: true });
  await expect(wall).toBeEnabled({ timeout: 45000 });
  await wall.press('ArrowUp');
  await expect(dialog().locator('[aria-label="Thickness 1 (mm)"]')).toHaveValue('3');
  const expectedY = -3 + 9.6 * Math.sin(4 * Math.PI / 180) / Math.sqrt(.8 ** 2 - Math.sin(4 * Math.PI / 180) ** 2);
  await expect.poll(() => page.evaluate(() => {
    const model = window.__qualificationPreview;
    if (!model) return null;
    let y = Infinity;
    for (const part of model.featurePreview?.added ?? []) for (let i = 0; i < part.vertices.length; i += 3) {
      if (Math.abs(part.vertices[i + 2] - 9.6) < 1e-4) y = Math.min(y, part.vertices[i + 1]);
    }
    return Number(y.toFixed(4));
  }), { timeout: 45000 }).toBe(Number(expectedY.toFixed(4)));
  await page.screenshot({ path: join(evidence, 'extrude-oblique-draft-controls.png') });
  await accept();
  await expect.poll(async () => (await stored(file.id)).features.at(-1).draftAngleDegrees, { timeout: 30000 }).toBe(4);
  const saved = (await stored(file.id)).features.at(-1);
  assert.deepEqual(saved.directionVector, [.6, 0, .8]);
  assert.equal(saved.thin.thickness1Millimeters, 3);
  await page.reload(); await row(/^Extrude 1/).dblclick();
  await expect(ring).toHaveAttribute('aria-disabled', 'false', { timeout: 45000 });
  await ring.press('ArrowUp');
  await expect(dialog().locator('[aria-label^="Draft angle ("]')).toHaveValue('5');
  await dialog().locator('[data-feature-action="discard"]').click();
  assert.deepEqual((await stored(file.id)).features.at(-1), saved);
  results.push('Angled Extrude Draft: exact planar Thin preview, shared orbit/thickness controls, native wall position, save/reopen and cancel');
}
