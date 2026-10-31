import assert from 'node:assert/strict';
import test from 'node:test';
import { coverPreview } from '../desktop/preview-fit.ts';
test('cover fills the complete slot on both axes while preserving aspect ratio',()=>{
 for(const [iw,ih,w,h] of [[1000,500,400,300],[500,1000,400,300],[800,600,240,150],[300,300,600,400]]){
  const r=coverPreview(iw,ih,w,h);assert.ok(r.width>=w-0.01&&r.height>=h-0.01,`${iw}x${ih} in ${w}x${h}`);assert.ok(Math.abs(r.width/r.height-iw/ih)<0.002);
  assert.ok(r.left<=0.01&&r.top<=0.01&&r.left+r.width>=w-0.01&&r.top+r.height>=h-0.01);
 }
});
