import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
const css=await readFile(new URL("../desktop/floating-adaptive.css",import.meta.url),"utf8");
const app=await readFile(new URL("../desktop/clop-desktop-app.tsx",import.meta.url),"utf8");
const card=app.slice(app.indexOf("function resultFormat"),app.indexOf("export function FloatingResults"));
const desktopCss=await readFile(new URL("../desktop/clop-desktop.css",import.meta.url),"utf8");
test("image tone explicitly styles crop, format, compression mode and footer buttons",()=>{
 for(const [name,selector] of [["crop",".floating-results[data-image-tone] .integrated-result-card .floating-card-bottom>.crop-window-trigger"],["formats",".floating-results[data-image-tone] .integrated-result-card .floating-card-formats button"],["smart compression",".floating-results[data-image-tone].has-image .floating-footer .automatic-badge"],["footer actions",".floating-results[data-image-tone].has-image .floating-footer button"],["inverse glyphs","color:var(--overlay-button-ink)"]])assert.ok(css.includes(selector),name);
});
test("classic mode retains original card information and dedicated image surface",()=>{
 assert.ok(card.includes("classic-result-card"));assert.ok(app.includes("classic-floating-footer"));assert.ok(card.includes("<strong className=\"result-name\" title={fileName(item.source)}>{fileName(item.source)}</strong>")); assert.ok(card.includes("<Icon name=\"image\"/> {item.width.toLocaleString()} × {item.height.toLocaleString()}"));assert.match(card, /<FormatBar value=\{item\.formatChoice\s*===\s*"auto"\s*\?\s*"auto"\s*:\s*format\}\s*update=\{updateFormat\}\s*\/>/);assert.ok(css.includes(".classic-result-card .result-overlay"));assert.ok(desktopCss.includes(".result-card.full .result-preview"));
});
