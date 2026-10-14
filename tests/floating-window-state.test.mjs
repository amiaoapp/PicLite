import assert from "node:assert/strict";
import test from "node:test";
import { FloatingIconDrag, rememberFloatingSize } from "../desktop/floating-window-state.ts";

test("a dragged logo stays folded, including when the native release skips intermediate movement events", () => {
  const click = new FloatingIconDrag(100, 200);
  assert.equal(click.move(102, 202), null);
  assert.equal(click.dragged, false);
  const drag = new FloatingIconDrag(100, 200);
  assert.deepEqual(drag.move(150, 240), { x: 50, y: 40 });
  assert.equal(drag.dragged, true);
  assert.equal(drag.move(150, 240), null);
  assert.deepEqual(drag.move(160, 230), { x: 10, y: -10 });
  assert.deepEqual(drag.move(100, 200), { x: -60, y: -30 });
  assert.equal(drag.dragged, true, "returning to the origin must still suppress the click");
});

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
