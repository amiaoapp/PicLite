import assert from 'node:assert/strict';
import test from 'node:test';
import { floatingRadius } from '../desktop/floating-appearance.ts';
test('floating radius preserves square corners and migrates invalid values safely',()=>{
 assert.equal(floatingRadius(0),0);assert.equal(floatingRadius(18),18);
 assert.equal(floatingRadius(-3),0);assert.equal(floatingRadius(90),28);
 for(const v of [undefined,null,NaN,Infinity,'18'])assert.equal(floatingRadius(v),10);
});
