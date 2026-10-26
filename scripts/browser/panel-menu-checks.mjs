/** Shared assertions for panel context menus in disposable browser fixtures. */
import assert from 'node:assert/strict';

export async function menuSnapshot(page) {
  const labels = await page.locator('[role="menu"] .aui-menu-label').allTextContents();
  assert.ok(labels.length, 'Panel menu has applicable actions');
  assert.ok(!labels.some(label => /^(Undo|Redo)(\b|$)|Aether .* settings/i.test(label)), labels.join(', '));
  return labels;
}

export async function matchingRowMenus(page, row, ellipsis) {
  await row.click({button:'right'});
  const context = await menuSnapshot(page);
  await page.keyboard.press('Escape');
  await ellipsis.click();
  assert.deepEqual(await menuSnapshot(page), context, 'Right-click and row ellipsis use identical commands');
  await page.keyboard.press('Escape');
}

export async function nativeTextMenu(page, field) {
  await field.click({button:'right'});
  assert.equal(await page.getByRole('menu').count(), 0, 'Text field keeps its native menu');
  assert.equal(await field.evaluate(element => {
    const event = new MouseEvent('contextmenu',{bubbles:true,cancelable:true});
    element.dispatchEvent(event);
    return event.defaultPrevented;
  }), false, 'Native text context event is not canceled');
  await page.keyboard.press('Escape');
}
