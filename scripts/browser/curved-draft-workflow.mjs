import assert from 'node:assert/strict';
import { join } from 'node:path';

/** Existing UI and shared manipulators author real curved native draft. */
export async function verifyCurvedDraft({ page, expect, dialog, row, open, stored, accept, base, evidence, results }) {
  for (const thin of [false, true]) {
    const doc = base(`Curved angled ${thin ? 'Thin' : 'Solid'} draft`);
    doc.features = [{ id: 's', type: 'profile', name: 'Circle sketch', plane: 'XY', offsetMillimeters: 0, suppressed: false,
      profile: { type: 'drawing', contours: [{ id: 'circle', type: 'circle', center: [0, 0], radius: 10 }] } }, {
      id: 'e', type: 'extrude', name: 'Extrude 1', suppressed: false, profileFeatureId: 's', profileContourId: 'circle',
      operation: 'new', distanceMillimeters: 10, directionVector: [.6, 0, .8], startingOffsetMillimeters: 2,
      draftAngleDegrees: 3, ...(thin ? { thin: { thickness1Millimeters: 2, thickness2Millimeters: 1 } } : {}),
    }];
    const file = await open(doc);
    await page.evaluate(() => window.__aetherSetView?.('isometric'));
    await row(/^Extrude 1/).dblclick();
    const ring = page.getByRole('button', { name: 'Draft angle', exact: true });
    await expect(ring).toHaveAttribute('aria-disabled', 'false', { timeout: 45000 });
    await ring.press('ArrowUp');
    await expect(dialog().locator('[aria-label^="Draft angle ("]')).toHaveValue('4');
    if (thin) {
      const wall = page.getByRole('button', { name: 'Wall thickness 1', exact: true });
      await expect(wall).toBeEnabled({ timeout: 45000 });
      await wall.press('ArrowUp');
      await expect(dialog().locator('[aria-label="Thickness 1 (mm)"]')).toHaveValue('3');
    }
    // Independent tangent-support extreme at the actual shifted end section.
    const sine = Math.sin(4 * Math.PI / 180);
    const expectedY = -(thin ? 13 : 10) + 9.6 * sine / Math.sqrt(.8 ** 2 - sine ** 2);
    await expect.poll(() => page.evaluate(expectedY => {
      const model = window.__qualificationPreview;
      if (!model) return Infinity;
      let minimum = Infinity;
      for (const part of model.featurePreview?.added ?? []) for (let i = 0; i < part.vertices.length; i += 3)
        if (Math.abs(part.vertices[i + 2] - 9.6) < 1e-4) minimum = Math.min(minimum, part.vertices[i + 1]);
      return Math.abs(minimum - expectedY);
    }, expectedY), { timeout: 45000 }).toBeLessThan(.02);
    await page.screenshot({ path: join(evidence, `extrude-curved-draft-${thin ? 'thin' : 'solid'}.png`) });
    await accept();
    await expect.poll(async () => (await stored(file.id)).features.at(-1).draftAngleDegrees, { timeout: 30000 }).toBe(4);
    const saved = (await stored(file.id)).features.at(-1);
    assert.deepEqual(saved.directionVector, [.6, 0, .8]);
    if (thin) assert.equal(saved.thin.thickness1Millimeters, 3);
    await page.reload(); await row(/^Extrude 1/).dblclick();
    await expect(ring).toHaveAttribute('aria-disabled', 'false', { timeout: 45000 });
    const angle = dialog().locator('[aria-label^="Draft angle ("]');
    await angle.fill('80'); await angle.press('Tab');
    await expect(dialog().locator('[data-feature-action="accept"]')).toBeDisabled({ timeout: 45000 });
    const entities = dialog().locator('.aui-feature-entities').first();
    await expect(entities.locator('.aui-feature-entity')).toHaveCount(1);
    await entities.getByRole('button', { name: /^Remove / }).click();
    await expect(entities.locator('.aui-feature-entity')).toHaveCount(0);
    await dialog().locator('[data-feature-action="discard"]').click();
    assert.deepEqual((await stored(file.id)).features.at(-1), saved);
    results.push(`Curved ${thin ? 'Thin' : 'Solid'} Draft: shared angle/thickness controls, native cap extent, saved reopen, failed preview removal and Cancel`);
  }
}
