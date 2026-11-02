import type {SketchDrawing,SketchContour} from "../drawing";
import type {SketchEntityRef} from "./types";

/** The sketch origin: always present, never moves, never saved as geometry. */
export const SKETCH_ORIGIN_ID="sketch-origin";
export const SKETCH_ORIGIN_REF:SketchEntityRef={contour:-1,projectedContourId:SKETCH_ORIGIN_ID,kind:"point",index:0};
const origin:SketchContour={type:"path",id:SKETCH_ORIGIN_ID,start:[0,0],segments:[]};

/** Resolve external geometry without adding it to the authored coordinate array. */
export function referencedContour(d:SketchDrawing,r:SketchEntityRef):SketchContour|undefined {
  if(r?.projectedContourId===undefined)return d.contours[r?.contour];
  if(r.projectedContourId===SKETCH_ORIGIN_ID&&r.contour===-1)return origin;
  if(typeof r.projectedContourId!=="string"||!r.projectedContourId.trim()||r.contour!==-1)throw Error("Invalid projected constraint reference.");
  const matches=d.projectionContext?.filter(c=>c.id===r.projectedContourId)??[];
  if(matches.length!==1)throw Error(`Broken projected constraint reference: ${r.projectedContourId}.`);
  return matches[0];
}
