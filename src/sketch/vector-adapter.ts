import { booleanPaths, pathContours, polygonArea, samplePath, pointInPolygon, type BooleanOperation, type SketchPath } from '@aether/sketch';
import { contourClosed, contourNestingDepths, validateSketchDrawing, type SketchContour, type SketchDrawing } from '@aether/core/sketch';
/** This is an adapter into the existing CAD document, not another solver. */
export function cadVectorPath(c:SketchContour):SketchPath {
  if(c.type!=='path'||c.segments.some(s=>s.type!=='line'&&s.type!=='bezier'))throw Error('Vector copies support lines and Béziers. Use CAD features for analytic circles/arcs/ellipses.');
  const closed=contourClosed(c),points=[c.start,...c.segments.map(s=>s.end)];if(closed)points.pop();
  return {points,closed,curves:c.segments.map(s=>s.type==='bezier'?{c1:s.controls[0],c2:s.controls[1]}:null)};
}
export function cadVectorContour(path:SketchPath,hole=false):SketchContour {
  return {type:'path',id:crypto.randomUUID(),start:path.points[0],hole,segments:path.points.slice(1).concat(path.closed?[path.points[0]]:[]).map((end,i)=>path.curves?.[i]?{type:'bezier' as const,end,controls:[path.curves[i]!.c1,path.curves[i]!.c2] as [[number,number],[number,number]]}:{type:'line' as const,end})};
}
/** Exact CAD nesting checks gate classification; retained imported Béziers stay Béziers. */
export function importedVectorContours(paths:SketchPath[],fillRule:'evenodd'|'nonzero'):SketchContour[] {
  const closed=paths.filter(p=>p.closed),contours=closed.map(p=>cadVectorContour(p)),depths=contourNestingDepths(contours);
  if(closed.length&&!depths)throw Error('Touching or intersecting compound boundaries need simplification before CAD import.');
  const sampled=closed.map(p=>samplePath(p,.001)),signs=sampled.map(p=>Math.sign(polygonArea(p)));
  const retained=contours.filter((c,i)=>{
    if(fillRule==='evenodd'){c.hole=depths![i]%2===1;return true;}
    const winding=sampled.reduce((sum,ring,j)=>j!==i&&pointInPolygon(ring,sampled[i][0])?sum+signs[j]:sum,0);
    const inside=winding+signs[i];c.hole=winding!==0&&inside===0;
    return (winding===0)!==(inside===0);
  });
  return [...retained,...paths.filter(p=>!p.closed).map(p=>cadVectorContour(p))];
}
/** Explicit independent output copies leave every source entity/reference/constraint intact. */
export function vectorBooleanCopy(drawing:SketchDrawing,indices:number[],operation:BooleanOperation,toleranceMillimeters:number):SketchDrawing {
  const result=booleanPaths(vectorBooleanInputs(drawing,indices),operation,toleranceMillimeters);
  return appendVectorBooleanResult(drawing,result);
}
export function vectorBooleanInputs(drawing:SketchDrawing,indices:number[]):SketchPath[] {
  const unique=[...new Set(indices)].sort((a,b)=>a-b);
  if(unique.length<2)throw Error('Select at least two closed vector contours.');
  const contours=unique.map(i=>drawing.contours[i]);
  if(contours.some(c=>!c||c.construction||c.hole))throw Error('Select regular outer contours. Import compound holes through SVG.');
  return contours.map(cadVectorPath);
}
export function appendVectorBooleanResult(drawing:SketchDrawing,result:SketchPath|null):SketchDrawing {
  if(!result)throw Error('The result is empty. Source contours were kept.');
  const added=pathContours(result).map(p=>cadVectorContour(p,polygonArea(p.points)<0));
  const next={...structuredClone(drawing),contours:[...structuredClone(drawing.contours),...added]};validateSketchDrawing(next);return next;
}
