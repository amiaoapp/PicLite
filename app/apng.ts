const signature = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const ascii = new TextDecoder();
const metadata = ["tEXt", "zTXt", "iTXt", "tIME", "eXIf"];
const maxFrame = 64 * 1024 * 1024;
const maxDecoded = 512 * 1024 * 1024;

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

async function readApng(file: Blob) {
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
  return { bytes, view, chunks };
}

export async function optimizeApng(file: Blob, stripMetadata: boolean) {
  let budget = maxDecoded;
  const { bytes, view, chunks } = await readApng(file);
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
    } else if (!stripMetadata || !metadata.includes(type)) {
      if (type === "acTL" && payload.length === 8) expectedFrames = view.getUint32(start + 8);
      output.push(bytes.subarray(start, end));
    }
  }
  if (!frames || frames !== expectedFrames || chunks.at(-1)?.type !== "IEND") throw new Error("APNG 动画不完整");
  const blob = new Blob(output, { type: "image/png" });
  return blob.size < file.size ? blob : new Blob([file], { type: "image/png" });
}

function scaledInterval(start: number, length: number, from: number, to: number) {
  const left = Math.min(to - 1, Math.round(start * to / from));
  return [left, Math.min(to, Math.max(left + 1, Math.round((start + length) * to / from))) - left] as const;
}

function colorSteps(levels: number) {
  const step = 255 / (levels - 1);
  return Uint8Array.from({ length: 256 }, (_, value) => Math.round(Math.round(value / step) * step));
}

function reducePalette(palette: Uint8Array, alpha: Uint8Array, quality: number, resized: boolean) {
  const q = (quality - 1) / 99;
  const steps = colorSteps(Math.round(2 + 24 * q + 230 * q ** 22));
  const colors: number[][] = [];
  const lookup = new Map<number, number>();
  const key = (r: number, g: number, b: number, a: number) => ((r * 256 + g) * 256 + b) * 256 + a;
  for (let i = 0; i + 2 < palette.length; i += 3) {
    const a = alpha[i / 3] ?? 255;
    const rgba = [palette[i], palette[i + 1], palette[i + 2], a];
    const color = rgba.map((channel, n) => n === 3 ? a : a ? steps[channel] : 0);
    let index = colors.findIndex(entry => entry.every((value, n) => value === color[n]));
    if (index < 0) { index = colors.length; colors.push(color); }
    lookup.set(key(rgba[0], rgba[1], rgba[2], a), index);
  }
  const premultiplied = colors.map(([r, g, b, a]) => [Math.floor(r * a / 255), Math.floor(g * a / 255), Math.floor(b * a / 255), a]);
  return {
    rgb: Uint8Array.from(colors.flatMap(color => color.slice(0, 3))),
    alpha: Uint8Array.from(colors.map(color => color[3])),
    map(pixels: Uint8ClampedArray) {
      const result = new Uint8Array(pixels.length / 4);
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2], a = pixels[i + 3];
        const value = key(r, g, b, a);
        let index = lookup.get(value);
        if (index === undefined) {
          // Canvas interpolation and premultiplication can create new colors.
          const pr = Math.floor(r * a / 255), pg = Math.floor(g * a / 255), pb = Math.floor(b * a / 255);
          const preserveAlpha = !resized || a === 0 || a === 255;
          index = 0;
          let nearest = Number.POSITIVE_INFINITY;
          for (let n = 0; n < premultiplied.length; n++) {
            const [cr, cg, cb, ca] = premultiplied[n];
            const distance = (pr - cr) ** 2 + (pg - cg) ** 2 + (pb - cb) ** 2 + 4 * (a - ca) ** 2
              + (preserveAlpha && ca !== a ? 1_000_000 : 0);
            if (distance < nearest) { nearest = distance; index = n; }
          }
          if (lookup.size < 65_536) lookup.set(value, index);
        }
        result[i / 4] = index;
      }
      return result;
    },
  };
}

