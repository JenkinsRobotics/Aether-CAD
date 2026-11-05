import assert from 'node:assert/strict';
import { join } from 'node:path';

/** Author through visible controls; inspect only the saved canonical result. */
export async function verifySurfaceAdd({ page, expect, dialog, row, open, stored, accept, command, base, evidence, results }) {
  for (const mode of ['automatic', 'explicit', 'bridge']) {
    const doc = base(`Surface Add ${mode}`);
    const sketch = (id, xs, z) => ({ id, type: 'profile', name: id === 'extension' ? 'Extension curves' : `Source ${id}`, suppressed: false,
      plane: 'XY', offsetMillimeters: z, profile: { type: 'drawing', contours: xs.map((x, i) => ({ id: `line-${i}`, type: 'path', start: [x, 0], segments: [{ type: 'line', end: [x+10, 0] }] })) } });
    const sheet = id => ({ id, type: 'surface-extrude', name: `Sheet ${id}`, operation: 'new', suppressed: false, profileFeatureId: `source-${id}`, bodyId: id, distanceMillimeters: 4 });
    doc.features = [sketch('source-a', [0], 0), sheet('a'), sketch('source-b', [mode === 'bridge' ? 0 : 20], mode === 'bridge' ? 8 : 0), sheet('b'),
      sketch('extension', mode === 'bridge' ? [0] : [0, 20], 4)];
    doc.bodyProperties = { a: { name: 'Left sheet', visible: true }, b: { name: 'Right sheet', visible: true } };
    const file = await open(doc);
    await row(/^Extension curves/).click(); await command('Extrude', 'feature-extrude');
    await dialog().getByRole('button', { name: 'Surface', exact: true }).click();
    await dialog().getByRole('button', { name: 'Add', exact: true }).click();
    await dialog().locator('[aria-label="Distance (mm)"]').fill('4');
    if (mode !== 'automatic') {
      await dialog().locator('.aui-feature-row', { hasText: 'Merge with all' }).locator('input[type="checkbox"]').uncheck();
      await expect(dialog().locator('[aria-label="Target body"]')).toHaveValue('b');
      await dialog().getByRole('checkbox', { name: 'Also merge Left sheet', exact: true }).check();
    }
    const groups = () => page.evaluate(() => {
      const scopes = window.__qualificationPreview?.scopeResolutions;
      return scopes ? Object.values(scopes).at(-1)?.groups : null;
    });
    await expect.poll(async () => (await groups())?.length, { timeout: 45000 }).toBe(mode === 'bridge' ? 1 : 2);
    await accept();
    await expect.poll(async () => (await stored(file.id)).features.at(-1).connectedMerge, { timeout: 30000 }).toBe(true);
    const saved = (await stored(file.id)).features.at(-1);
    assert.equal(saved.scopeResolution.groups.length, mode === 'bridge' ? 1 : 2);
    if (mode === 'bridge') assert.deepEqual(saved.scopeResolution.groups, [{ bodyId: 'b', sources: ['b', 'a'] }]);
    else assert.deepEqual(saved.scopeResolution.groups.map(group => group.bodyId).sort(), ['a', 'b']);
    await page.reload(); await row(/^Extrude/).dblclick();
    await expect.poll(async () => (await groups())?.length, { timeout: 45000 }).toBe(mode === 'bridge' ? 1 : 2);
    if (mode === 'automatic') {
      const entities = dialog().locator('[aria-label="Sketch curves to extrude"]');
      await entities.getByRole('button', { name: /^Remove / }).last().click();
      await expect(entities.locator('.aui-feature-entity')).toHaveCount(1);
      await expect.poll(async () => (await groups())?.length, { timeout: 45000 }).toBe(1);
      await accept();
      await expect.poll(async () => (await stored(file.id)).features.at(-1).profileSelections?.length, { timeout: 30000 }).toBe(1);
      assert.equal((await stored(file.id)).features.at(-1).scopeResolution.targets.length, 1);
    } else if (mode === 'explicit') {
      const entities = dialog().locator('[aria-label="Sketch curves to extrude"]');
      await entities.getByRole('button', { name: /^Remove / }).last().click();
      await expect(entities.locator('.aui-feature-entity')).toHaveCount(1);
      await expect(dialog()).toContainText('every surface in its merge scope', { timeout: 45000 });
      await expect(dialog().locator('[data-feature-action="accept"]')).toBeDisabled();
      // The remaining selection must still be removable after the native failure.
      await entities.getByRole('button', { name: /^Remove / }).click();
      await expect(entities.locator('.aui-feature-entity')).toHaveCount(0);
      await dialog().locator('[data-feature-action="discard"]').click();
      assert.deepEqual((await stored(file.id)).features.at(-1), saved);
    } else await dialog().locator('[data-feature-action="discard"]').click();
    await page.screenshot({ path: join(evidence, `surface-add-${mode}.png`) });
    results.push(`Surface Add ${mode}: native grouping, primary identity, visible authoring, saved reopen and selection/error handling`);
  }
}
