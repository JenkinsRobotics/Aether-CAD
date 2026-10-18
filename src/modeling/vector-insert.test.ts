// @vitest-environment jsdom
import {expect,it} from 'vitest';
import {appendVector} from './vector-insert';
import {parsePartDocument,serializePartDocument} from '@aether/core/document';
it('inserts SVG contours on the chosen plane with units and roundtrip preservation',()=>{
 const doc=appendVector(null,'plate.svg','<svg><path d="M0 0 L10 0 L10 5 L0 5 Z"/></svg>','svg','XZ',2);
 const reopened=parsePartDocument(serializePartDocument(doc));expect(reopened.features[0]).toMatchObject({type:'profile',plane:'XZ',name:'plate',profile:{type:'drawing'}});expect(reopened.features).toEqual(doc.features);
});
it('rejects invalid sources and invalid scale',()=>{expect(()=>appendVector(null,'bad.svg','broken','svg','XY',1)).toThrow();expect(()=>appendVector(null,'bad.svg','<svg/>','svg','XY',0)).toThrow(/positive/);});