async function encodePixels(pixels: Uint8Array | Uint8ClampedArray, width: number, height: number, channels: number) {
  const stride = width * channels;
  const rows = new Uint8Array((stride + 1) * height);
  const magnitude = (value: number) => Math.abs((value + 128 & 255) - 128);
  for (let y = 0; y < height; y++) {
    const start = y * stride, output = y * (stride + 1);
    if (channels === 1) {
      rows.set(pixels.subarray(start, start + stride), output + 1);
      continue;
    }
    let raw = 0, sub = 0, up = 0;
    for (let x = 0; x < stride; x++) {
      const value = pixels[start + x];
      raw += magnitude(value);
      sub += magnitude(value - (x >= channels ? pixels[start + x - channels] : 0));
      up += magnitude(value - (y ? pixels[start + x - stride] : 0));
    }
    const filter = raw <= Math.min(sub, up) ? 0 : sub <= up ? 1 : 2;
    rows[output] = filter;
    for (let x = 0; x < stride; x++) {
      const base = filter === 1 && x >= channels ? pixels[start + x - channels] : filter === 2 && y ? pixels[start + x - stride] : 0;
      rows[output + 1 + x] = pixels[start + x] - base;
    }
  }
  const compressed = new Blob([rows]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(compressed).arrayBuffer());
}

async function transformApng(source: Awaited<ReturnType<typeof readApng>>, width: number, height: number, quality: number, strip: boolean) {
  const { bytes, chunks } = source;
  const header = bytes.slice(16, 29);
  const headerView = new DataView(header.buffer);
  const fromWidth = headerView.getUint32(0), fromHeight = headerView.getUint32(4);
  if (chunks[0]?.type !== "IHDR" || !fromWidth || !fromHeight || chunks.at(-1)?.type !== "IEND") throw new Error("APNG 动画不完整");
  if (Math.max(fromWidth * fromHeight, width * height) * 4 > maxFrame) throw new Error("APNG 动画像素过多");

  const payloadOf = (type: string) => {
    const chunk = chunks.find(part => part.type === type);
    return chunk ? bytes.subarray(chunk.start + 8, chunk.end - 4) : new Uint8Array();
  };
  const originalPalette = payloadOf("PLTE");
  const indexed = header[9] === 3 && quality < 100 && originalPalette.length
    ? reducePalette(originalPalette, payloadOf("tRNS"), quality, width !== fromWidth || height !== fromHeight) : null;
  const steps = !indexed && quality < 100 ? colorSteps(2 + Math.round(254 * ((quality - 1) / 99) ** 1.7)) : null;

  const newHeader = new Uint8Array(13), newView = new DataView(newHeader.buffer);
  newView.setUint32(0, width);
  newView.setUint32(4, height);
  newHeader.set([8, indexed ? 3 : 6], 8);
  const output: BlobPart[] = [signature, makeChunk("IHDR", newHeader)];
  const palette: BlobPart[] = [];
  const end = makeChunk("IEND", new Uint8Array());
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context || typeof CompressionStream !== "function") throw new Error("此浏览器不支持 APNG 缩放或有损压缩");

  let control: Uint8Array<ArrayBuffer> | undefined;
  let parts: BlobPart[] = [];
  let sequence = 0, frames = 0, expected = 0, budget = maxDecoded;
  let kind: "IDAT" | "fdAT" = "IDAT";
  let wroteDefault = false;
  const flush = async () => {
    if (!parts.length) return;
    const frameHeader = header.slice();
    const view = new DataView(frameHeader.buffer);
    const fc = control ? new DataView(control.buffer) : null;
    const rawWidth = fc?.getUint32(0) ?? fromWidth, rawHeight = fc?.getUint32(4) ?? fromHeight;
    const rawX = fc?.getUint32(8) ?? 0, rawY = fc?.getUint32(12) ?? 0;
    if (!rawWidth || !rawHeight || rawX + rawWidth > fromWidth || rawY + rawHeight > fromHeight
      || (kind === "IDAT" && (rawWidth !== fromWidth || rawHeight !== fromHeight)) || (kind === "fdAT" && (!control || !wroteDefault))) {
      throw new Error("Invalid APNG frame bounds");
    }
    const [x, w] = scaledInterval(rawX, rawWidth, fromWidth, width);
    const [y, h] = scaledInterval(rawY, rawHeight, fromHeight, height);
    budget -= 4 * Math.max(rawWidth * rawHeight, w * h);
    if (budget < 0) throw new Error("APNG 动画像素过多");
    view.setUint32(0, rawWidth);
    view.setUint32(4, rawHeight);
    const url = URL.createObjectURL(new Blob([signature, makeChunk("IHDR", frameHeader), ...palette, ...parts, end], { type: "image/png" }));
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      canvas.width = w;
      canvas.height = h;
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 0, 0, w, h);
      const rgba = context.getImageData(0, 0, w, h).data;
      if (steps) {
        for (let i = 0; i < rgba.length; i += 4) {
          for (let channel = 0; channel < 3; channel++) rgba[i + channel] = steps[rgba[i + channel]];
        }
      }
      const encoded = await encodePixels(indexed ? indexed.map(rgba) : rgba, w, h, indexed ? 1 : 4);
      if (!wroteDefault && indexed) output.push(makeChunk("PLTE", indexed.rgb), makeChunk("tRNS", indexed.alpha));
      if (fc && control) {
        fc.setUint32(0, w); fc.setUint32(4, h); fc.setUint32(8, x); fc.setUint32(12, y);
        output.push(makeChunk("fcTL", control, sequence++));
        frames++;
      }
      output.push(makeChunk(kind, encoded, kind === "fdAT" ? sequence++ : undefined));
      if (kind === "IDAT") wroteDefault = true;
    } finally { URL.revokeObjectURL(url); }
    parts = [];
    control = undefined;
  };
  for (const { type, start, end: chunkEnd } of chunks.slice(1)) {
    const payload = bytes.subarray(start + 8, chunkEnd - 4);
    if (type === "fcTL" || type === "IEND") {
      if (control && !parts.length) throw new Error("Invalid APNG frame data");
      await flush();
      if (type === "IEND") break;
      if (payload.length !== 26 || payload[24] > 2 || payload[25] > 1) throw new Error("Invalid APNG frame control");
      control = payload.slice(4);
    } else if (type === "IDAT" || type === "fdAT") {
      if (payload.length < (type === "fdAT" ? 4 : 0) || parts.length && kind !== type) throw new Error("Invalid APNG frame data");
      kind = type;
      parts.push(makeChunk("IDAT", payload.subarray(type === "fdAT" ? 4 : 0)));
    } else if (type === "acTL" && payload.length === 8) {
      expected = new DataView(bytes.buffer, start + 8).getUint32(0);
      output.push(bytes.subarray(start, chunkEnd));
    } else if (type === "PLTE" || type === "tRNS") {
      palette.push(bytes.subarray(start, chunkEnd));
    } else if (["cHRM", "gAMA", "iCCP", "sRGB", "pHYs"].includes(type) || !strip && metadata.includes(type)) {
      if (type === "iCCP" && [0, 4].includes(header[9])) continue;
      output.push(bytes.subarray(start, chunkEnd));
    }
  }
  if (!wroteDefault || !frames || frames !== expected) throw new Error("APNG 动画不完整");
  return new Blob([...output, end], { type: "image/png" });
}

