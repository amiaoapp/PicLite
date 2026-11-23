import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ImageMagick, initializeImageMagick } from '@imagemagick/magick-wasm';

// Lossless 32x24 WebP: red for 70 ms, blue for 130 ms, three plays.
export const animatedWebpFixture = () => Buffer.from('UklGRoQAAABXRUJQVlA4WAoAAAACAAAAHwAAFwAAQU5JTQYAAAD/////AwBBTk1GKAAAAAAAAAAAAB8AABcAAEYAAAJWUDhMDwAAAC8fwAUABxDtj/4HIqL/AQBBTk1GKAAAAAAAAAAAAB8AABcAAIIAAABWUDhMDwAAAC8fwAUABxBR//4HIqL/AQA=', 'base64');

let magick;
export async function verifyWebpToGif(bytes) {
  assert.match(bytes.subarray(0, 6).toString(), /^GIF8[79]a$/);
  magick ??= initializeImageMagick(readFileSync(new URL('../node_modules/@imagemagick/magick-wasm/dist/x86/magick.wasm', import.meta.url)));
  await magick;
  ImageMagick.readCollection(bytes, gif => {
    gif.coalesce();
    assert.deepEqual(gif.map(frame => [frame.width, frame.height, frame.animationDelay, frame.animationIterations]), [[32, 24, 7, 3], [32, 24, 13, 3]]);
    const [red, blue] = gif.map(frame => frame.getPixels(pixels => {
      const mean = [0, 0, 0];
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        const pixel = pixels.getPixel(x, y);
        for (let channel = 0; channel < 3; channel++) mean[channel] += pixel[channel] / 16;
      }
      return mean;
    }));
    assert.ok(red[0] > 220 && red[1] < 30 && red[2] < 30, JSON.stringify(red));
    assert.ok(blue[0] < 30 && blue[1] < 30 && blue[2] > 220, JSON.stringify(blue));
  });
}
