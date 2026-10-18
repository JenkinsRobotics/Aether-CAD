import { readSVGGeometry, type SVGVectorElement } from '@aether/sketch';
import { validateSketchDrawing, type SketchDrawing } from '@aether/core/sketch';
import { importedVectorContours } from './vector-adapter';
/** SVG drawing coordinates become millimeters on the active CAD plane, Y-up. */
export function importVectorSVG(xml:string,millimetersPerUnit:number):{drawing:SketchDrawing;warnings:string[]} {
  if(!Number.isFinite(millimetersPerUnit)||millimetersPerUnit<=0)throw Error('Use a positive millimeters-per-SVG-unit scale.');
  if(xml.length>20_000_000||/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('SVG exceeds import limits or contains entity declarations.');
  const doc=new DOMParser().parseFromString(xml,'image/svg+xml'),root=doc.documentElement;
  if(root.localName!=='svg'||doc.querySelector('parsererror'))throw Error('Invalid SVG drawing.');
  if(doc.querySelectorAll('*').length>12000)throw Error('Too many SVG elements.');
  const tree=(e:Element,depth=0):SVGVectorElement=>{if(depth>100)throw Error('SVG nesting limit exceeded.');return {tag:e.localName,attributes:Object.fromEntries(Array.from(e.attributes).map(a=>[a.name,a.value])),children:Array.from(e.children).map(c=>tree(c,depth+1))};};
  const vb=(root.getAttribute('viewBox')??'').trim().split(/[\s,]+/).map(Number);
  const origin=vb.length===4&&vb.every(Number.isFinite)?`translate(${-vb[0]} ${-vb[1]})`:'';
  const {items,warnings}=readSVGGeometry(tree(root),`scale(${millimetersPerUnit} ${-millimetersPerUnit}) ${origin}`);
  const drawing:SketchDrawing={type:'drawing',contours:[]};
  for(const item of items){try {drawing.contours.push(...importedVectorContours(item.paths,item.fillRule).map(c=>({...c,sourceLayer:item.name.slice(0,255)})));}catch(e){warnings.push(`${item.name}: ${(e as Error).message}`);}}
  if(!drawing.contours.length)throw Error(warnings.join(' ')||'SVG contains no supported vector contours.');
  validateSketchDrawing(drawing);return {drawing,warnings};
}
