import {expect,it} from 'vitest';
import {readExtrusionPreviewAxes} from './extrusion-preview-axes';
const axis={side:'primary',parameter:'distance',originMillimeters:[0,0,12],direction:[.6,0,.8],scale:1,reversed:false};
it('decodes optional native axes independently from saved geometry',()=>{
 const result=readExtrusionPreviewAxes([axis]);expect(result).toEqual([axis]);expect(result?.[0]).not.toBe(axis);expect(readExtrusionPreviewAxes(undefined)).toBeUndefined();
});
it.each([{direction:[0,0,2]},{originMillimeters:[0,NaN,0]},{side:'wrong'},{parameter:'body'},{scale:0},{parameter:'second'},{reversed:'false'}])('discards unsafe or inconsistent hints %s',patch=>{
 expect(readExtrusionPreviewAxes([{...axis,...patch}])).toEqual([]);
});
it('refuses duplicate sides and oversized metadata',()=>{
 expect(readExtrusionPreviewAxes([axis,axis])).toEqual([]);expect(readExtrusionPreviewAxes([axis,axis,axis])).toEqual([]);
});
