import assert from 'node:assert/strict';
import { join } from 'node:path';

export async function verifyExtrudeFaceAxis({ page, expect, dialog, row, point, open, stored, accept, base, sketch, evidence, results }) {
  const moveDialog = async () => {
    const bounds = await dialog().boundingBox();
    await page.mouse.move(bounds.x + 75, bounds.y + 16); await page.mouse.down();
    await page.mouse.move(350, 132, { steps: 8 }); await page.mouse.up();
  };
  for (const surface of ['cylinder', 'cone']) {
    const doc = base(`${surface} direction`);
    doc.features = [{ id: 'guide-profile', type: 'profile', name: 'Guide sketch', suppressed: false, plane: 'XY', offsetMillimeters: 0,
      frame: { originMillimeters: [30, 0, 0], normal: [.6, 0, .8], xDirection: [.8, 0, -.6] },
      profile: { type: 'circle', radiusMillimeters: 5, centerMillimeters: [0, 0] } },
    { id: 'guide', type: 'extrude', name: 'Guide', suppressed: false, profileFeatureId: 'guide-profile', bodyId: 'guide-body',
      operation: 'new', distanceMillimeters: 10, ...(surface === 'cone' ? { draftAngleDegrees: 5 } : {}) },
    { ...sketch('s', 'XY', [[0, 0], [20, 0], [20, 10], [0, 10]]), name: 'Outline' },
    { id: 'e', type: 'extrude', name: 'Directed extrude', suppressed: false, profileFeatureId: 's', profileContourId: 'outline',
      operation: 'new', distanceMillimeters: 10, bodyId: 'body' }];
    const file = await open(doc);
    await row(/^Directed extrude/).dblclick();
    await moveDialog();
    await dialog().getByRole('checkbox', { name: 'Direction', exact: true }).check();
    const box = dialog().locator('.aui-feature-entities[aria-label="Extrusion axis or edge"]');
    await expect(box).toHaveAttribute('data-picking', 'true');
    const radius = surface === 'cone' ? 5 - 5 * Math.tan(5 * Math.PI / 180) : 5;
    let facePoint, at;
    // Use a visible mid-height station away from the cylinder's seam and rims.
    await expect.poll(async () => {
      for (const angle of [.7, 1.4, 2.1, 2.8, 3.5, 4.2, 4.9, 5.6]) {
        const world = [33 + .8 * radius * Math.cos(angle), radius * Math.sin(angle), 4 - .6 * radius * Math.cos(angle)];
        const screen = await point(world); if (!screen) continue;
        if (!await page.evaluate(p => document.elementFromPoint(...p)?.matches('canvas.viewport-canvas'), screen)) continue;
        await page.mouse.move(...screen);
        if ((await page.evaluate(() => window.__aetherHover?.()))?.kind === 'face') { facePoint = world; at = screen; return true; }
      }
      return false;
    }, { timeout: 15000 }).toBe(true);
    await page.mouse.click(...at);
    await expect(box.locator('.aui-feature-entity')).toHaveCount(1);
    const read = async () => JSON.parse(await dialog().locator('[aria-label="Direction native reference"]').inputValue());
    assert.equal((await read()).kind, 'face-axis'); assert.equal((await read()).surfaceType, surface);
    assert.equal((await read()).faceAnchor, undefined, 'A unique surface follows its source edits');
    const handle = page.getByRole('button', { name: 'Pull extrusion depth', exact: true });
    await expect(handle).toBeEnabled({ timeout: 45000 });
    await expect.poll(() => page.evaluate(() => {
      const direction = window.__qualificationPreview?.featurePreview?.extrusionAxes?.find(a => a.side === 'primary')?.direction;
      return direction ? Math.hypot(...direction.map((v, i) => v - [.6, 0, .8][i])) : Infinity;
    })).toBeLessThan(1e-9);
    await handle.press('ArrowUp');
    await expect(dialog().locator('[aria-label="Distance (mm)"]')).toHaveValue('11');
    await page.screenshot({ path: join(evidence, `extrude-${surface}-axis.png`) });
    await accept();
    await expect.poll(async () => (await stored(file.id)).features.at(-1).directionReference?.kind, { timeout: 30000 }).toBe('face-axis');
    await page.reload(); await row(/^Directed extrude/).dblclick(); await moveDialog();
    await expect(handle).toBeEnabled({ timeout: 45000 });
    assert.equal((await read()).surfaceType, surface);
    await box.getByRole('button', { name: /^Remove / }).click();
    await expect(box.locator('.aui-feature-entity')).toHaveCount(0);
    await expect(dialog().locator('[data-feature-action="accept"]')).toBeDisabled();
    const again = await point(facePoint);
    assert.equal(await page.evaluate(p => document.elementFromPoint(...p)?.matches('canvas.viewport-canvas'), again), true);
    await page.mouse.click(...again); await expect(box.locator('.aui-feature-entity')).toHaveCount(1);
    await page.mouse.click(...again); await expect(box.locator('.aui-feature-entity')).toHaveCount(0);
    await dialog().locator('[data-feature-action="discard"]').click();
    assert.equal((await stored(file.id)).features.at(-1).directionReference.surfaceType, surface);
    results.push(`Extrude ${surface} axis: actual face picking, shared depth handle, native direction, archive reopen, × and repeat-click removal, Cancel`);
  }
}
