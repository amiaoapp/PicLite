import { imageMime, isSvg } from "./image-formats";

export type ExtendedImageRequest = {
  operation: "svg" | "convert";
  data: Uint8Array;
  type: string;
  inputType?: string;
  quality: number;
  stripMetadata: boolean;
  width?: number;
  height?: number;
};
type ExtendedImageResult = { data: Uint8Array; type: string; width: number; height: number };

// Each job owns its worker: a timeout actually stops WASM rather than leaving
// a blocked encoder running. Existing JPEG/PNG/WebP processing never uses it.
export async function runExtendedImage(request: ExtendedImageRequest): Promise<ExtendedImageResult> {
  if (request.data.byteLength > 256 * 1024 * 1024) throw new Error("图片超过 256 MB");
  const worker = new Worker(new URL("./extended-image-worker.ts", import.meta.url), { type: "module" });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { worker.terminate(); reject(new Error("格式处理超时，请尝试更小的图片")); }, 60000);
    const finish = () => { clearTimeout(timer); worker.terminate(); };
    worker.onmessage = event => { finish(); if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.result); };
    worker.onerror = event => { finish(); reject(new Error(event.message || "图片格式处理失败")); };
    worker.postMessage(request);
  });
}

export async function browserImagePreview(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  // Browser image decoders do not consistently handle SVG, TIFF, QOI or TGA.
  if (isSvg(file)) {
    const blob = new Blob([file], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image(); image.src = url;
      await image.decode();
      if (!image.naturalWidth || !image.naturalHeight) throw new Error("SVG 没有有效尺寸");
      return { blob, width: image.naturalWidth, height: image.naturalHeight };
    } finally { URL.revokeObjectURL(url); }
  }
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const result = { blob: file as Blob, width: bitmap.width, height: bitmap.height }; bitmap.close();
    return result;
  } catch {
    const result = await runExtendedImage({ operation: "convert", data: new Uint8Array(await file.arrayBuffer()), inputType: imageMime(file.name), type: "image/png", quality: 100, stripMetadata: false });
    return { blob: new Blob([new Uint8Array(result.data)], { type: result.type }), width: result.width, height: result.height };
  }
}

export async function optimizeSvg(file: File, width: number, height: number, originalWidth: number, originalHeight: number, stripMetadata: boolean) {
  let text = await file.text();
  const document = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = document.documentElement;
  if (root.localName !== "svg" || document.querySelector("parsererror")) throw new Error("SVG 文件无效");
  if (width !== originalWidth || height !== originalHeight) {
    if (!root.hasAttribute("viewBox")) root.setAttribute("viewBox", `0 0 ${originalWidth} ${originalHeight}`);
    root.setAttribute("width", String(width)); root.setAttribute("height", String(height));
    text = new XMLSerializer().serializeToString(document);
  }
  const result = await runExtendedImage({ operation: "svg", data: new TextEncoder().encode(text), type: "image/svg+xml", quality: 100, stripMetadata });
  return new Blob([new Uint8Array(result.data)], { type: "image/svg+xml" });
}

export function needsExtendedDecoder(file: File) {
  return /\.(?:tiff?|ico|qoi|tga|ppm|pam)$/i.test(file.name) || /^(?:image\/(?:tiff|qoi|x-tga|x-icon)|image\/x-portable-)/i.test(file.type || imageMime(file.name));
}
