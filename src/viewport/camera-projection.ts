import {OrthographicCamera, PerspectiveCamera, Vector3} from 'three/webgpu';
export type ModelingCamera = PerspectiveCamera | OrthographicCamera;
export type CameraProjection = 'perspective' | 'orthographic';
export function cameraAspect(camera:ModelingCamera):number {
  return camera instanceof PerspectiveCamera ? camera.aspect : (camera.right-camera.left)/(camera.top-camera.bottom);
}
export function cameraVerticalSpan(camera:ModelingCamera,target:Vector3):number {
  return camera instanceof PerspectiveCamera
    ? 2*camera.position.distanceTo(target)*Math.tan(camera.fov*Math.PI/360)/camera.zoom
    : (camera.top-camera.bottom)/camera.zoom;
}
export function setOrthographicSpan(camera:OrthographicCamera,span:number,aspect:number):void {
  const half=Math.max(span,0.001)/2;
  camera.top=half;camera.bottom=-half;camera.left=-half*aspect;camera.right=half*aspect;camera.zoom=1;camera.updateProjectionMatrix();
}
/** Preserve the target-plane scale and rigid viewing basis across projections. */
export function changeCameraProjection(camera:ModelingCamera,target:Vector3,projection:CameraProjection,fov:number):ModelingCamera {
  if ((camera instanceof OrthographicCamera)===(projection==='orthographic'))return camera;
  const span=cameraVerticalSpan(camera,target),aspect=cameraAspect(camera);
  const next:ModelingCamera=projection==='orthographic'
    ? new OrthographicCamera(-1,1,1,-1,camera.near,camera.far)
    : new PerspectiveCamera(fov,aspect,camera.near,camera.far);
  next.position.copy(camera.position);next.up.copy(camera.up);next.quaternion.copy(camera.quaternion);
  if(next instanceof OrthographicCamera)setOrthographicSpan(next,span,aspect);
  else {
    const direction=camera.position.clone().sub(target).normalize();
    const distance=span/(2*Math.tan(fov*Math.PI/360));
    next.position.copy(target).addScaledVector(direction,distance);
    next.far=Math.max(next.far,distance*4);next.updateProjectionMatrix();
  }
  next.updateMatrixWorld(true);
  return next;
}
export function resizeModelingCamera(camera:ModelingCamera,aspect:number):void {
  if(camera instanceof PerspectiveCamera)camera.aspect=aspect;
  else {const half=(camera.top-camera.bottom)/2;camera.left=-half*aspect;camera.right=half*aspect;}
  camera.updateProjectionMatrix();
}
