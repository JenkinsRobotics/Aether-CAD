import type { SketchDrawing } from '@aether/core/sketch';
import type { BooleanOperation, SketchPath } from '@aether/sketch';
import { validateSketchDrawing, contourClosed } from '@aether/core/sketch';
import { importVectorSVG } from './svg-import';
import { vectorBooleanInputs, appendVectorBooleanResult } from './vector-adapter';
export function mountVectorPanel(parent:HTMLElement,drawing:()=>SketchDrawing,selected:()=>number[],commit:(next:SketchDrawing)=>void) {
  const root=document.createElement('section');parent.append(root);
  const note=document.createElement('p');note.textContent='Import SVG on this sketch plane at the scale below. SVG arcs become Bézier curves.';root.append(note);
  const field=(label:string,value:string)=>{const row=document.createElement('label'),input=document.createElement('input');input.type='number';input.step='any';input.min='.000001';input.value=value;input.setAttribute('aria-label',label);row.append(label,input);root.append(row);return input;};
  const scale=field('Millimeters per SVG unit',String(25.4/96));
  const file=document.createElement('input');file.type='file';file.accept='.svg,image/svg+xml';file.setAttribute('aria-label','CAD SVG file');root.append(file);
  const status=document.createElement('p');status.setAttribute('role','status');root.append(status);
  let disposed=false,generation=0,source='',preview:SketchDrawing|undefined,worker:Worker|undefined;
  const booleanButtons:HTMLButtonElement[]=[];
  const button=(label:string,run:()=>void)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=run;root.append(b);return b;};
  const apply=button('Insert SVG contours',()=>{if(!preview)return;try{const next={...structuredClone(drawing()),contours:[...structuredClone(drawing().contours),...preview.contours]};validateSketchDrawing(next);commit(next);preview=undefined;source='';file.value='';apply.disabled=true;status.textContent='SVG inserted. Undo removes this import.';}catch(e){status.textContent=(e as Error).message;}});apply.disabled=true;
  const parse=()=>{try{preview=undefined;apply.disabled=true;if(!source)return;const result=importVectorSVG(source,Number(scale.value));preview=result.drawing;status.textContent=`${preview.contours.length} editable contours. ${result.warnings.join(' ')}`;apply.disabled=false;}catch(e){status.textContent=(e as Error).message;}};
  scale.onchange=parse;
  file.onchange=async()=>{const f=file.files?.[0],request=++generation;preview=undefined;source='';apply.disabled=true;if(!f)return;try{const text=await f.text();if(disposed||request!==generation)return;source=text;parse();}catch(e){if(!disposed)status.textContent=(e as Error).message;}};
  const explanation=document.createElement('p');explanation.textContent='Create independent copies of closed line/Bézier contours. Subtract cuts later contours from the first. Curves use polygon edges at this tolerance.';root.append(explanation);
  const selectionLabel=document.createElement('label'),choices=document.createElement('select');choices.multiple=true;choices.size=3;choices.style.minHeight='76px';choices.style.width='100%';selectionLabel.style.flexDirection='column';selectionLabel.style.alignItems='stretch';choices.setAttribute('aria-label','Contours to combine');selectionLabel.append('Contours to combine',choices);root.append(selectionLabel);
  const sync=()=>{
    const selectedValues=new Set(Array.from(choices.selectedOptions).map(o=>o.value));choices.replaceChildren();
    drawing().contours.forEach((c,index)=>{
      if(c.type!=='path'||!contourClosed(c)||c.construction||c.hole||c.segments.some(s=>s.type!=='line'&&s.type!=='bezier'))return;
      const option=document.createElement('option');option.value=String(index);option.textContent=`Contour ${index+1}${c.sourceLayer?' · '+c.sourceLayer:''}`;option.selected=selectedValues.has(option.value);choices.append(option);
    });
  };sync();
  const tolerance=field('Vector Boolean tolerance (mm)','.01');
  const combine=async(op:BooleanOperation)=>{
    const snapshot=structuredClone(drawing());
    try {
      const paths=vectorBooleanInputs(snapshot,choices.selectedOptions.length?Array.from(choices.selectedOptions).map(o=>Number(o.value)):selected());
      booleanButtons.forEach(b=>b.disabled=true);root.setAttribute('aria-busy','true');status.textContent='Combining vectors…';
      const result=await new Promise<SketchPath|null>((resolve,reject)=>{
        const current=new Worker(new URL('./vector-worker.ts',import.meta.url),{type:'module'});worker=current;
        const timer=setTimeout(()=>{current.terminate();reject(Error('Operation timed out. Simplify the contours or increase tolerance.'));},15000);
        const finish=()=>{clearTimeout(timer);current.terminate();worker=undefined;};
        current.onmessage=e=>{finish();e.data.error?reject(Error(e.data.error)):resolve(e.data.path);};
        current.onerror=()=>{finish();reject(Error('Could not combine these vectors. Originals were kept.'));};
        current.postMessage({paths,operation:op,tolerance:Number(tolerance.value)});
      });
      if(disposed)return;
      if(JSON.stringify(snapshot)!==JSON.stringify(drawing()))throw Error('Sketch changed. Select contours and run the operation again.');
      commit(appendVectorBooleanResult(drawing(),result));status.textContent='Independent vector result added. Source contours and constraints were kept.';
    }catch(e){if(!disposed)status.textContent=(e as Error).message;}finally{booleanButtons.forEach(b=>b.disabled=false);root.setAttribute('aria-busy','false');}
  };
  for(const [op,label] of [['union','Union copy'],['difference','Subtract copy'],['intersection','Intersect copy'],['xor','Exclude copy']] as [BooleanOperation,string][])booleanButtons.push(button(label,()=>void combine(op)));
  return {sync,dispose(){disposed=true;generation++;worker?.terminate();root.remove();}};
}
