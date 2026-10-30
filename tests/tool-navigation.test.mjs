import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeToolOrder, reorderTool, destinationAtPoint } from '../app/tool-order.ts';

test('saved ordering includes workspace and cover and preserves newly discovered tools', () => {
  assert.deepEqual(mergeToolOrder(['resize','banner','workspace','gone','resize'], ['workspace','banner','watcher','resize','plugin:x']), ['resize','banner','workspace','watcher','plugin:x']);
});
test('pointer reordering works left and right at target center and never drops entries', () => {
  assert.deepEqual(reorderTool(['workspace','banner','a','b'],'workspace','b'), ['banner','a','b','workspace']);
  assert.deepEqual(reorderTool(['workspace','banner','a','b'],'b','workspace'), ['b','workspace','banner','a']);
  assert.deepEqual(reorderTool(['a','b'],'missing','a'), ['a','b']);
});
test('pointer insertion targets work with scrolled tabs in viewport coordinates', () => {
  const boxes=[{id:'a',left:-60,right:10},{id:'b',left:14,right:84},{id:'c',left:88,right:158}];
  assert.equal(destinationAtPoint(40,boxes),'b');
  assert.equal(destinationAtPoint(200,boxes),'c');
});
