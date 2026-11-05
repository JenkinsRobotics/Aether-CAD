import assert from 'node:assert/strict';

/** Whole-sketch handoff must stop acting as selection intent after manual edits. */
export async function verifyExtrudeModeRemoval({ page, expect, dialog, row, results }) {
  const entities = () => dialog().locator('.aui-feature-entities').first();
  const selected = () => dialog().locator('[aria-label="Selected profiles"]').inputValue().then(JSON.parse);
  const switchTo = async (mode, count) => {
    await dialog().getByRole('button', { name: mode, exact: true }).click();
    await expect(entities().locator('.aui-feature-entity')).toHaveCount(count);
    if (!count) await expect(dialog().locator('[data-feature-action="accept"]')).toBeDisabled();
  };
  await entities().getByRole('button', { name: /^Remove / }).first().click();
  for (const mode of ['Thin', 'Solid', 'Surface']) {
    await switchTo(mode, mode === 'Solid' ? 0 : 1);
    if (mode !== 'Solid') assert.deepEqual(await selected(), [{ featureId: 'whole', contourIndex: 1 }]);
  }
  await expect(dialog().locator('[data-feature-action="accept"]')).toBeEnabled({ timeout: 45000 });
  await entities().getByRole('button', { name: /^Remove / }).click();
  for (const mode of ['Thin', 'Solid', 'Surface']) await switchTo(mode, 0);
  // A fresh, explicit tree selection is allowed to select the whole sketch.
  await row(/^Two open curves/).click({ modifiers: ['ControlOrMeta'] });
  await row(/^Two open curves/).click();
  await expect(entities().locator('.aui-feature-entity')).toHaveCount(2);
  await expect(dialog().locator('[data-feature-action="accept"]')).toBeEnabled({ timeout: 45000 });
  results.push('Extrude modes: removed curves stay removed, empty remains empty, temporary Solid incompatibility preserves remaining open curves, explicit whole-sketch reselection works');
}

/** Connected sketch regions are not interchangeable with their first curve. */
export async function verifyConnectedProfileModes({ page, expect, dialog, row, open, stored, accept, command, base, results }) {
  const doc = base('Connected extrusion mode changes');
  const points = [[0, 0], [20, 0], [20, 10], [0, 10]];
  doc.features = [{ id: 'joined', type: 'profile', name: 'Four connected lines', plane: 'XY', offsetMillimeters: 0, suppressed: false,
    profile: { type: 'drawing', contours: points.map((start, i) => ({ id: `side-${i}`, type: 'path', start,
      segments: [{ id: `span-${i}`, type: 'line', end: points[(i + 1) % points.length] }] })) } }];
  const file = await open(doc);
  await command('Extrude', 'feature-extrude');
  await row(/^Four connected lines/).click();
  const entities = () => dialog().locator('.aui-feature-entities').first();
  await expect(entities().locator('.aui-feature-entity')).toHaveCount(1);
  for (const mode of ['Surface', 'Solid', 'Thin', 'Solid']) {
    await dialog().getByRole('button', { name: mode, exact: true }).click();
    await expect(entities().locator('.aui-feature-entity')).toHaveCount(mode === 'Solid' ? 1 : 4);
    await expect(dialog().locator('[data-feature-action="accept"]')).toBeEnabled({ timeout: 45000 });
  }
  await accept();
  await expect.poll(async () => (await stored(file.id)).features.at(-1).profileSelections?.[0]?.profileRegion?.contourIds?.length, { timeout: 30000 }).toBe(4);
  await page.reload(); await row(/^Extrude/).dblclick();
  await dialog().getByRole('button', { name: 'Surface', exact: true }).click();
  await expect(entities().locator('.aui-feature-entity')).toHaveCount(4);
  await entities().getByRole('button', { name: /^Remove / }).first().click();
  await dialog().getByRole('button', { name: 'Solid', exact: true }).click();
  await expect(entities().locator('.aui-feature-entity')).toHaveCount(0);
  await expect(dialog().locator('[data-feature-action="accept"]')).toBeDisabled();
  await dialog().getByRole('button', { name: 'Surface', exact: true }).click();
  await expect(entities().locator('.aui-feature-entity')).toHaveCount(3);
  await accept();
  await expect.poll(async () => (await stored(file.id)).features.at(-1).type, { timeout: 30000 }).toBe('surface-extrude');
  assert.deepEqual((await stored(file.id)).features.at(-1).profileSelections.map(p => p.profileContourId), ['side-1', 'side-2', 'side-3']);
  await page.reload(); await row(/^Extrude/).dblclick();
  await expect(entities().locator('.aui-feature-entity')).toHaveCount(3);
  await expect(dialog().locator('[data-feature-action="accept"]')).toBeEnabled({ timeout: 45000 });
  await dialog().locator('[data-feature-action="discard"]').click();
  results.push('Connected profiles: one face converts to four native boundary curves, Solid/Surface/Thin preview, saved history mode edit, incomplete boundary refusal and saved reopen');
}
