import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("renders the PicLite product shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>PicLite 图轻/);
  assert.match(html, /压缩工作台/);
  assert.match(html, /classic-shell/);
  assert.match(html, /界面样式/);
  assert.match(html, /经典旧版/);
  assert.match(html, /新版界面/);
  assert.doesNotMatch(html, />文件夹监测</);
  assert.doesNotMatch(html, />批量重命名</);
  assert.match(html, /导入文件夹/);
  assert.match(html, /目标文件大小/);
  assert.match(html, /本地处理，图片不上传/);
  assert.match(html, /画质 \/ 编码质量/);
  assert.match(html, /等比例尺寸/);
  assert.match(html, /继续减半/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});
