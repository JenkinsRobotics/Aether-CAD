import {expect,it,vi} from 'vitest';
import {SelectionStroke} from './selection-stroke';
import {CADSelectionStore,effectiveSelectionKind} from '../cad-selection-store';
it('paints between sparse events and deduplicates repeated hits',()=>{
 const pick=vi.fn(({x}:{x:number})=>x>=48&&x<=52?{id:'body:a',kind:'body' as const,partId:'a',label:'A'}:null);
 const stroke=new SelectionStroke('paint',{x:0,y:0},pick);stroke.append({x:100,y:0});stroke.append({x:0,y:0});
 expect(stroke.items().map(i=>i.id)).toEqual(['body:a']);
});
it('keeps stroke previews separate so cancelling preserves existing selection',()=>{
 const store=new CADSelectionStore();const a={id:'body:a',kind:'body' as const,partId:'a',label:'A'};
 store.dispatch({type:'replace',items:[a]});
 const stroke=new SelectionStroke('freeform',{x:0,y:0},()=>a);stroke.append({x:100,y:10});
 store.dispatch({type:'set-stroke',stroke:stroke.snapshot()});
 store.dispatch({type:'set-stroke',stroke:null});expect(store.snapshot().items).toEqual([a]);expect(stroke.items()).toEqual([]);
});
it('priority activates Auto while explicit filters remain authoritative',()=>{
 const store=new CADSelectionStore();store.dispatch({type:'set-filter',filter:'vertex'});
 store.dispatch({type:'set-priority',priority:'edge'});expect(effectiveSelectionKind(store.snapshot())).toBe('edge');
 expect(store.snapshot().filter).toBe('auto');
 store.dispatch({type:'set-filter',filter:'face'});expect(effectiveSelectionKind(store.snapshot())).toBe('face');
 store.dispatch({type:'set-filter',filter:'auto'});expect(effectiveSelectionKind(store.snapshot())).toBe('edge');
});
