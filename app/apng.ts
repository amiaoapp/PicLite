const signature = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const ascii = new TextDecoder();

async function readChunkHeader(file: Blob, offset: number) {
  const bytes = await file.slice(offset, offset + 8).arrayBuffer();
  if (bytes.byteLength !== 8) return null;
  const length = new DataView(bytes).getUint32(0);
  if (offset + length + 12 > file.size) return null;
  return { length, type: ascii.decode(bytes.slice(4)) };
}

export async function isAnimatedPng(file: Blob) {
  const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (!signature.every((byte, index) => header[index] === byte)) return false;
  for (let offset = 8; offset + 12 <= file.size;) {
    const chunk = await readChunkHeader(file, offset);
    if (!chunk || chunk.type === "IDAT" || chunk.type === "IEND") return false;
    if (chunk.type === "acTL" && chunk.length === 8) return true;
    offset += chunk.length + 12;
  }
  return false;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function makeChunk(type: string, payload: Uint8Array, sequence?: number) {
  const prefix = sequence === undefined ? 0 : 4;
  const bytes = new Uint8Array(12 + prefix + payload.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, prefix + payload.length);
  for (let i = 0; i < 4; i++) bytes[i + 4] = type.charCodeAt(i);
  if (sequence !== undefined) view.setUint32(8, sequence);
  bytes.set(payload, 8 + prefix);
  let crc = 0xffffffff;
  for (let i = 4; i < bytes.length - 4; i++) crc = crcTable[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
  view.setUint32(bytes.length - 4, (crc ^ 0xffffffff) >>> 0);
  return bytes.buffer;
}

async function recompress(parts: Uint8Array<ArrayBuffer>[], limit: number) {
  const source = new Blob(parts).stream().pipeThrough(new DecompressionStream("deflate"));
  const reader = source.getReader();
  const pixels: Uint8Array<ArrayBuffer>[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) { await reader.cancel(); return null; }
      pixels.push(new Uint8Array(value));
    }
  } catch { return null; }
  finally { reader.releaseLock(); }
  const encoded = new Blob(pixels).stream().pipeThrough(new CompressionStream("deflate"));
  return { bytes: new Uint8Array(await new Response(encoded).arrayBuffer()), total };
}

export async function optimizeApng(file: Blob, stripMetadata: boolean) {
  const maxFrame = 64 * 1024 * 1024;
  let budget = 512 * 1024 * 1024;
  if (file.size > 256 * 1024 * 1024) throw new Error("APNG 超过 256 MB");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const chunks: { type: string; start: number; end: number }[] = [];
  for (let start = 8; start + 12 <= bytes.length;) {
    const end = start + view.getUint32(start) + 12;
    if (end > bytes.length) break;
    const type = ascii.decode(bytes.subarray(start + 4, start + 8));
    chunks.push({ type, start, end });
    if (type === "IEND") break;
    start = end;
  }
  const output: BlobPart[] = [signature];
  let sequence = 0, frames = 0, expectedFrames = 0;
  for (let i = 0; i < chunks.length; i++) {
    const { type, start, end } = chunks[i];
    const payload = bytes.subarray(start + 8, end - 4);
    if (type === "IDAT" || type === "fdAT") {
      const prefix = type === "fdAT" ? 4 : 0;
      const first = i;
      const parts = [payload.subarray(prefix)];
      while (chunks[i + 1]?.type === type) {
        const part = chunks[++i];
        parts.push(bytes.subarray(part.start + 8 + prefix, part.end - 4));
      }
      if (prefix && chunks.slice(first, i + 1).some(chunk => chunk.end - chunk.start < 16)) throw new Error("Invalid APNG frame data");
      let interrupted = false;
      if (prefix) {
        for (let next = i + 1; next < chunks.length && !["fcTL", "IEND"].includes(chunks[next].type); next++) {
          if (chunks[next].type === "fdAT") { interrupted = true; break; }
        }
      }
      const compressible = !interrupted && budget > 0 && typeof CompressionStream === "function" && typeof DecompressionStream === "function";
      const encoded = compressible ? await recompress(parts, Math.min(maxFrame, budget)) : null;
      if (compressible) budget = encoded ? budget - encoded.total : 0;
      if (encoded && encoded.bytes.length + 12 + prefix < chunks[i].end - start) {
        output.push(makeChunk(type, encoded.bytes, prefix ? sequence++ : undefined));
      } else {
        for (let part = first; part <= i; part++) {
          const raw = chunks[part];
          output.push(prefix ? makeChunk(type, parts[part - first], sequence++) : bytes.subarray(raw.start, raw.end));
        }
      }
    } else if (type === "fcTL") {
      if (payload.length !== 26) throw new Error("Invalid APNG frame control");
      frames++;
      output.push(makeChunk(type, payload.subarray(4), sequence++));
    } else if (!stripMetadata || !["tEXt", "zTXt", "iTXt", "tIME", "eXIf"].includes(type)) {
      if (type === "acTL" && payload.length === 8) expectedFrames = view.getUint32(start + 8);
      output.push(bytes.subarray(start, end));
    }
  }
  if (!frames || frames !== expectedFrames || chunks.at(-1)?.type !== "IEND") throw new Error("APNG 动画不完整");
  const blob = new Blob(output, { type: "image/png" });
  return blob.size < file.size ? blob : new Blob([file], { type: "image/png" });
}
