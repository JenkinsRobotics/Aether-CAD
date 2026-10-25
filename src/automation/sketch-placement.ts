import type { ProfileFeature } from '@aether/core/document';

const vector = (value: unknown, name: string): [number, number, number] => {
  if (!Array.isArray(value) || value.length !== 3 || value.some(v => typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v)>1e6)) throw Error(`${name} must have three finite components within 1000000.`);
  return [...value] as [number,number,number];
};
/** Explicit axes preserve the caller's handedness; no silent normalization. */
export function agentSketchPlacement(args: Record<string, unknown>): Pick<ProfileFeature,'plane'|'offsetMillimeters'|'frame'|'flip'> {
  const offset = args.offset_mm ?? 0;
  if (typeof offset !== 'number' || !Number.isFinite(offset) || Math.abs(offset)>1e6) throw Error('offset_mm must be finite and within 1000000.');
  if (args.flip !== undefined && args.flip !== 'x' && args.flip !== 'y') throw Error('flip must be x or y.');
  const flip = args.flip as 'x'|'y'|undefined;
  if (args.frame === undefined) {
    if (!['XY','XZ','YZ'].includes(String(args.plane))) throw Error('Choose XY, XZ or YZ, or provide an explicit frame.');
    return {plane:args.plane as ProfileFeature['plane'],offsetMillimeters:offset,...(flip?{flip}:{})};
  }
  if (args.plane !== undefined) throw Error('Choose plane or frame, not both.');
  const frame = args.frame;
  if (!frame || typeof frame !== 'object' || Array.isArray(frame) || Object.keys(frame).some(k=>!['origin_mm','x_direction','y_direction'].includes(k))) throw Error('frame requires origin_mm, x_direction and y_direction.');
  const f = frame as Record<string,unknown>, origin=vector(f.origin_mm,'origin_mm'), x=vector(f.x_direction,'x_direction'), y=vector(f.y_direction,'y_direction');
  if (Math.abs(Math.hypot(...x)-1)>1e-8 || Math.abs(Math.hypot(...y)-1)>1e-8 || Math.abs(x.reduce((sum,v,i)=>sum+v*y[i],0))>1e-8) throw Error('Frame axes must be perpendicular unit vectors.');
  const normal:[number,number,number]=[x[1]*y[2]-x[2]*y[1],x[2]*y[0]-x[0]*y[2],x[0]*y[1]-x[1]*y[0]];
  const placed=origin.map((v,i)=>v+offset*normal[i]) as [number,number,number];
  if(placed.some(v=>Math.abs(v)>1e6))throw Error('Offset frame origin exceeds 1000000 mm.');
  return {plane:'XY',offsetMillimeters:offset,frame:{originMillimeters:placed,xDirection:x,normal},...(flip?{flip}:{})};
}