export async function compressApng(file: Blob, options: {
  originalWidth: number; originalHeight: number; width: number; height: number;
  quality: number; stripMetadata: boolean; targetBytes: number; preventLarger: boolean;
}) {
  const { originalWidth, originalHeight, width, height, quality, stripMetadata, targetBytes, preventLarger } = options;
  let source: Awaited<ReturnType<typeof readApng>> | undefined;
  const encode = async (w: number, h: number, q: number) => {
    source ??= await readApng(file);
    return { blob: await transformApng(source, w, h, q, stripMetadata), width: w, height: h, keptOriginal: false };
  };
  const sameSize = width === originalWidth && height === originalHeight;
  const lossless = sameSize && quality === 100;
  let best = lossless
    ? { blob: await optimizeApng(file, stripMetadata), width, height, keptOriginal: false }
    : await encode(width, height, quality);
  best.keptOriginal = lossless && best.blob.size === file.size;
  if (targetBytes > 0 && best.blob.size > targetBytes) {
    const targetQuality = Math.min(quality, 20);
    if (targetQuality < quality) {
      const trial = await encode(width, height, targetQuality);
      if (trial.blob.size < best.blob.size) best = trial;
    }
    let w = width, h = height, size = best.blob.size;
    // With a byte cap the requested dimensions are the starting point.
    for (let i = 0; i < 16 && best.blob.size > targetBytes && (w > 1 || h > 1); i++) {
      const factor = Math.min(0.8, Math.max(0.1, Math.sqrt(targetBytes / size) * 0.92));
      w = Math.max(1, Math.floor(w * factor)); h = Math.max(1, Math.floor(h * factor));
      const trial = await encode(w, h, targetQuality);
      size = trial.blob.size;
      if (size < best.blob.size) best = trial;
    }
  }
  if (!lossless && preventLarger && sameSize && best.blob.size >= file.size) {
    const blob = await optimizeApng(file, stripMetadata);
    return { blob, width, height, keptOriginal: blob.size === file.size };
  }
  return best;
}
