import React from "react";
import { createRoot } from "react-dom/client";
import { FloatingResults } from "../desktop/clop-desktop-app";
import { DEFAULT_SETTINGS, saveSettings } from "../desktop/clop-store";
import { floatingAlphaMask } from "../desktop/floating-appearance";
import type { PicLiteBridge, QuickCompressResult } from "../desktop/clop-types";
import "../app/globals.css";
import "../desktop/clop-desktop.css";
import "../desktop/floating-result-editor.css";
import "../desktop/floating-adaptive.css";

const lines: string[] = [], report = document.querySelector("#results")!;
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
const wait = async (condition: () => boolean) => {
  const start = performance.now();
  while (!condition()) { if (performance.now() - start > 5000) throw new Error("Timed out"); await new Promise(requestAnimationFrame); }
};
const copied: string[] = [];
let dropped: ((event: { type: string; paths: string[] }) => void) | undefined;
let finish: ((result: QuickCompressResult[]) => void) | undefined;
const api = new Proxy({
  platform: "win32", windowLabel: "dropzone",
  getFloatingPointerPosition: undefined,
  getFloatingCollapsed: async () => false,
  takePendingClipboard: async () => null,
  listSystemFonts: async () => [],
  getSystemFonts: async () => [],
  onFileDrop: (handler: typeof dropped) => { dropped = handler; return () => { dropped = undefined; }; },
  quickCompressPaths: () => new Promise<QuickCompressResult[]>(resolve => { finish = resolve; }),
  // Deliberately never resolves: copying and done state must not wait for previews.
  readImagesFromPaths: () => new Promise(() => {}),
  copyImagePath: async (path: string) => { copied.push(path); },
}, { get(target, key) {
  if (key in target) return target[key as keyof typeof target];
  return String(key).startsWith("on") ? () => () => {} : async () => undefined;
} }) as unknown as PicLiteBridge;

const settings = { ...DEFAULT_SETTINGS, autoCopyDropResults: false, autoHideResults: false, updateCheckFrequency: "never" as const };
const keys = ["piclite.desktop.clop-settings.v1", "piclite.desktopPreferences.v1"];
const saved = keys.map(key => localStorage.getItem(key));
saveSettings(settings);
document.documentElement.classList.add("dropzone-root");
const root = createRoot(document.querySelector("#root")!);
root.render(<React.StrictMode><FloatingResults api={api} /></React.StrictMode>);
try {
  await wait(() => !!dropped);
  dropped!({type: "drop", paths: ["C:/source.png"]});
  await wait(() => !!finish);
  finish!([{ source: "C:/source.png", output: "C:/compressed.webp", originalBytes: 1000000, outputBytes: 200000, keptOriginal: false }]);
  finish = undefined;
  await wait(() => !!document.querySelector(".result-card.done"));
  await new Promise(requestAnimationFrame);
  assert(copied.length === 0, "disabled automatic copy wrote clipboard");
  lines.push("PASS switch defaults off; result ready even while preview is stalled");
  saveSettings({ ...settings, autoCopyDropResults: true });
  await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
  assert(copied.length === 0, "enabling the switch copied an old result");
  dropped!({type: "drop", paths: ["C:/source2.png", "C:/source3.png", "C:/failed.png"]});
  await wait(() => !!finish);
  finish!([
    { source: "C:/source2.png", output: "C:/compressed2.webp", originalBytes: 900000, outputBytes: 180000, keptOriginal: false },
    { source: "C:/source3.png", output: "C:/compressed3.webp", originalBytes: 800000, outputBytes: 170000, keptOriginal: false },
    { source: "C:/failed.png", error: "test error", keptOriginal: false },
  ]);
  await wait(() => copied.length > 0);
  assert(copied.length === 1 && copied[0] === "C:/compressed3.webp", "batch did not copy exact last successful output once");
  lines.push("PASS automatic batch copy uses final compressed output once, independent of previews");
  const floating = document.querySelector<HTMLElement>(".floating-results")!;
  assert(getComputedStyle(floating).maskImage.includes("data:image/svg+xml"), "Windows outer alpha mask was not applied");
  assert(getComputedStyle(floating).borderRadius === "0px", "duplicate outer border-radius clip");
  lines.push("PASS Windows CSS branch applies one alpha mask across images and hover controls");
  // Inspect actual SVG rasterisation at common Windows DPI scales.
  for (const scale of [1, 1.25, 1.5, 2]) {
    const css = floatingAlphaMask(320, 230, 24), image = new Image();
    image.src = css.slice(5, -2); await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = 320 * scale; canvas.height = 230 * scale;
    const context = canvas.getContext("2d")!; context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const alpha = (x: number, y: number) => data[(y * canvas.width + x) * 4 + 3];
    assert(alpha(0, 0) === 0, `opaque corner at scale ${scale}`);
    assert(alpha(Math.floor(canvas.width / 2), 0) === 255, `unexpected inset at scale ${scale}`);
    let partial = 0;
    const corner = Math.ceil(24 * scale);
    for (let y = 0; y < corner; y++) for (let x = 0; x < corner; x++) if (alpha(x,y) > 0 && alpha(x,y) < 255) partial++;
    assert(partial >= 16, `binary jagged edge at scale ${scale}`);
    lines.push(`PASS ${scale * 100}% DPI: transparent corners and ${partial} antialiased edge pixels`);
  }
  document.body.dataset.result = "pass";
} catch (error) {
  lines.push(`FAIL ${error instanceof Error ? error.stack : error}`); document.body.dataset.result = "fail";
} finally {
  report.textContent = lines.join("\n");
  keys.forEach((key, i) => saved[i] === null ? localStorage.removeItem(key) : localStorage.setItem(key, saved[i]!));
}
