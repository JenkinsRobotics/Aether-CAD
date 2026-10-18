import * as THREE from 'three/webgpu';
import type { CADScreenPoint, CADSelectionItem, CADSelectionKind } from '../cad-selection-store';
import type { SelectablePart, ScreenProjector } from './box-selection';

const cross = (a: CADScreenPoint, b: CADScreenPoint, c: CADScreenPoint) =>
  (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const onSegment = (p: CADScreenPoint, a: CADScreenPoint, b: CADScreenPoint) =>
  Math.abs(cross(a,b,p)) < 1e-7 && p.x >= Math.min(a.x,b.x)-1e-7 && p.x <= Math.max(a.x,b.x)+1e-7 &&
  p.y >= Math.min(a.y,b.y)-1e-7 && p.y <= Math.max(a.y,b.y)+1e-7;

/** Even/odd containment supports concave and self-crossing lassos. Boundary is inside. */
export function pointInLasso(p: CADScreenPoint, polygon: readonly CADScreenPoint[]): boolean {
  let inside = false;
  for (let i=0,j=polygon.length-1; i<polygon.length; j=i++) {
    const a=polygon[j], b=polygon[i];
    if (onSegment(p,a,b)) return true;
    if ((a.y>p.y)!==(b.y>p.y) && p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) inside=!inside;
  }
  return inside;
}

function segmentsIntersect(a: CADScreenPoint,b: CADScreenPoint,c: CADScreenPoint,d: CADScreenPoint): boolean {
  return (cross(a,b,c)*cross(a,b,d)<0 && cross(c,d,a)*cross(c,d,b)<0) ||
    onSegment(a,c,d) || onSegment(b,c,d) || onSegment(c,a,b) || onSegment(d,a,b);
}

function triangleTouchesLasso(triangle: CADScreenPoint[], polygon: readonly CADScreenPoint[]): boolean {
  if (triangle.some(p=>pointInLasso(p,polygon))) return true;
  // A lasso can sit entirely inside a large triangle, with none of its vertices inside.
  if (Math.abs(cross(triangle[0],triangle[1],triangle[2]))>1e-7 && polygon.some(p=>pointInLasso(p,triangle))) return true;
  return triangle.some((a,i)=>polygon.some((c,j)=>segmentsIntersect(a,triangle[(i+1)%3],c,polygon[(j+1)%polygon.length])));
}

/** Crossing-style selection against actual projected triangles, not their bounding boxes.
 * Includes occluded geometry; Paint uses visible ray hits instead. */
export function itemsInsideLasso(parts: Iterable<SelectablePart>, kind: CADSelectionKind,
  polygon: readonly CADScreenPoint[], project: ScreenProjector): readonly CADSelectionItem[] {
  if (polygon.length<3) return [];
  const items=new Map<string,CADSelectionItem>();
  for (const part of parts) {
    if (!part.group.visible) continue;
    if (kind==='edge'||kind==='vertex') {
      for (const face of part.topology.values()) for (const candidate of face.candidates) {
        if (candidate.kind!==(kind==='edge'?'edge-midpoint':'vertex')) continue;
        const p=project(new THREE.Vector3(...candidate.origin).applyMatrix4(part.group.matrixWorld));
        if (p && pointInLasso(p,polygon)) {
          const id=`${kind}:${part.data.id}:${candidate.id}`;
          items.set(id,{id,kind,partId:part.data.id,faceId:face.id,label:candidate.label});
        }
      }
      continue;
    }
    const geometry=part.surface.geometry, positions=geometry.getAttribute('position'), index=geometry.index;
    if (!positions) continue;
    const count=index?.count??positions.count;
    const projected=new Map<number,CADScreenPoint|null>();
    const at=(offset:number)=>{
      const i=index?index.getX(offset):offset;
      if (!projected.has(i)) projected.set(i,project(new THREE.Vector3().fromBufferAttribute(positions,i).applyMatrix4(part.group.matrixWorld)));
      return projected.get(i)!;
    };
    const ranges=kind==='face'?part.faceRanges:[{start:0,count,faceId:0}];
    for (const [ordinal,range] of ranges.entries()) {
      if (kind==='face' && !part.topology.has(range.faceId)) continue;
      let hit=false;
      for (let offset=range.start; offset+2<Math.min(count,range.start+range.count); offset+=3) {
        const points=[at(offset),at(offset+1),at(offset+2)];
        if (points.every((p):p is CADScreenPoint=>p!==null) && triangleTouchesLasso(points,polygon)) {hit=true;break;}
      }
      if (!hit) continue;
      const id=`${kind}:${part.data.id}${kind==='face'?`:${range.faceId}`:''}`;
      items.set(id,{id,kind,partId:part.data.id,
        ...(kind==='face'?{faceId:range.faceId,label:`Face ${ordinal+1} of ${part.data.name}`}:{label:part.data.name})});
    }
  }
  return [...items.values()];
}
