// Shared by the desktop and browser conversion tools. SVG output preserves
// existing vectors; this is deliberately not a raster tracing operation.
export const CONVERSION_FORMATS = [
  { value: "image/webp", label: "WebP", extension: "webp" },
  { value: "image/jpeg", label: "JPEG", extension: "jpg" },
  { value: "image/jfif", label: "JFIF", extension: "jfif" },
  { value: "image/png", label: "PNG", extension: "png" },
  { value: "image/avif", label: "AVIF", extension: "avif" },
  { value: "image/gif", label: "GIF", extension: "gif" },
  { value: "image/bmp", label: "BMP", extension: "bmp" },
  { value: "image/tiff", label: "TIFF", extension: "tiff" },
  { value: "image/x-icon", label: "ICO (≤ 256px)", extension: "ico" },
  { value: "image/qoi", label: "QOI", extension: "qoi" },
  { value: "image/x-tga", label: "TGA", extension: "tga" },
  { value: "image/x-portable-pixmap", label: "PPM", extension: "ppm" },
  { value: "image/x-portable-arbitrarymap", label: "PAM", extension: "pam" },
  { value: "image/svg+xml", label: "SVG → SVG", extension: "svg" },
] as const;
export type ConversionFormat = typeof CONVERSION_FORMATS[number]["value"];
export type ImageOutputFormat = "keep" | ConversionFormat;
export const SUPPORTED_IMAGE_PATH = /\.(?:jpe?g|jfif|a?png|webp|avif|gif|heic|heif|svg|bmp|tiff?|ico|qoi|tga|ppm|pam)$/i;
export const IMAGE_INPUT_ACCEPT = "image/*,.apng,.jfif,.heic,.heif,.svg,.tif,.tiff,.ico,.qoi,.tga,.ppm,.pam";
export function imageMime(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "jpeg" || ext === "jfif") return "image/jpeg";
  if (ext === "apng") return "image/png";
  if (ext === "tif") return "image/tiff";
  if (ext === "heic" || ext === "heif") return `image/${ext}`;
  if (["pbm", "pgm", "pnm"].includes(ext || "")) return "image/x-portable-anymap";
  return CONVERSION_FORMATS.find(format => format.extension === ext)?.value || "application/octet-stream";
}
export function imageExtension(type: string) {
  return CONVERSION_FORMATS.find(format => format.value === type)?.extension;
}
export function preservesSvg(file: { name: string; type: string }, format: ImageOutputFormat) {
  return isSvg(file) && (format === "keep" || format === "image/svg+xml");
}
export function isSvg(file: { name: string; type: string }) {
  return file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
}
