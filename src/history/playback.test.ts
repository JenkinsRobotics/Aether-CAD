import { afterEach, expect, it, vi } from 'vitest';
import { createRectanglePartDocument } from '@aether/core/document';
import type { ImportedModelData } from '@aether/core/contracts';
import { HistoryPlayback } from './playback';
const model=(name='frame'):ImportedModelData=>({sourceName:name,parts:[],parseMilliseconds:12});
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const part=()=>createRectanglePartDocument('Playback',{widthMillimeters:20,heightMillimeters:30,depthMillimeters:10});
function setup(evaluate=vi.fn().mockResolvedValue(model())) {
  const player=new HistoryPlayback();
  const service={evaluate,show:vi.fn(),changed:vi.fn(),presented:vi.fn().mockResolvedValue(undefined)};
  player.configure(service);const source=part();player.sync(source);
  return {player,service,source};
}
afterEach(()=>vi.useRealTimers());
it('replays every feature at the chosen pace without changing the source or its saved rollback',async()=>{
  vi.useFakeTimers(); const {player,service,source}=setup();source.rollbackIndex=1;
  const saved=JSON.stringify(source);player.setSpeed(2);player.play();await tick();
  expect(player.snapshot()).toMatchObject({status:'playing',index:1,pending:false,buildMilliseconds:12});
  expect(player.project(source)?.rollbackIndex).toBe(1);
  await vi.advanceTimersByTimeAsync(499);expect(service.evaluate).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(service.evaluate.mock.calls.map(([doc])=>doc.rollbackIndex)).toEqual([1,2]);
  expect(player.snapshot()).toMatchObject({status:'complete',index:2});
  expect(JSON.stringify(source)).toBe(saved);player.stop();
  expect(player.project(source)).toBe(source);expect(source.rollbackIndex).toBe(1);
  expect(service.show).toHaveBeenLastCalledWith(null,false);
});
it('pauses, resumes and cancels timers without queueing builds',async()=>{
  vi.useFakeTimers();const {player,service}=setup();player.play();await tick();player.pause();await tick();
  await vi.advanceTimersByTimeAsync(10000);expect(service.evaluate).toHaveBeenCalledTimes(1);
  player.play();await tick();expect(service.evaluate).toHaveBeenCalledTimes(2);
  player.stop();await vi.runAllTimersAsync();expect(player.snapshot().status).toBe('idle');
});
it('ignores late frames after a tab change and serializes rapid stop/restart',async()=>{
  const resolve:((model:ImportedModelData)=>void)[]=[];
  const {player,service,source}=setup(vi.fn(()=>new Promise<ImportedModelData>(r=>resolve.push(r))));
  player.play();player.stop();player.play();expect(resolve).toHaveLength(1);
  resolve[0](model('old'));await tick();expect(service.show).not.toHaveBeenCalledWith(model('old'),true);
  expect(resolve).toHaveLength(2);
  player.sync({...source,documentId:'other'});resolve[1](model('late'));await tick();
  expect(service.show).not.toHaveBeenCalledWith(model('late'),true);expect(player.snapshot().status).toBe('idle');
});
it('surfaces rebuild errors without skipping a failed feature or changing the source',async()=>{
  const {player,service,source}=setup(vi.fn().mockRejectedValue(Error('Broken face reference')));
  const saved=structuredClone(source);player.play();await tick();
  expect(player.snapshot()).toMatchObject({status:'error',index:0,pending:false,error:'Broken face reference'});
  expect(service.evaluate).toHaveBeenCalledTimes(1);expect(source).toEqual(saved);player.stop();
});
it('stops when editing becomes active and does not start on empty or unavailable documents',async()=>{
  const {player,source,service}=setup();player.play();await tick();player.sync(source,false);
  expect(player.snapshot()).toMatchObject({status:'idle',available:false});player.play();expect(service.evaluate).toHaveBeenCalledTimes(1);
  player.sync({...source,features:[]});player.play();expect(service.evaluate).toHaveBeenCalledTimes(1);
});
