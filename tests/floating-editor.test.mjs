import test from 'node:test';
import assert from 'node:assert/strict';
import { cropFromDrag, editorCompressionSettings } from '../desktop/floating-editor-model.ts';

test('drag in either direction maps displayed image to native crop pixels and clamps edges', () => {
  assert.deepEqual(cropFromDrag({x: .9, y: .8}, {x: .2, y: .1}, 1000, 500), {x: 200, y: 50, width: 700, height: 350});
  assert.deepEqual(cropFromDrag({x: -.2, y: 0}, {x: 2, y: 1}, 80, 40), {x: 0, y: 0, width: 80, height: 40});
});

test('explicit quality and format keep dimensions and always create a separate result', () => {
  assert.deepEqual(editorCompressionSettings(42, 'webp'), {mode: 'manual', quality: 42, format: 'webp', scale: 100, preventLarger: false});
});
