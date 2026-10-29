/** Browser contract for the unified toolbar on a real, open CAD document. */
export async function verifyIntegratedToolbar(page, expect, screenshot) {
  const toolbar = page.locator('.cad-traditional-ribbon [data-variant="integrated"]');
  await expect(toolbar).toHaveCount(1);
  await expect(page.locator('.cad-traditional-ribbon .aui-studio-toolbar')).toHaveCount(0);
  await expect(page.getByRole('button', {name:'Workspace: Design',exact:true})).toHaveCount(1);
  const search = toolbar.getByRole('combobox', {name:'Search commands, tools, or help',exact:true});
  await search.click();
  await expect(page.locator('.aui-command-palette')).toHaveCount(0);
  await expect(page.getByRole('listbox', {name:'Matching commands'})).toHaveCount(0);
  await search.fill('Wireframe');
  await page.getByRole('option', {name:/Wireframe/}).click();
  await expect(toolbar.getByRole('button', {name:'Display style',exact:true}).locator('[data-icon="cube-transparent"]')).toHaveCount(1);
  await search.fill('Shaded');
  await search.press('Enter');
  await expect(toolbar.getByRole('button', {name:'Display style',exact:true}).locator('[data-icon="display"]')).toHaveCount(1);
  await expect(page.locator('.aui-command-palette')).toHaveCount(0);
  await toolbar.getByRole('tab', {name:'Surface',exact:true}).click();
  await expect(toolbar.getByRole('button', {name:'Create tools',exact:true})).toBeVisible();
  await toolbar.getByRole('tab', {name:'Solid',exact:true}).click();
  await toolbar.getByRole('button', {name:'Display style',exact:true}).click();
  await page.getByRole('menuitemradio', {name:'Wireframe',exact:true}).click();
  await expect(toolbar.getByRole('button', {name:'Display style',exact:true}).locator('[data-icon="cube-transparent"]')).toHaveCount(1);
  await toolbar.getByRole('button', {name:'Display style',exact:true}).click();
  await page.getByRole('menuitemradio', {name:'Shaded',exact:true}).click();
  await toolbar.getByRole('button', {name:'Grid and construction planes',exact:true}).click();
  await expect(page.getByRole('menuitemradio', {name:'Grid',exact:true})).toBeEnabled();
  await page.keyboard.press('Escape');
  await toolbar.getByRole('button', {name:'Camera views',exact:true}).click();
  await page.getByRole('menuitemradio', {name:'Orthographic',exact:true}).click();
  await toolbar.getByRole('button', {name:'Camera views',exact:true}).click();
  await expect(page.getByRole('menuitemradio', {name:'Orthographic',exact:true})).toHaveAttribute('aria-checked','true');
  await page.getByRole('menuitemradio', {name:'Perspective',exact:true}).click();
  await toolbar.getByRole('button', {name:'Selection filters',exact:true}).click();
  const filter = page.getByRole('dialog', {name:'Selection filters',exact:true});
  await filter.getByLabel('Selection filter',{exact:true}).selectOption('face');
  await expect(filter.getByLabel('Selection filter',{exact:true})).toHaveValue('face');
  await filter.getByLabel('Selection filter',{exact:true}).selectOption('auto');
  await page.keyboard.press('Escape');
  await toolbar.getByRole('button',{name:'Tool bar options',exact:true}).click();
  await expect(page.getByRole('menuitem',{name:'Settings…',exact:true})).toBeVisible();
  await expect(page.getByRole('menuitem',{name:'Panel visibility and layout…',exact:true})).toBeVisible();
  await page.getByRole('menuitemradio',{name:'Standard',exact:true}).click();
  await expect(toolbar.locator('[data-icon-missing]')).toHaveCount(0);
  await page.screenshot({path:screenshot});
  const wide = page.viewportSize();
  await page.setViewportSize({width:1100,height:900});
  const within = await toolbar.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return [...element.querySelectorAll('.aui-integrated-toolbar-header button')].every(button => {
      const rect = button.getBoundingClientRect();
      return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1;
    });
  });
  expect(within).toBe(true);
  await page.setViewportSize(wide);
}
