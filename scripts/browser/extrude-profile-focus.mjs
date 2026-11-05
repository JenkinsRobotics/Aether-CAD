import assert from 'node:assert/strict';
import { join } from 'node:path';

/** Re-select real profiles while a native stopping-face reference remains set. */
export async function verifyExtrudeProfileFocus({ page, expect, dialog, row, point, evidence, results }) {
  const profiles = dialog().locator('.aui-feature-entities[aria-label="Faces and sketch regions to extrude"]');
  const face = dialog().locator('.aui-feature-entities[aria-label="End face"]');
  const reference = await dialog().locator('input[aria-label="Stopping face"]').inputValue();
  await expect(profiles).toHaveAttribute('data-picking', 'false');
  await profiles.getByRole('button', { name: /^Remove / }).click();
  await expect(profiles.locator('.aui-feature-entity')).toHaveCount(0);
  await expect(profiles).toHaveAttribute('data-picking', 'true');
  await expect(dialog().locator('[data-feature-action="accept"]')).toBeDisabled();
  await row(/^Sketch 1/).click();
  await expect(profiles.locator('.aui-feature-entity')).toHaveCount(1);
  await expect(dialog().locator('[data-feature-action="accept"]')).toBeEnabled({ timeout: 45000 });
  await face.click({ position: { x: 15, y: 10 } });
  await expect(profiles).toHaveAttribute('data-picking', 'false');
  await profiles.focus();
  await expect(profiles).toHaveAttribute('data-picking', 'true');
  await page.evaluate(() => window.__aetherSetView('bottom'));
  // The center of this profile is covered by the Draft ring/readout. Use an
  // exposed interior point and verify that the mouse reaches the viewport.
  let at;
  for (const p of [[4, 3, 0], [16, 7, 0], [5, 8, 0]]) {
    const candidate = await point(p);
    if (candidate && await page.evaluate(p => document.elementFromPoint(...p)?.matches('canvas.viewport-canvas'), candidate)) {
      at = candidate; break;
    }
  }
  assert.ok(at, 'An interior profile point must be exposed outside the feature window and handles');
  await page.mouse.click(...at);
  await expect(profiles.locator('.aui-feature-entity')).toHaveCount(0);
  await page.mouse.click(...at);
  await expect(profiles.locator('.aui-feature-entity')).toHaveCount(1);
  await expect(dialog().locator('[data-feature-action="accept"]')).toBeEnabled({ timeout: 45000 });
  assert.equal(await dialog().locator('input[aria-label="Stopping face"]').inputValue(), reference);
  await face.getByRole('button', { name: /^Remove / }).click();
  await expect(face.locator('.aui-feature-entity')).toHaveCount(0);
  const stop = await point([-3, 0, 10]);
  assert.ok(stop);
  assert.equal(await page.evaluate(p => document.elementFromPoint(...p)?.matches('canvas.viewport-canvas'), stop), true);
  await page.mouse.click(...stop);
  await expect(face.locator('.aui-feature-entity')).toHaveCount(1);
  await expect(dialog().locator('[data-feature-action="accept"]')).toBeEnabled({ timeout: 45000 });
  const chosen = JSON.parse(await dialog().locator('input[aria-label="Stopping face"]').inputValue());
  assert.equal(chosen.bodyId, 'limitBody');
  assert.deepEqual(chosen.normal, [0, 0, -1]);
  await page.evaluate(() => window.__aetherSetView('isometric'));
  await page.screenshot({ path: join(evidence, 'extrude-profile-and-stop-focus.png') });
  results.push('Extrude: stopping-face and profile focus, × removal, tree re-selection, viewport toggling and native stopping-face re-selection');
}
