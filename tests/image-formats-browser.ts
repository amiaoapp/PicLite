import { browserImagePreview, optimizeSvg, runExtendedImage } from "../app/extended-images";
import { CONVERSION_FORMATS } from "../app/image-formats";
import svg from "./fixtures/vector-features.svg?raw";

const lines: string[] = [];
const report = document.querySelector("#results")!;
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function pixels(blob: Blob) {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d")!; ctx.drawImage(image, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  } finally { URL.revokeObjectURL(url); }
}
try {
  const source = new File([svg], "vector.svg", { type: "image/svg+xml" });
  const optimized = await optimizeSvg(source, 96, 64, 96, 64, true);
  const originalPixels = await pixels(source), optimizedPixels = await pixels(optimized);
  assert(optimized.size < source.size, "SVG did not shrink");
  assert(originalPixels.data.every((value, i) => value === optimizedPixels.data[i]), "SVG rendered pixels changed");
  assert((await optimized.text()).includes("Original artwork attribution"), "license comment was lost");
  lines.push(`PASS SVG vector optimization: ${source.size} → ${optimized.size} bytes; identical pixels`);
  const resized = await optimizeSvg(source, 48, 32, 96, 64, false);
  const preview = await browserImagePreview(new File([resized], "resized.svg", { type: "image/svg+xml" }));
  assert(preview.width === 48 && preview.height === 32, "SVG resize dimensions wrong");
  assert((await resized.text()).includes("PicLite vector regression fixture"), "metadata toggle ignored");
  lines.push("PASS SVG resize and metadata retention");
  const canvas = document.createElement("canvas"); canvas.width = 400; canvas.height = 200;
  const ctx = canvas.getContext("2d")!; ctx.fillStyle = "#5a8ade"; ctx.fillRect(10, 10, 100, 100);
  const png = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), "image/png"));
  for (const format of CONVERSION_FORMATS.filter(f => f.value !== "image/svg+xml")) {
    const result = await runExtendedImage({ operation: "convert", data: new Uint8Array(await png.arrayBuffer()), type: format.value, width: 400, height: 200, quality: 80, stripMetadata: true });
    assert(result.data.byteLength > 0, `${format.label} empty output`);
    const file = new File([new Uint8Array(result.data)], `result.${format.extension}`, { type: result.type });
    const preview = await browserImagePreview(file);
    const expected = format.value === "image/x-icon" ? [256, 128] : [400, 200];
    assert(preview.width === expected[0] && preview.height === expected[1], `${format.label} dimensions: ${preview.width}×${preview.height}`);
    if (["image/png", "image/webp", "image/avif", "image/tiff", "image/qoi", "image/x-tga", "image/x-icon", "image/x-portable-arbitrarymap"].includes(format.value)) {
      assert((await pixels(preview.blob)).data[3] === 0, `${format.label} lost alpha`);
    }
    lines.push(`PASS ${format.label}: ${result.data.byteLength} bytes, ${preview.width}×${preview.height}, preview decoded`);
    report.textContent = lines.join("\n");
  }
  try {
    await optimizeSvg(new File(["<svg><bad>"], "bad.svg"), 1, 1, 1, 1, true);
    throw new Error("malformed SVG accepted");
  } catch (error) { assert(String(error).includes("无效"), "unexpected malformed SVG error"); }
  lines.push("PASS malformed SVG rejected");
  document.body.dataset.result = "pass";
} catch (error) {
  lines.push(`FAIL ${error instanceof Error ? error.stack : error}`);
  document.body.dataset.result = "fail";
} finally { report.textContent = lines.join("\n"); }
