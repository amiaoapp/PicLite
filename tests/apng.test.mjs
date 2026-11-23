import assert from 'node:assert/strict';
import test from 'node:test';
import { isAnimatedPng, optimizeApng } from '../app/apng.ts';
import { apngFixture, verifyCompressedApng } from './apng-fixture.mjs';

test('APNG recompression preserves all pixels and playback settings', async () => {
  const original = apngFixture();
  const input = new Blob([original], { type: 'image/apng' });
  assert.equal(await isAnimatedPng(input), true);
  for (const stripMetadata of [true, false]) {
    const result = await optimizeApng(input, stripMetadata);
    assert.equal(result.type, 'image/png');
    verifyCompressedApng(original, Buffer.from(await result.arrayBuffer()), stripMetadata);
  }
});
