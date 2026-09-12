import test from "node:test";
import assert from "node:assert/strict";

import {
  isRequestedMimeType,
  isSmartCompressionWorthwhile,
  minimumSmartSavingsBytes,
  smartCandidateOutputFormats,
} from "../app/compression-policy.ts";

test("rejects a WebView encoder fallback that labels PNG bytes as requested WebP", () => {
  assert.equal(isRequestedMimeType("image/webp", "image/webp"), true);
  assert.equal(isRequestedMimeType("image/png", "image/webp"), false);
  assert.equal(isRequestedMimeType("image/jpg", "image/jpeg"), true);
});

test("smart modes measure WebP when format selection is automatic", () => {
  assert.deepEqual(smartCandidateOutputFormats("keep"), ["keep", "image/webp"]);
  assert.deepEqual(smartCandidateOutputFormats("image/png"), ["image/png"]);
});

test("smart balance keeps tiny images when savings do not justify quality loss", () => {
  const original = 4_710;
  const marginalResult = 4_587;

  assert.equal(minimumSmartSavingsBytes(original, "balanced"), 256);
  assert.equal(isSmartCompressionWorthwhile(original, marginalResult, "balanced"), false);
});

test("smart balance accepts a meaningfully smaller result", () => {
  assert.equal(isSmartCompressionWorthwhile(100_000, 94_999, "balanced"), true);
  assert.equal(isSmartCompressionWorthwhile(100_000, 95_001, "balanced"), false);
});

test("smaller-files mode uses a more aggressive savings threshold", () => {
  assert.equal(isSmartCompressionWorthwhile(100_000, 97_999, "small"), true);
  assert.equal(isSmartCompressionWorthwhile(100_000, 98_001, "small"), false);
});
