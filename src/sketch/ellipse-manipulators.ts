import type {SketchDrawing} from '@aether/core/sketch';
import {ellipseHandles} from '../../freecad-engine/browser/ellipse-manipulation';
export function renderEllipseManipulators(svg:SVGSVGElement,drawing:SketchDrawing,width:number) {
  const offset=width*24/Math.max(svg.getBoundingClientRect().width,800);
  svg.dataset.ellipseHandleOffset=String(offset);
  const handles=ellipseHandles(drawing,offset);
  for(const handle of handles) {
    const node=document.createElementNS('http://www.w3.org/2000/svg','circle');
    node.setAttribute('cx',String(handle.point[0]));node.setAttribute('cy',String(-handle.point[1]));node.setAttribute('r','0.001');
    node.setAttribute('class',`sketch-point sketch-ellipse-control sketch-ellipse-${handle.kind}`);
    node.dataset.ellipseHandle=handle.kind;node.dataset.ellipseContour=String(handle.contour);node.dataset.ellipseSide=String(handle.side);
    node.dataset.nodeLabel=handle.label;node.setAttribute('aria-label',handle.label);
    const source=handle.ref.kind==='point'
      ? svg.querySelector(`[data-node-contour="${handle.ref.contour}"][data-node-index="${handle.ref.index}"]`)
      : svg.querySelector(`[data-entity-contour="${handle.contour}"][data-entity-segment="0"]`);
    const state=source?.getAttribute('data-entity-constraint-state');
    if(state) {node.setAttribute('data-entity-constraint-state',state);node.setAttribute('aria-label',`${handle.label}: ${state.replaceAll('-',' ')}`);}
    const title=document.createElementNS(node.namespaceURI,'title');title.textContent=handle.label;node.append(title);svg.append(node);
    if(handle.kind==='rotation') {
      const anchor=handles.find(h=>h.contour===handle.contour && h.kind==='primary' && h.side===1)!;
      const guide=document.createElementNS(node.namespaceURI,'line');
      for(const [key,value] of Object.entries({x1:anchor.point[0],y1:-anchor.point[1],x2:handle.point[0],y2:-handle.point[1]}))guide.setAttribute(key,String(value));
      guide.setAttribute('class','sketch-preview-guide sketch-ellipse-guide');svg.insertBefore(guide,node);
    }
  }
}
