import assert from 'node:assert/strict';
import { join } from 'node:path';

export async function verifyExtrudeDirection({ page, expect, dialog, row, point, open, stored, accept, base, sketch, evidence, results }) {
  const moveDialog = async () => {
    const bounds = await dialog().boundingBox();
    await page.mouse.move(bounds.x + 75, bounds.y + 16); await page.mouse.down();
    await page.mouse.move(350, 132, { steps: 8 }); await page.mouse.up();
  };
  const doc = base('Native direction picking');
  doc.features = [sketch('guide-sketch', 'XY', [[30, 0], [35, 0], [31, 3]]),
    { id: 'guide', type: 'extrude', name: 'Guide', suppressed: false, bodyId: 'guide-body', profileFeatureId: 'guide-sketch', operation: 'new', distanceMillimeters: 10, directionVector: [.6, 0, .8] },
    { id: 'axis', type: 'axis', name: 'Direction axis', suppressed: false, definition: { method: 'edge', axis: {
      kind: 'axis', partId: 'guide-body', candidateId: 'axis', label: 'Axis', originMillimeters: [30, 0, 0], directionMillimeters: [0, 0, 1] } } },
    { ...sketch('outline', 'XY', [[0, 0], [20, 0], [20, 10], [0, 10]]), name: 'Outline' },
    { id: 'e', type: 'extrude', name: 'Directed extrude', suppressed: false, bodyId: 'body', profileFeatureId: 'outline', operation: 'new', distanceMillimeters: 10 }];
  const file = await open(doc);
  await row(/^Directed extrude/).dblclick();
  await moveDialog();
  await dialog().getByRole('checkbox', { name: 'Direction', exact: true }).check();
  const box = dialog().locator('.aui-feature-entities[aria-label="Extrusion axis or edge"]');
  await expect(box).toHaveAttribute('data-picking', 'true');
  const at = await point([33, 0, 4]);
  assert.ok(at); assert.equal(await page.evaluate(p => document.elementFromPoint(...p)?.matches('canvas.viewport-canvas'), at), true);
  await page.mouse.click(...at);
  await expect(box.locator('.aui-feature-entity')).toHaveCount(1);
  const read = async () => JSON.parse(await dialog().locator('[aria-label="Direction native reference"]').inputValue());
  assert.equal((await read()).kind, 'solid-edge');
  const handle = page.getByRole('button', { name: 'Pull extrusion depth', exact: true });
  await expect(handle).toBeEnabled({ timeout: 45000 });
  await handle.press('ArrowUp');
  await expect(dialog().locator('[aria-label="Distance (mm)"]')).toHaveValue('11');
  await accept();
  await expect.poll(async () => (await stored(file.id)).features.at(-1).directionReference?.kind, { timeout: 30000 }).toBe('solid-edge');
  await page.reload(); await row(/^Directed extrude/).dblclick(); await moveDialog();
  await expect(handle).toBeEnabled({ timeout: 45000 });
  await box.focus();
  await box.getByRole('button', { name: /^Remove / }).click();
  await expect(box.locator('.aui-feature-entity')).toHaveCount(0);
  await expect(dialog().locator('[data-feature-action="accept"]')).toBeDisabled();
  await expect(box).toHaveAttribute('data-picking', 'true');
  const again = await point([33, 0, 4]);
  await page.mouse.move(...again);
  await expect.poll(async () => page.evaluate(() => window.__aetherHover?.()), { message: 'History source edge must remain pickable after removing its reference' }).toMatchObject({ kind: 'edge' });
  await page.mouse.click(...again); await expect(box.locator('.aui-feature-entity')).toHaveCount(1);
  await page.mouse.click(...again); await expect(box.locator('.aui-feature-entity')).toHaveCount(0);
  await row(/^Direction axis/).click(); await expect(box.locator('.aui-feature-entity')).toHaveCount(1);
  assert.deepEqual(await read(), { kind: 'axis', sourceFeatureId: 'axis', label: 'Direction axis' });
  await expect(handle).toBeEnabled({ timeout: 45000 });
  await page.screenshot({ path: join(evidence, 'extrude-native-direction.png') });
  await accept();
  await expect.poll(async () => (await stored(file.id)).features.at(-1).directionReference?.kind, { timeout: 30000 }).toBe('axis');
  await page.reload(); await row(/^Directed extrude/).dblclick();
  assert.equal((await read()).sourceFeatureId, 'axis'); await expect(handle).toBeEnabled({ timeout: 45000 });
  await dialog().locator('[data-feature-action="discard"]').click();
  results.push('Extrude: native straight-edge picking, shared depth handle, × and repeated-click removal, axis selection, save and editable reopen');
}
