import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../app/img2banner-template.html', import.meta.url), 'utf8');
function cropWheel(deltaY, deltaMode = 0, initial = 1, hasImage = true) {
  const handler = source.match(/editorCanvas\.addEventListener\('wheel', e => \{([\s\S]*?)\}, \{passive: false\}\);/)[1];
  const helper = source.match(/function wheelZoomScale\([^)]*\) \{[\s\S]*?\n    \}/)?.[0] || '';
  const state = { crop: { zoom: initial }, origImg: hasImage ? {} : null, zoom: {}, zoomNum: {}, renders: 0, prevented: false };
  const context = vm.createContext({ ...state, e: { deltaY, deltaMode, preventDefault() { state.prevented = true; } }, generateInnerFromOrig() { state.renders++; } });
  vm.runInContext(`${helper}\n(function(){${handler}})()`, context);
  return { ...state, value: context.crop.zoom };
}

test('tiny trackpad motion makes a proportionally tiny crop adjustment', () => {
  const tiny = cropWheel(-1).value;
  const notch = cropWheel(-100).value;
  assert.ok(tiny > 1 && tiny < 1.002, `tiny delta gave ${tiny}`);
  assert.ok(notch > tiny && notch <= 1.02, `notch gave ${notch}`);
});
test('line and page wheel modes normalize to the equivalent pixel motion', () => {
  assert.equal(cropWheel(-1, 1).value, cropWheel(-16, 0).value);
  assert.equal(cropWheel(-1, 2).value, cropWheel(-800, 0).value);
});
test('large wheel deltas stay bounded, reversible and within crop limits', () => {
  const up = cropWheel(-10000).value;
  assert.ok(up <= 1.02);
  assert.ok(Math.abs(cropWheel(10000, 0, up).value - 1) < 1e-12);
  assert.equal(cropWheel(-10000, 0, 5).value, 5);
  assert.equal(cropWheel(10000, 0, 0.2).value, 0.2);
});
test('zero or invalid motion does not redraw or alter crop', () => {
  for (const delta of [0, NaN, Infinity]) {
    const result = cropWheel(delta);
    assert.equal(result.value, 1);
    assert.equal(result.renders, 0);
  }
});
test('wheel over an empty crop does not change saved state', () => {
  const result = cropWheel(-100, 0, 1, false);
  assert.equal(result.value, 1);
  assert.equal(result.renders, 0);
});
