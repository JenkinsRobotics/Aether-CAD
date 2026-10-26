import {Matrix3, Matrix4, Vector3} from 'three';
import type {TopologyMeasurements, Vec3} from '@aether/core/contracts';

export type SelectedTopologyMeasurement = TopologyMeasurements & {id:string;label:string;kind:string;
  endpoints?: [Vec3, Vec3]; perimeterMillimeters?: number; surfaceType?: string; fullCircle?: boolean;
  axisOriginMillimeters?: Vec3; samples?: Vec3[]; approximate?: boolean;
  triangles?: [Vec3, Vec3, Vec3][]; areaApproximate?: boolean;
};

/** Analytic values are in part coordinates; display vectors in the model frame. */
export function measurementsInWorld(measurements:TopologyMeasurements, matrix:Matrix4):TopologyMeasurements {
  return {
    ...measurements,
    ...(measurements.centerMillimeters ? {centerMillimeters:new Vector3(...measurements.centerMillimeters).applyMatrix4(matrix).toArray() as [number,number,number]} : {}),
    ...(measurements.linearDirection ? {linearDirection:new Vector3(...measurements.linearDirection).transformDirection(matrix).toArray() as [number,number,number]} : {}),
    ...(measurements.axisDirection ? {axisDirection:new Vector3(...measurements.axisDirection).transformDirection(matrix).toArray() as [number,number,number]} : {}),
    ...(measurements.planarNormal ? {planarNormal:new Vector3(...measurements.planarNormal).applyNormalMatrix(new Matrix3().getNormalMatrix(matrix)).toArray() as [number,number,number]} : {}),
  };
}

/** Unoriented acute angle; never substitute an arbitrary curve tangent. */
export function selectedTopologyAngle(selected:readonly SelectedTopologyMeasurement[]):{radians:number;label:string}|null {
  if(selected.length!==2)return null;
  const vectors=selected.map(item=>item.kind==='edge'?item.linearDirection ?? item.axisDirection:item.kind==='face'?item.planarNormal ?? item.axisDirection:undefined);
  const valid=(vector:Vec3|undefined):vector is Vec3=>!!vector && vector.length===3 && vector.every(Number.isFinite) && Math.hypot(...vector)>1e-12;
  if(!valid(vectors[0]) || !valid(vectors[1]))return null;
  const [a,b]=vectors;
  const dot=Math.min(1,Math.max(0,Math.abs(a.reduce((sum,value,index)=>sum+value*b[index],0)/(Math.hypot(...a)*Math.hypot(...b)))));
  const planes=selected.map(item=>item.kind==='face'&&!!item.planarNormal);
  const mixed=planes[0]!==planes[1];
  return {
    radians:mixed?Math.asin(dot):Math.acos(dot),
    label:mixed?(selected.some(item=>item.axisDirection)?'Axis-to-plane angle':'Edge-to-plane angle'):planes.every(Boolean)?'Angle between planes':selected.some(item=>item.axisDirection)?'Angle between axes':'Angle between straight edges',
  };
}
