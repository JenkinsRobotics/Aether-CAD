/** Browser contract for the shared tool bar on a real, open CAD document:
 *  header search and view controls, and the Commands toggle that docks the
 *  ribbon on top or floats it at the bottom. */
export async function verifyToolbarPlacement(page, expect, screenshot) {
  const ribbon = page.locator('.cad-traditional-ribbon .aui-workspace-ribbon');
  const header = page.locator('.cad-header-controls');
  const placement = async mode => {
    await page.locator('.cad-traditional-ribbon .aui-workspace-ribbon-overflow').click();
    await page.getByRole('menuitem', {name:'Panel visibility and layout…',exact:true}).click();
    await page.getByLabel('Commands presentation',{exact:true}).selectOption(mode);
    await page.keyboard.press('Escape');
  };
  await expect(ribbon).toHaveCount(1);
  await expect(page.getByRole('button', {name:'Workspace: Design',exact:true})).toHaveCount(1);
  const search = page.getByRole('combobox', {name:'Search CAD commands',exact:true});
  await search.fill('Wireframe');
  await page.getByRole('option', {name:/Wireframe/}).click();
  // Display style lives in the viewport's environment control since the header pins rework (alpha-0.1.93).
  await page.getByRole('button', {name:'Environment',exact:true}).click();
  const display = page.getByRole('button', {name:'Display and environment',exact:true});
  await display.click();
  await expect(page.getByRole('menuitemradio', {name:'Wireframe',exact:true})).toHaveAttribute('aria-checked','true');
  await page.getByRole('menuitemradio', {name:'Shaded',exact:true}).click();
  await display.click();
  await expect(page.getByRole('menuitemradio', {name:'Shaded',exact:true})).toHaveAttribute('aria-checked','true');
  await page.keyboard.press('Escape');
  // The view cube control states the projection; switching it is a camera command, not a header button.
  await expect(page.locator('.aui-studio-camera-projection')).toHaveText(/Perspective|Orthographic/);
  await expect(header.getByRole('button', {name:'Undo',exact:true})).toHaveCount(1);

  for (const [mode, variant] of [['traditional', 'docked'], ['floating', 'floating']]) {
    await placement(mode);
    await expect(ribbon).toHaveAttribute('data-variant', variant);
    const box = await ribbon.boundingBox(), view = page.viewportSize();
    // Docked spans the window under the 56px header; floating sits in the lower half.
    if (variant === 'docked') { expect(box.y).toBeLessThan(80); expect(box.width).toBeGreaterThan(view.width - 4); }
    else expect(box.y).toBeGreaterThan(view.height / 2);
    await ribbon.getByRole('tab', {name:'Surface',exact:true}).click();
    await expect(ribbon.getByRole('button', {name:'Create tools',exact:true})).toBeVisible();
    await ribbon.getByRole('tab', {name:'Solid',exact:true}).click();
    await expect(ribbon.locator('[data-icon-missing]')).toHaveCount(0);
    await page.screenshot({path: screenshot.replace(/\.png$/, `-${variant}.png`)});
  }
  // Narrow windows move the groups that do not fit into the overflow menu.
  const wide = page.viewportSize();
  await page.setViewportSize({width:900,height:wide.height});
  await expect(page.locator('.cad-traditional-ribbon .aui-workspace-ribbon-group[data-overflowed]').first()).toBeAttached();
  await page.locator('.cad-traditional-ribbon .aui-workspace-ribbon-overflow').click();
  await expect(page.getByRole('menuitem', {name:'Settings…',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
  await page.setViewportSize(wide);
}
