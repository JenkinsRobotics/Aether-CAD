import { expect, it, vi } from 'vitest';
import { ObjectAppearanceStore } from './cad-object-appearance';
import type { PartDisplayOverride } from './viewport/part-display';

it('projects existing renderer overrides, changes only requested properties and rejects stale documents', () => {
  const store = new ObjectAppearanceStore(), values: Record<string, PartDisplayOverride> = {a:{color:'#123456'},b:{opacity:.5}};
  let rows = [{id:'a',name:'Plate',sourceDocumentId:'doc'}, {id:'b',name:'Pin',sourceDocumentId:'doc'}];
  const viewer = {getPartRows:()=>rows,getPartDisplay:(id:string)=>values[id],setPartDisplay:vi.fn((id:string,value:PartDisplayOverride)=>{values[id]=value;})};
  const detach = store.attach(viewer as never), notify = vi.fn(); store.subscribe(notify);
  const row = store.snapshot()[0]; store.change(row,{roughness:.25});
  expect(values.a).toEqual({color:'#123456',roughness:.25}); expect(values.b).toEqual({opacity:.5});
  expect(notify).toHaveBeenCalledOnce(); store.refresh(); expect(notify).toHaveBeenCalledOnce();
  store.change(row,{},true); expect(values.a).toEqual({});
  rows=[{id:'a',name:'Another plate',sourceDocumentId:'other'}]; store.refresh();
  const count=viewer.setPartDisplay.mock.calls.length; store.change(row,{opacity:0});
  expect(viewer.setPartDisplay).toHaveBeenCalledTimes(count);
  detach(); expect(store.snapshot()).toEqual([]);
});
