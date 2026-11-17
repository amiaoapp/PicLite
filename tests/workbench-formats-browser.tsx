import React from "react";
import { createRoot } from "react-dom/client";
import { PicLiteApp } from "../app/piclite-app";
import fixtureSvg from "./fixtures/vector-features.svg?raw";
import "../app/globals.css";
import "../app/studio.css";
const lines: string[] = [], report = document.querySelector("#results")!;
const wait = async (condition: () => boolean) => {
  const start = performance.now();
  while (!condition()) { if (performance.now() - start > 30000) throw new Error(`Timed out: ${document.querySelector(".item-status")?.textContent}`); await new Promise(requestAnimationFrame); }
};
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
const hero = new URLSearchParams(location.search).has("hero");
const svg = hero ? await (await fetch("/__hero.svg")).text() : fixtureSvg;
const initialWidth = hero ? 1200 : 96, initialHeight = hero ? 420 : 64;
const previousSettings = localStorage.getItem("piclite.compressionSettings.v2");
localStorage.setItem("piclite.compressionSettings.v2", JSON.stringify({format:"keep",scale:100,targetSizeKb:200,mode:"balanced",quality:82}));
const app = createRoot(document.querySelector("#root")!);
app.render(<PicLiteApp />);
try {
  await wait(() => !!document.querySelector('input[type="file"]'));
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  const transfer = new DataTransfer(); transfer.items.add(new File([svg], hero ? "hero.svg" : "vector.svg", {type:"image/svg+xml"}));
  input.files = transfer.files; input.dispatchEvent(new Event("change", {bubbles:true}));
  await wait(() => !!document.querySelector(".item-status.done"));
  const output = document.querySelector<HTMLImageElement>('img[alt="优化后预览"]')!;
  assert(output, "Workbench result preview is missing");
  const result = await (await fetch(output.src)).blob();
  assert(result.type === "image/svg+xml", "Workbench converted vectors to bitmap by default");
  assert(result.size <= new Blob([svg]).size, "SVG size guard returned a larger untransformed result");
  if (!hero) assert((await result.text()).includes("Original artwork attribution"), "Workbench lost attribution");
  lines.push(`PASS workbench file import → SVG vector optimization → actual result ${result.size} bytes`);
  assert(document.querySelector<HTMLInputElement>("#quality-range")!.disabled, "SVG offers a non-functional quality slider");
  assert(document.querySelector<HTMLInputElement>("#target-size-input")!.disabled, "SVG promises an unsupported byte target");
  assert([...document.querySelectorAll<HTMLButtonElement>(".mode-grid button")].every(button => button.disabled), "SVG offers non-functional raster presets");
  const scale = document.querySelector<HTMLInputElement>("#scale-range")!;
  const beforeResize = output.src;
  // Use the native value setter so React observes the same input as a slider drag.
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(scale, "42.5");
  scale.dispatchEvent(new Event("input", {bubbles:true})); scale.dispatchEvent(new Event("change", {bubbles:true}));
  await wait(() => !!document.querySelector(".item-status.done") && document.querySelector<HTMLImageElement>('img[alt="优化后预览"]')?.src !== beforeResize);
  const resized = document.querySelector<HTMLImageElement>('img[alt="优化后预览"]')!;
  const resizedBlob = await (await fetch(resized.src)).blob();
  const xml = new DOMParser().parseFromString(await resizedBlob.text(), "image/svg+xml");
  const width = Math.round(initialWidth * .425), height = Math.round(initialHeight * .425);
  assert(Number(xml.documentElement.getAttribute("width")) === width && Number(xml.documentElement.getAttribute("height")) === height, "Exported SVG dimensions were not updated");
  assert(document.querySelector(".svg-output-dimensions")!.textContent!.includes(`${width} × ${height}`), "Actual SVG dimensions are not displayed");
  lines.push(`PASS SVG resize: ${initialWidth}×${initialHeight} → ${width}×${height}; ${result.size} → ${resizedBlob.size} bytes; actual dimensions displayed`);
  lines.push("PASS vector output disables bitmap quality, byte target and quick modes");
  const before = resized.src;
  const select = document.querySelector<HTMLSelectElement>("#output-format")!;
  select.value = "image/png"; select.dispatchEvent(new Event("change", {bubbles:true}));
  await wait(() => !!document.querySelector(".item-status.done") && document.querySelector<HTMLImageElement>('img[alt="优化后预览"]')?.src !== before);
  const pngImage = document.querySelector<HTMLImageElement>('img[alt="优化后预览"]')!;
  const png = await (await fetch(pngImage.src)).blob();
  assert(png.type === "image/png", "SVG → PNG did not produce PNG");
  const bitmap = await createImageBitmap(png);
  assert(bitmap.width === width && bitmap.height === height, "SVG → PNG dimensions changed"); bitmap.close();
  assert(!document.querySelector<HTMLInputElement>("#quality-range")!.disabled && !document.querySelector<HTMLInputElement>("#target-size-input")!.disabled, "Bitmap controls did not return after format conversion");
  lines.push(`PASS SVG → PNG: ${width}×${height}, bitmap controls enabled and target applies`);
  document.body.dataset.result = "pass";
} catch (error) { lines.push(`FAIL ${error instanceof Error ? error.stack : error}`); document.body.dataset.result = "fail"; }
finally { report.textContent = lines.join("\n"); if (previousSettings === null) localStorage.removeItem("piclite.compressionSettings.v2"); else localStorage.setItem("piclite.compressionSettings.v2", previousSettings); }
