import {expect,it} from 'vitest';
import {selectedCandidateId} from './topology-selection';
it('preserves candidate identity when native body IDs contain colons',()=>{
 expect(selectedCandidateId({id:'edge:document:body:solid-a:face-34-edge-2',partId:'document:body:solid-a'})).toBe('face-34-edge-2');
 expect(selectedCandidateId({id:'vertex:part:face:vertex:2',partId:'part'})).toBe('face:vertex:2');
});
it('does not resolve a candidate belonging to another body',()=>{
 expect(selectedCandidateId({id:'edge:other:face-34-edge-2',partId:'part'})).toBeNull();
});
