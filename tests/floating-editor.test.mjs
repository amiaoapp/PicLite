import test from 'node:test';
import assert from 'node:assert/strict';
import { cropFromDrag, editorCompressionSettings, translateCrop, resizeCrop, cropForAspect } from '../desktop/floating-editor-model.ts';

test('drag in either direction maps displayed image to native crop pixels and clamps edges', () => {
  assert.deepEqual(cropFromDrag({x: .9, y: .8}, {x: .2, y: .1}, 1000, 500), {x: 200, y: 50, width: 700, height: 350});
  assert.deepEqual(cropFromDrag({x: -.2, y: 0}, {x: 2, y: 1}, 80, 40), {x: 0, y: 0, width: 80, height: 40});
});

test('explicit quality and format keep dimensions and always create a separate result', () => {
  assert.deepEqual(editorCompressionSettings(42, 'webp'), {mode: 'manual', quality: 42, format: 'webp', scale: 100, preventLarger: false});
});

test('crop presets fit inside the image at the requested aspect without changing source size', () => {
  assert.deepEqual(cropForAspect(800,600,1),{x:100,y:0,width:600,height:600});
  assert.deepEqual(cropForAspect(800,600,0),{x:0,y:0,width:800,height:600});
});
test('moving a crop stays inside image boundaries without changing its size', () => {
  assert.deepEqual(translateCrop({x:50,y:20,width:100,height:60},190,-99,200,100),{x:100,y:0,width:100,height:60});
});
test('corner handles preserve opposite corner and constrained aspect', () => {
  assert.deepEqual(resizeCrop({x:50,y:20,width:100,height:60},'se',{x:.9,y:.9},200,100,0),{x:50,y:20,width:130,height:70});
  const c=resizeCrop({x:50,y:20,width:100,height:60},'se',{x:.9,y:.9},200,100,1);
  assert.equal(c.width,c.height);assert.equal(c.x,50);assert.equal(c.y,20);assert.ok(c.y+c.height<=100);
});
