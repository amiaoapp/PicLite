import assert from 'node:assert/strict';
import { deflateSync, inflateSync } from 'node:zlib';

function chunk(type, payload) {
  const bytes = Buffer.alloc(payload.length + 12);
  bytes.writeUInt32BE(payload.length);
  bytes.write(type, 4);
  payload.copy(bytes, 8);
  let crc = 0xffffffff;
  for (const byte of bytes.subarray(4, -4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  bytes.writeUInt32BE((crc ^ 0xffffffff) >>> 0, bytes.length - 4);
  return bytes;
}

export function apngFixture() {
  const width = 32, height = 24;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6;
  const animation = Buffer.alloc(8);
  animation.writeUInt32BE(2); animation.writeUInt32BE(3, 4);
  const chunks = [Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('acTL', animation)];
  let sequence = 0;
  for (let frame = 0; frame < 2; frame++) {
    const control = Buffer.alloc(26);
    control.writeUInt32BE(sequence++); control.writeUInt32BE(width, 4); control.writeUInt32BE(height, 8);
    control.writeUInt16BE(frame ? 13 : 7, 20); control.writeUInt16BE(100, 22);
    control[24] = frame; control[25] = frame;
    chunks.push(chunk('fcTL', control));
    const pixels = Buffer.alloc(height * (1 + 4 * width));
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = y * (1 + 4 * width) + 1 + 4 * x;
        pixels.set([frame ? 0 : 200, 40, frame ? 200 : 0, x < 8 ? 0 : 128], offset);
      }
    }
    const data = deflateSync(pixels, { level: 0 });
    const split = Math.floor(data.length / 2);
    for (const part of [data.subarray(0, split), data.subarray(split)]) {
      if (frame === 0) chunks.push(chunk('IDAT', part));
      else {
        const number = Buffer.alloc(4); number.writeUInt32BE(sequence++);
        chunks.push(chunk('fdAT', Buffer.concat([number, part])));
      }
    }
  }
  chunks.push(chunk('tEXt', Buffer.from('Comment\0APNG test fixture')), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(chunks);
}

function animationData(bytes) {
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  let sequence = 0, header, control;
  const frames = [];
  const types = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const payload = bytes.subarray(offset + 8, offset + 8 + length);
    const raw = bytes.subarray(offset, offset + length + 12);
    assert.deepEqual(raw, chunk(type, payload), `CRC for ${type}`);
    types.push(type);
    if (type === 'IHDR') header = payload;
    if (type === 'acTL') control = payload;
    if (type === 'fcTL' || type === 'fdAT') assert.equal(payload.readUInt32BE(), sequence++);
    if (type === 'fcTL') frames.push({ control: payload.subarray(4), payloads: [] });
    if (type === 'IDAT' || type === 'fdAT') frames.at(-1).payloads.push(type === 'fdAT' ? payload.subarray(4) : payload);
    offset += length + 12;
  }
  return { types, animation: { header, control, frames: frames.map(frame => ({ control: frame.control, pixels: inflateSync(Buffer.concat(frame.payloads)) })) } };
}

export function verifyCompressedApng(original, result, stripMetadata = true) {
  assert.ok(result.length < original.length, `${original.length} -> ${result.length} bytes`);
  const before = animationData(original), after = animationData(result);
  assert.deepEqual(after.animation, before.animation, 'frames, alpha, blend, disposal, duration and loop must be unchanged');
  assert.equal(after.types.includes('tEXt'), !stripMetadata);
}
