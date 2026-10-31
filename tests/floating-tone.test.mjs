import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { classifyFloatingPixels, loadFloatingTone, getCachedFloatingTone } from "../desktop/floating-tone.ts";

const pixel = (r, g = r, b = r, a = 255) => new Uint8ClampedArray([r, g, b, a]);

test("light pixels request dark controls; dark pixels request light controls", () => {
  assert.equal(classifyFloatingPixels(pixel(255)), "light");
  assert.equal(classifyFloatingPixels(pixel(0)), "dark");
  assert.equal(classifyFloatingPixels(pixel(128)), "light", "middle gray already favors dark text");
  assert.equal(classifyFloatingPixels(pixel(117)), "dark");
  assert.equal(classifyFloatingPixels(pixel(118)), "light");
});

test("uses linear relative luminance and averages all sampled pixels", () => {
  assert.equal(classifyFloatingPixels(pixel(255, 0, 0)), "light");
  assert.equal(classifyFloatingPixels(pixel(0, 0, 255)), "dark");
  assert.equal(classifyFloatingPixels(new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255])), "light");
});

test("transparent pixels composite over neutral gray, independent of hidden RGB", () => {
  assert.equal(classifyFloatingPixels(pixel(255, 255, 255, 0)), "light");
  assert.equal(classifyFloatingPixels(pixel(0, 0, 0, 0)), "light");
  assert.equal(classifyFloatingPixels(pixel(0, 0, 0, 128)), "dark");
  assert.equal(classifyFloatingPixels(new Uint8ClampedArray()), "dark");
});

test("source sampling is bounded, shared, cached and falls back on errors", async () => {
  const images = [];
  const canvases = [];
  const oldImage = globalThis.Image;
  const oldDocument = globalThis.document;
  globalThis.Image = class {
    naturalWidth = 12000;
    naturalHeight = 6000;
    set src(value) { this.source = value; images.push(this); }
  };
  globalThis.document = { createElement: () => {
    const canvas = { width: 0, height: 0, getContext: () => ({
      drawImage: (...args) => { canvas.draw = args; },
      getImageData: () => ({ data: pixel(255) }),
    }) };
    canvases.push(canvas);
    return canvas;
  } };
  try {
    const first = loadFloatingTone("test:large");
    assert.equal(loadFloatingTone("test:large"), first);
    assert.equal(images.length, 1);
    images[0].onload();
    assert.equal(await first, "light");
    assert.equal(getCachedFloatingTone("test:large"), "light");
    assert.equal(await loadFloatingTone("test:large"), "light");
    assert.equal(images.length, 1, "cached images must not decode again");
    assert.equal(canvases[0].width, 32);
    assert.equal(canvases[0].height, 16);
    assert.deepEqual(canvases[0].draw.slice(1), [0, 0, 32, 16]);
    const failed = loadFloatingTone("test:failed");
    images[1].onerror();
    assert.equal(await failed, "dark");
    assert.equal(await loadFloatingTone(undefined), "dark");
    globalThis.document.createElement = () => { throw new Error("canvas unavailable"); };
    const tainted = loadFloatingTone("test:tainted");
    images[2].onload();
    assert.equal(await tainted, "dark");
  } finally {
    globalThis.Image = oldImage;
    globalThis.document = oldDocument;
  }
});

test("hook isolates source races, resets missing sources and ignores unmounted work", async () => {
  // A tiny effect/state runner exercises the production hook without a browser dependency.
  const source = await readFile(new URL("../desktop/use-floating-tone.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const jobs = new Map();
  const cache = new Map();
  let state;
  let dependencies;
  let cleanup;
  let nextEffect;
  let writes = 0;
  const exports = {};
  const react = {
    useState: (initial) => {
      if (state === undefined) state = typeof initial === "function" ? initial() : initial;
      return [state, (value) => { state = value; writes++; }];
    },
    useEffect: (effect, deps) => {
      if (!dependencies || deps.some((value, index) => value !== dependencies[index])) {
        dependencies = deps;
        nextEffect = effect;
      }
    },
  };
  new Function("require", "exports", compiled)((name) => name === "react" ? react : {
    getCachedFloatingTone: (src) => cache.get(src),
    loadFloatingTone: (src) => new Promise((resolve) => jobs.set(src, resolve)),
  }, exports);
  const render = (src) => {
    const tone = exports.useFloatingTone(src);
    if (nextEffect) { cleanup?.(); cleanup = nextEffect(); nextEffect = undefined; }
    return tone;
  };
  assert.equal(render("old"), "dark");
  assert.equal(render("new"), "dark");
  jobs.get("new")("light");
  await Promise.resolve();
  assert.equal(render("new"), "light");
  jobs.get("old")("dark");
  await Promise.resolve();
  assert.equal(render("new"), "light", "late old source cannot overwrite current tone");
  assert.equal(render(undefined), "dark");
  cache.set("cached", "light");
  assert.equal(render("cached"), "light", "cached tone is available on the first render");
  assert.equal(render("unmounted"), "dark");
  cleanup?.();
  const before = writes;
  jobs.get("unmounted")("light");
  await Promise.resolve();
  assert.equal(writes, before, "unmounted hooks cannot update state");
});
