import assert from 'node:assert/strict';
import { join } from 'node:path';

/** Exercise the built widgets, real cap picks, and visible annotations on the known 10×20×5 part. */
export async function verifyInspectionParity({page,expect,button,project,evidence}) {
  const section=page.locator('.cad-section-window'),measure=page.locator('.cad-measure-window');
  const choose=async(label,value)=>{
    const field=measure.getByRole('button',{name:label,exact:true});
    if(!await field.isVisible())await measure.getByRole('button',{name:'Measurement display settings',exact:true}).click();
    await field.click();await page.getByRole('option',{name:new RegExp(value+'$')}).click();
  };
  const offset=()=>section.getByRole('textbox',{name:'Section offset',exact:true});
  const add=async(name)=>{await section.getByRole('button',{name:'Add section plane',exact:true}).click();await page.getByRole('menuitem',{name:`${name} plane`,exact:true}).click();};
  const move=async()=>{
    const header=await measure.locator('.aui-float-panel-header').boundingBox();
    await page.mouse.move(header.x+80,header.y+20);await page.mouse.down();await page.mouse.move(1350,header.y+20,{steps:8});await page.mouse.up();
  };
  await page.evaluate(()=>{document.documentElement.classList.remove('aether-light-theme');document.documentElement.dataset.aetherTheme='dark';document.querySelectorAll('.aether-theme-model-studio').forEach(node=>node.classList.remove('aether-light-theme'));});
  await button('Section view').click();await add('Right');await offset().fill('5');
  const pivot=page.getByRole('button',{name:'Move section origin; snap to geometry',exact:true});
  const centerBefore=await pivot.boundingBox();
  await section.getByRole('textbox',{name:'Section rotation X',exact:true}).fill('20');
  await page.waitForTimeout(100);
  const centerAfter=await pivot.boundingBox();
  assert.ok(Math.hypot(centerAfter.x-centerBefore.x,centerAfter.y-centerBefore.y)<2,'rotation retains the displayed pivot after offset');
  const ring=page.getByRole('button',{name:'Rotate section Y',exact:true});
  await ring.press('ArrowRight');await expect(section.getByRole('textbox',{name:'Section rotation Y',exact:true})).toHaveValue('1.00');
  // Drag on the dashed orbit itself, away from the arrow. Projected geometry,
  // pointer hit testing and the angle field must agree, with no pivot drift.
  const orbitPoints=async()=>ring.evaluate(node=>{
    const box=node.ownerSVGElement.getBoundingClientRect();
    return Array.from(node.points,p=>({x:p.x+box.left,y:p.y+box.top}));
  });
  const dragOrbit=async(cancel)=>{
    const points=await orbitPoints(),before=await pivot.boundingBox();
    await page.mouse.move(points[8].x,points[8].y);await page.mouse.down();
    for(let i=9;i<=16;i++)await page.mouse.move(points[i].x,points[i].y);
    await expect(section.getByRole('textbox',{name:'Section rotation Y',exact:true})).toHaveValue('46.00');
    const after=await pivot.boundingBox();assert.ok(Math.hypot(after.x-before.x,after.y-before.y)<2,'orbit rotation retains pivot');
    if(cancel){await page.keyboard.press('Escape');await expect(section.getByRole('textbox',{name:'Section rotation Y',exact:true})).toHaveValue('1.00');}
    await page.mouse.up();
  };
  await dragOrbit(true);await dragOrbit(false);
  await page.mouse.move(1300,300);await page.screenshot({path:join(evidence,'section-orbit-drag.png')});
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('aether-section-normal',{detail:{normal:[1,-1,1]}})));
  const otherRing=page.getByRole('button',{name:'Rotate section X',exact:true});
  await expect(otherRing).toBeVisible();
  const oblique=await otherRing.evaluate(node=>{
    const box=node.ownerSVGElement.getBoundingClientRect(),points=Array.from(node.points,p=>({x:p.x+box.left,y:p.y+box.top}));
    const start=points.findIndex((p,i)=>i<55&&document.elementFromPoint(p.x,p.y)===node);
    return points.slice(start,start+5);
  });
  assert.equal(oblique.length,5,'the foreshortened X orbit is directly reachable');
  await page.mouse.move(oblique[0].x,oblique[0].y);await page.mouse.down();
  for(const p of oblique.slice(1))await page.mouse.move(p.x,p.y);
  await page.mouse.up();
  await expect(section.getByRole('textbox',{name:'Section rotation X',exact:true})).toHaveValue('42.50');
  await page.mouse.move(1300,300);await page.screenshot({path:join(evidence,'section-orbits-oblique.png')});
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('aether-section-normal',{detail:{normal:[0,0,1]}})));
  await section.getByRole('textbox',{name:'Section rotation X',exact:true}).fill('0');
  await section.getByRole('textbox',{name:'Section rotation Y',exact:true}).fill('0');
  const arrow=page.getByRole('button',{name:'Move section in positive normal direction',exact:true});
  const box=await arrow.boundingBox(),a=await project([5,10,2.5]),b=await project([6,10,2.5]),size=Math.hypot(b.x-a.x,b.y-a.y);
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
  await page.mouse.move(box.x+box.width/2+(b.x-a.x)/size*35,box.y+box.height/2+(b.y-a.y)/size*35,{steps:5});await page.mouse.up();
  await expect.poll(async()=>Number(await offset().inputValue())).not.toBe(5);
  await offset().fill('5');
  await section.getByRole('checkbox',{name:'Show plane',exact:true}).uncheck();
  await section.getByRole('button',{name:'View normal',exact:true}).click();
  await page.mouse.move(1000,600);await page.mouse.wheel(0,500);await page.waitForTimeout(500);
  await button('Measure').click();await move();await choose('Measurement mode','Objects');await measure.getByRole('button',{name:'Clear selection',exact:true}).click();await choose('Measure selection','Faces');
  const cap=await project([5,3,3]);await page.mouse.click(cap.x,cap.y);
  await expect(measure).toContainText('Section face');
  const area=measure.locator('[data-measure-value$=": Area"]');
  await expect(area).toHaveText(/≈ 100\.0+ mm²/);
  await expect(measure.locator('[data-measure-value$=": Perimeter"]')).toHaveText(/≈ 50\.0+ mm/);
  await add('Top');await offset().fill('2');
  await expect(section.locator('.aui-feature-entity-select')).toHaveCount(2);
  await expect(area).toHaveText(/≈ 40\.0+ mm²/);
  await measure.locator('.aui-float-panel-header').click({position:{x:80,y:20}});
  await page.screenshot({path:join(evidence,'measure-section-cap-live.png')});
  await section.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(measure).toBeVisible();await expect(area).toHaveCount(0);
  await measure.getByRole('button',{name:'Clear selection',exact:true}).click();await choose('Measure selection','Bodies');
  const body=await project([10,5,3]);await page.mouse.click(body.x,body.y);
  await expect(measure.locator('[data-measure-value$=": Volume"]')).toHaveText(/1000\.0+ mm³/,{timeout:60000});
  await choose('Measurement precision','2 decimals');
  await expect(measure.locator('[data-measure-value$=": Volume"]')).toHaveText('1000.00 mm³');
  await page.context().grantPermissions(['clipboard-read','clipboard-write']);
  await measure.getByRole('button',{name:/^Copy .*: Volume$/}).click();
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'1000 mm³');
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('aether-section-normal',{detail:{normal:[0,0,1]}})));
  await button('Fit view').click();await page.mouse.move(1000,600);await page.mouse.wheel(0,650);await page.waitForTimeout(500);
  await choose('Measurement mode','Point-to-point');
  for(const point of [[0,0,5],[10,20,5]]) {
    const at=await project(point),center=await project([5,10,5]),distance=Math.hypot(at.x-center.x,at.y-center.y);
    await page.mouse.move(at.x+(at.x-center.x)/distance*5,at.y+(at.y-center.y)/distance*5);
    await expect(page.locator('.cad-topology-anchor[data-active="true"]')).toHaveCount(1);await page.mouse.down();await page.mouse.up();
  }
  await expect(measure.locator('[data-measure-value="Point-to-point distance: Distance"]')).toHaveText('22.36 mm');
  await measure.getByRole('button',{name:'Pin Point-to-point distance: ΔX',exact:true}).click();
  await measure.getByRole('button',{name:'Pin Point-to-point distance: ΔY',exact:true}).click();
  await page.mouse.move(1200,300);
  await expect(page.locator('.cad-measure-overlay g[data-axis="0"]')).toBeVisible();
  await expect(page.locator('.cad-measure-overlay g[data-axis="1"]')).toBeVisible();
  await page.screenshot({path:join(evidence,'measure-pinned-components.png')});
  await measure.getByRole('button',{name:'Done',exact:true}).click();
}
