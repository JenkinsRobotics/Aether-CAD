import { expect, test } from 'vitest';
import { orderedTabs, reorderTabs } from './document-tab-state';
test('reorders in both directions without changing identities', () => {
  expect(reorderTabs(['a','b','c'],'a','c')).toEqual(['b','c','a']);
  expect(reorderTabs(['a','b','c'],'c','a')).toEqual(['c','a','b']);
  expect(reorderTabs(['a','b'],'missing','b')).toEqual(['a','b']);
});
test('saved order ignores removed items and appends new project elements', () => {
  expect(orderedTabs([{id:'a'},{id:'b'},{id:'c'}],['b','deleted','a']).map(tab=>tab.id)).toEqual(['b','a','c']);
});
