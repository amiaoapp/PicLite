/// <reference lib="webworker" />

import type { ExtendedImageRequest } from "./extended-images";

let magickPromise: Promise<typeof import("@imagemagick/magick-wasm")> | undefined;
async function magick() {
  magickPromise ??= (async () => {
    const api = await import("@imagemagick/magick-wasm");
    const { default: url } = await import("@imagemagick/magick-wasm/magick.wasm?url");
    await api.initializeImageMagick(new URL(url, self.location.href));
    api.ResourceLimits.memory = BigInt(256 * 1024 * 1024);
    api.ResourceLimits.width = BigInt(32768); api.ResourceLimits.height = BigInt(32768);
    api.ResourceLimits.area = BigInt(64 * 1024 * 1024);
    return api;
  })();
  return magickPromise;
}

export async function executeExtendedImage(request: ExtendedImageRequest) {
  if (request.operation === "svg") {
    const api = await import("svgo/browser");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(request.data);
    const optimized = api.optimize(text, { plugins: [
      "removeDoctype", "removeXMLProcInst", { name: "removeComments", params: { preservePatterns: ["^!"] } },
      ...(request.stripMetadata ? ["removeMetadata" as const] : []),
    ] }).data;
    return { data: new TextEncoder().encode(optimized), type: "image/svg+xml", width: 0, height: 0 };
  }
  const api = await magick();
  const formats = {
    "image/png": api.MagickFormat.Png, "image/jpeg": api.MagickFormat.Jpeg,
    "image/jfif": api.MagickFormat.Jpeg, "image/webp": api.MagickFormat.WebP,
    "image/avif": api.MagickFormat.Avif, "image/gif": api.MagickFormat.Gif,
    "image/bmp": api.MagickFormat.Bmp, "image/tiff": api.MagickFormat.Tiff,
    "image/x-icon": api.MagickFormat.Ico, "image/qoi": api.MagickFormat.Qoi,
    "image/x-tga": api.MagickFormat.Tga, "image/x-portable-pixmap": api.MagickFormat.Ppm,
    "image/x-portable-arbitrarymap": api.MagickFormat.Pam,
  };
  const format = formats[request.type as keyof typeof formats];
  if (!format) throw new Error(`不支持输出格式 ${request.type}`);
  const process = (image: import("@imagemagick/magick-wasm").IMagickImage) => {
    image.autoOrient();
    let width = request.width || image.width, height = request.height || image.height;
    if (request.type === "image/x-icon" && Math.max(width, height) > 256) {
      const ratio = 256 / Math.max(width, height);
      width = Math.max(1, Math.round(width * ratio)); height = Math.max(1, Math.round(height * ratio));
    }
    if (width * height > 64 * 1024 * 1024) throw new Error("图片超过 6400 万像素");
    if (image.width !== width || image.height !== height) {
      const geometry = new api.MagickGeometry(width, height);
      geometry.ignoreAspectRatio = true;
      image.resize(geometry);
    }
    image.quality = request.quality;
    if (request.stripMetadata) image.strip();
    const type = request.type === "image/jfif" ? "image/jpeg" : request.type;
    return image.write(format, bytes => ({ data: new Uint8Array(bytes), type, width: image.width, height: image.height }));
  };
  const inputFormat = formats[request.inputType as keyof typeof formats];
  return inputFormat ? api.ImageMagick.read(request.data, inputFormat, process) : api.ImageMagick.read(request.data, process);
}

self.onmessage = async (event: MessageEvent<ExtendedImageRequest>) => {
  try {
    const result = await executeExtendedImage(event.data);
    self.postMessage({ result }, { transfer: [result.data.buffer] });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
