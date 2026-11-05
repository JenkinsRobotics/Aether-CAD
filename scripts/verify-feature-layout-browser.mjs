/** Inspect the shipped, live editor gallery without touching Studio documents. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const { chromium, webkit, expect } = createRequire(process.env.AETHER_PLAYWRIGHT_PACKAGE ||
  new URL('../../AetherStudio/core/files/package.json', import.meta.url).pathname)('@playwright/test');
const origin = process.env.AETHER_LAYOUT_ORIGIN || 'http://127.0.0.1:5192';
assert.equal(new URL(origin).hostname, '127.0.0.1');
assert.notEqual(new URL(origin).port, '8780');
const browserName = process.env.AETHER_GATE_BROWSER || 'chromium';
const output = process.env.AETHER_FRONTEND_EVIDENCE || `build/feature-layout-2026-11-05/${browserName}`;
await mkdir(output, { recursive: true });
const browser = await (browserName === 'webkit' ? webkit : chromium).launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const labels = ['Extrude', 'Revolve', 'Sweep', 'Loft', 'Thicken', 'Fillet', 'Chamfer',
  'Draft', 'Rib', 'Shell', 'Hole', 'Thread', 'Pattern', 'Mirror', 'Boolean', 'Split', 'Enclose'];
const card = label => page.locator(`section[aria-label="${label} editor"]`).first();
const field = (label, name) => card(label).locator(`input[name^="${name}"]`).first();
try {
  await page.goto(`${origin}/gallery/index.html`);
  await expect(card('Extrude').locator('.aui-feature-window')).toBeVisible();
  const windows = [];
  for (const label of labels) {
    const window = card(label).locator('.aui-feature-window');
    await expect(window).toBeVisible();
    await expect(window.locator('.aui-float-panel-header [data-feature-action="accept"]')).toHaveCount(1);
    await expect(window.locator('.aui-float-panel-header [data-feature-action="discard"]')).toHaveCount(1);
    await expect(window.getByRole('button', { name: 'Help', exact: true })).toBeVisible();
    const rows = await window.locator('.aui-feature-row, .aui-feature-entities, .aui-feature-subsection-header')
      .evaluateAll(nodes => nodes.filter(node => !node.closest('[hidden]')).map(node => node.textContent.trim()));
    windows.push({ label, rows });
    await card(label).screenshot({ path: join(output, `${label.toLowerCase()}.png`) });
  }
  await expect(field('Thicken', 'Thickness 2')).toBeVisible();
  // Sweep owns these controls in conditional sections, never empty legacy rows.
  await expect(field('Sweep', 'Thickness 1')).toBeHidden();
  await card('Sweep').getByRole('checkbox', { name: 'Twist', exact: true }).check();
  await expect(field('Sweep', 'Turns')).toBeVisible();
  await card('Sweep').getByRole('checkbox', { name: 'Twist', exact: true }).uncheck();
  const orphanRows = await card('Sweep').locator('.aui-feature-row').evaluateAll(rows =>
    rows.filter(row => !row.closest('[hidden]') && !row.querySelector('input, select, button, textarea, [role="combobox"]')).map(row => row.textContent));
  assert.deepEqual(orphanRows, []);
  await expect(card('Thicken').getByRole('button', { name: 'Solid', exact: true })).toHaveCount(0);
  await card('Thicken').getByRole('checkbox', { name: 'Mid plane', exact: true }).check();
  await expect(field('Thicken', 'Thickness 2')).toBeHidden();
  await card('Thicken').getByRole('checkbox', { name: 'Mid plane', exact: true }).uncheck();
  await expect(field('Thicken', 'Thickness 2')).toBeVisible();

  await expect(field('Pattern', 'Distance')).toBeVisible();
  await expect(field('Pattern', 'Instance count')).toBeVisible();
  await card('Pattern').getByRole('button', { name: 'Circular', exact: true }).click();
  await expect(field('Pattern', 'Angle')).toBeVisible();
  await expect(field('Pattern', 'Distance')).toBeHidden();
  await card('Pattern').getByRole('button', { name: 'Curve', exact: true }).click();
  await expect(card('Pattern').getByRole('checkbox', { name: 'Centered', exact: true })).toBeHidden();
  await expect(field('Pattern', 'Instance count')).toBeVisible();
  await card('Pattern').screenshot({ path: join(output, 'curve-pattern.png') });

  const end = card('Loft').getByRole('button', { name: /End conditions/ });
  await expect(card('Loft').locator('select[aria-label="Start profile condition"]')).toBeVisible();
  await end.click();
  await expect(card('Loft').locator('select[aria-label="Start profile condition"]')).toBeHidden();
  await end.click();
  await card('Loft').locator('.aui-feature-entities').filter({ hasText: /^Profiles$/ }).click();
  await expect(card('Loft').getByRole('button', { name: 'Add section', exact: true })).toBeVisible();
  await card('Loft').getByRole('button', { name: 'Add section', exact: true }).click();
  await expect(card('Loft').locator('select[aria-label="Loft section order"]')).toBeVisible();
  await card('Loft').getByRole('button', { name: 'Remove section', exact: true }).click();
  await expect(card('Loft').locator('select[aria-label="Loft section order"]')).toBeHidden();
  await expect(card('Rib').getByRole('checkbox', { name: 'Draft', exact: true })).toBeDisabled();
  await expect(card('Split').getByRole('button', { name: 'Part', exact: true })).toBeVisible();
  await expect(card('Split').getByRole('button', { name: 'Face', exact: true })).toBeVisible();

  // Both shared window variants keep the same live feature content.
  await page.getByRole('button', { name: 'Compact', exact: true }).click();
  for (const label of labels) await expect(card(label).locator('.aui-feature-window--compact')).toBeVisible();
  await expect(field('Thicken', 'Thickness 2')).toBeVisible();
  await expect(field('Pattern', 'Instance count')).toBeVisible();
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'results.json'), JSON.stringify({ passed: true, browser: browserName,
    windows, variants: ['standard', 'compact'], errors }, null, 2));
  console.log(`${browserName}: ${labels.length} live reference layouts, both variants and conditional controls passed`);
} catch (error) {
  await page.screenshot({ path: join(output, 'failure.png') });
  throw error;
} finally { await browser.close(); }
