import test from 'node:test';
import assert from 'node:assert/strict';
import { containPreview } from '../desktop/preview-fit.ts';

test('wide and tall images fit the resized preview with all four edges inside',()=>{
 for(const [iw,ih] of [[922,454],[454,922],[1800,300],[300,1800]])for(const [w,h] of [[230,100],[300,150],[500,340],[170,70]]){
  const r=containPreview(iw,ih,w,h);assert.ok(r.width<=w+.001&&r.height<=h+.001);assert.ok(Math.abs(r.width/r.height-iw/ih)<.0001);assert.ok(r.left>=0&&r.top>=0);
 }
});
test('preview shrinks on both axes rather than retaining a previous intrinsic size',()=>{
 const a=containPreview(554,396,360,230),b=containPreview(554,396,220,80);assert.ok(b.width<a.width&&b.height<a.height);assert.equal(b.height,80);
});
