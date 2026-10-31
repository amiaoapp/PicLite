import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { applyMaterialPreference, parseMaterialPreference, readMaterialPreference, setMaterialPreference, MATERIAL_STORAGE_KEY } from "../app/material-preference.ts";

const standard = { material: "standard", transparency: "system" };
test("legacy glass and transparency preferences normalize to standard", () => {
  for (const raw of [null, "{", "null", "[]", '{"material":"invalid"}', '{"material":"glass","transparency":"reduce"}', '{"material":"glass","transparency":"system"}']) {
    assert.deepEqual(parseMaterialPreference(raw), standard);
  }
});
test("reading saved glass persists migration without touching other settings", () => {
  const original = globalThis.window;
  const data = new Map([[MATERIAL_STORAGE_KEY, '{"material":"glass","transparency":"reduce"}'], ["compression", "untouched"]]);
  const target = new EventTarget();
  target.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  globalThis.window = target;
  try {
    assert.deepEqual(readMaterialPreference(), standard);
    assert.deepEqual(JSON.parse(data.get(MATERIAL_STORAGE_KEY)), standard);
    setMaterialPreference({ material: "glass", transparency: "reduce" });
    assert.deepEqual(JSON.parse(data.get(MATERIAL_STORAGE_KEY)), standard);
    assert.equal(data.get("compression"), "untouched");
    target.localStorage = { getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); } };
    setMaterialPreference({ material: "glass" });
    assert.deepEqual(readMaterialPreference(), standard);
  } finally { if (original === undefined) delete globalThis.window; else globalThis.window = original; }
});
test("compatibility presentation is opaque and preserves theme and palette", () => {
  const root = { dataset: { theme: "dark", palette: "white", material: "glass", nativeMaterial: "glass" } };
  for (const reduced of [false, true]) {
    applyMaterialPreference(root, { material: "glass", transparency: "system" }, reduced);
    assert.deepEqual(root.dataset, { theme: "dark", palette: "white", material: "standard", transparency: "reduce", nativeMaterial: "none" });
  }
});
test("removed controls, CSS injection and native material allocation stay removed", () => {
  const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
  assert.doesNotMatch(read('app/liquid-glass-theme.tsx'), /import\s+["']\.\/liquid-glass\.css|enabled\s*[:,]\s*true/);
  assert.doesNotMatch(read('app/appearance-menu.tsx'), /useMaterialPreference|Liquid Glass|液态玻璃|Reduce transparency|减少透明/);
  assert.doesNotMatch(read('app/cover-material.ts'), /liquid-glass\.css|glassCss|data-material/);
  assert.doesNotMatch(read('src-tauri/src/native_material.rs'), /NSGlassEffectView|NSVisualEffectView|make_material|fit_material|enabled:\s*true/);
});
