import assert from "node:assert/strict";
import test from "node:test";
import { rememberFloatingSize } from "../desktop/floating-window-state.ts";

test("folding and restoring keep the saved expanded size; later user resizing is remembered", () => {
  let saved = { floatingWidth: 420, floatingHeight: 310, unrelatedSetting: "keep" };
  const original = saved;
  saved = rememberFloatingSize(saved, { width: 64, height: 64 }, true);
  saved = rememberFloatingSize(saved, { width: 246, height: 188 }, true);
  saved = rememberFloatingSize(saved, { width: 64, height: 64 }, false);
  saved = rememberFloatingSize(saved, { width: 420, height: 310 }, false);
  assert.equal(saved, original);
  saved = rememberFloatingSize(saved, { width: 500, height: 360 }, false);
  assert.deepEqual(saved, { floatingWidth: 500, floatingHeight: 360, unrelatedSetting: "keep" });
});
