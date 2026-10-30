import assert from "node:assert/strict";
import test from "node:test";
import { applyMaterialPreference, parseMaterialPreference, readMaterialPreference, setMaterialPreference, MATERIAL_STORAGE_KEY } from "../app/material-preference.ts";

test("malformed and older preferences retain the opt-in default", () => {
  for (const raw of [null, "{", "null", "[]", '{"material":"invalid","transparency":"force"}']) {
    assert.deepEqual(parseMaterialPreference(raw), { material: "standard", transparency: "system" });
  }
});
test("glass preserves an explicit reduced-transparency choice", () => {
  assert.deepEqual(parseMaterialPreference('{"material":"glass","transparency":"reduce","quality":50}'), { material: "glass", transparency: "reduce" });
});
test("the OS accessibility preference cannot be overridden by system mode", () => {
  const root = { dataset: { theme: "dark", palette: "mist" } };
  applyMaterialPreference(root, { material: "glass", transparency: "system" }, true);
  assert.deepEqual(root.dataset, { theme: "dark", palette: "mist", material: "glass", transparency: "reduce" });
  applyMaterialPreference(root, { material: "glass", transparency: "reduce" }, false);
  assert.equal(root.dataset.transparency, "reduce");
  applyMaterialPreference(root, { material: "standard", transparency: "system" }, false);
  assert.equal(root.dataset.transparency, "full");
  assert.equal(root.dataset.material, "standard");
});
test("material persistence touches only its own key and still works with storage blocked", () => {
  const original = globalThis.window;
  const data = new Map([["compression", "untouched"]]);
  const target = new EventTarget();
  target.localStorage = { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) };
  globalThis.window = target;
  try {
    setMaterialPreference({ material: "glass" });
    setMaterialPreference({ transparency: "reduce" });
    assert.equal(data.get("compression"), "untouched");
    assert.deepEqual(JSON.parse(data.get(MATERIAL_STORAGE_KEY)), { material: "glass", transparency: "reduce" });
    target.localStorage = { getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); } };
    setMaterialPreference({ material: "standard" });
    assert.deepEqual(readMaterialPreference(), { material: "standard", transparency: "reduce" });
  } finally { if (original === undefined) delete globalThis.window; else globalThis.window = original; }
});
