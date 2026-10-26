import { expect, it } from 'vitest';
import { analyticSpans, centerSpan, cornerAngle, segmentDistance } from './measurement-relations';
import { meshSurfaceDistance } from './mesh-distance';
import { measurementReport, type ReportInput } from './measurement-report';
import { frameCoordinates, framePoint } from './measurement-frame';
import { angleArc } from './measurement-overlay';
import type { SelectedTopologyMeasurement as Entity } from '../viewport/topology-measurement';
const entity = (patch: Partial<Entity> = {}): Entity => ({ id: 'a', label: 'A', kind: 'edge', ...patch });
const circle = (center: [number, number, number], radius: number) => entity({ centerMillimeters: center, radiusMillimeters: radius, axisDirection: [0, 0, 1], fullCircle: true });

it('measures finite segments, parallel edges, crossings and degenerate points', () => {
  expect(segmentDistance([0,0,0],[2,0,0],[3,1,0],[3,4,0]).distance_mm).toBeCloseTo(Math.sqrt(2));
  expect(segmentDistance([0,0,0],[2,0,0],[1,3,0],[5,3,0]).distance_mm).toBe(3);
  expect(segmentDistance([0,0,0],[2,0,0],[1,-1,0],[1,1,0]).distance_mm).toBe(0);
  expect(segmentDistance([1,2,0],[1,2,0],[0,0,0],[4,0,0]).distance_mm).toBe(2);
});
it('finds exact extrema of separated, nested, crossing and axially separated circles', () => {
  const cases = [
    { b: circle([10,0,0],2), min: 5, max: 15 },
    { b: circle([0,0,0],1), min: 2, max: 4 },
    { b: circle([2,0,0],2), min: 0, max: 7 },
    { b: circle([2,0,4],2), min: 4, max: Math.sqrt(65) },
  ];
  for (const {b,min,max} of cases) {
    const result = analyticSpans(circle([0,0,0],3), b);
    expect(result.minimum!.distance_mm).toBeCloseTo(min);
    expect(result.maximum!.distance_mm).toBeCloseTo(max);
    for(const span of [result.minimum!,result.maximum!]) {
      expect(Math.hypot(...span.points[0])).toBeCloseTo(3);
      expect(Math.hypot(...span.points[1].map((v,i)=>v-b.centerMillimeters![i]))).toBeCloseTo(b.radiusMillimeters!);
    }
  }
  const point = { ...entity({kind:'vertex'}), point:[0,0,4] as [number,number,number] };
  expect(analyticSpans(circle([0,0,0],3),point).minimum!.distance_mm).toBe(5);
  expect(analyticSpans(point,circle([0,0,0],3)).maximum!.distance_mm).toBe(5);
});
it('uses infinite cylinder axes for center spacing and preserves obtuse shared corners', () => {
  const a=entity({axisOriginMillimeters:[0,0,0],axisDirection:[0,0,1]});
  const b=entity({axisOriginMillimeters:[3,4,10],axisDirection:[0,0,-1]});
  expect(centerSpan(a,b)!.distance_mm).toBe(5);
  expect(centerSpan(a,{...b,axisDirection:[1,0,0]})!.distance_mm).toBe(4);
  const angle=cornerAngle(entity({linearDirection:[1,0,0],endpoints:[[0,0,0],[1,0,0]]}),entity({linearDirection:[-1,1,0],endpoints:[[0,0,0],[-1,1,0]]}));
  expect(angle!.radians*180/Math.PI).toBeCloseTo(135);
  const arc=angleArc(angle!.points);
  expect(arc).toHaveLength(33);expect(arc[0][0]).toBeCloseTo(.24);expect(arc.at(-1)![0]).toBeLessThan(0);
});
it('measures interior face distance and crossing triangles instead of nearest vertices', () => {
  const face=entity({kind:'face',triangles:[[[0,0,0],[10,0,0],[0,10,0]]]});
  const point={...entity({kind:'vertex'}),point:[2,2,3] as [number,number,number]};
  const value=meshSurfaceDistance(face,point)!;
  expect(value.distance_mm).toBe(3);expect(value.approximate).toBe(true);expect(value.points[0]).toEqual([2,2,0]);
  const crossing=entity({kind:'face',triangles:[[[2,2,-2],[2,2,2],[4,2,2]]]});
  expect(meshSurfaceDistance(face,crossing)!.distance_mm).toBe(0);
});
it('retains small nearby faces in large meshes while pruning distant geometry', () => {
  const triangles:NonNullable<Entity['triangles']>=Array.from({length:4000},(_,i)=>[[100+i,0,0],[101+i,0,0],[100+i,1,0]]);
  triangles[1]=[[0,0,0],[10,0,0],[0,10,0]];
  expect(meshSurfaceDistance(entity({triangles}),{...entity({kind:'vertex'}),point:[2,2,3]})!.distance_mm).toBe(3);
});
it('reports world-independent coordinates and signed component distances in a reference frame', () => {
  const frame={label:'Local',origin:[10,20,30] as const,xAxis:[0,1,0] as const,yAxis:[-1,0,0] as const,zAxis:[0,0,1] as const};
  expect(frameCoordinates([7,22,34],frame)).toEqual([2,3,4]);
  expect(framePoint([2,3,4],frame)).toEqual([7,22,34]);
  const input:ReportInput={items:[{id:'a',kind:'vertex',partId:'p',label:'A'},{id:'b',kind:'vertex',partId:'p',label:'B'}],points:[{selectionId:'a',candidateId:'a',partId:'p',positionMillimeters:[10,20,30]},{selectionId:'b',candidateId:'b',partId:'p',positionMillimeters:[7,22,34]}],measurements:[],mode:'Point-to-point',type:'Show all',frame};
  const rows=measurementReport(input)[0].rows;
  expect(rows.map(r=>r.value)).toEqual([Math.sqrt(29),2,3,4]);
  expect(rows[2].annotation!.points[1]).toEqual([7,20,30]);
});
it('totals selected shapes and keeps body properties separate from a face on that body', () => {
  const items:ReportInput['items']=[{id:'body:p',kind:'body',partId:'p',label:'Body'},{id:'face:p:1',kind:'face',partId:'p',faceId:1,label:'Face'}];
  const input:ReportInput={items,points:[],measurements:[entity({id:'body:p',kind:'body',areaSquareMillimeters:600}),entity({id:'face:p:1',kind:'face',areaSquareMillimeters:100})],physical:[{body_id:'p',volume_mm3:1000,area_mm2:600,center_mm:[5,5,5],bounds_mm:[10,10,10]}],mode:'Objects',type:'Show all'};
  const sections=measurementReport(input),face=sections.find(s=>s.id==='face:p:1')!;
  expect(face.rows.find(r=>r.id==='area')!.value).toBe(100);
  expect(face.rows.some(r=>r.id==='volume')).toBe(false);
  expect(sections.find(s=>s.id==='totals')!.rows.find(r=>r.id==='area')!.value).toBe(700);
  expect(measurementReport({...input,type:'Volume'}).flatMap(s=>s.rows).map(r=>r.label)).toEqual(['Volume']);
});
