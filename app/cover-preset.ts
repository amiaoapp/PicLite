import template from "./img2banner-template.html?raw";

type CoverResult = { blob: Blob; format: "jpeg" | "webp" | "png"; quality: number };
type CoverWindow = Window & { picLiteCover?: { render(source: string): Promise<CoverResult> } };

/** Use the actual cover editor so exports and quick covers render identically. */
export async function renderSavedCover(image: Blob): Promise<CoverResult> {
  if (!localStorage.getItem("piclite.cover-preset.v1")) {
    throw new Error("请先在“封面制作”中设置封面预设，参数会自动保存");
  }
  const frame = document.createElement("iframe");
  frame.dataset.coverRenderer = "true";
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:1024px;height:768px;visibility:hidden;pointer-events:none";
  const source = URL.createObjectURL(image);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const rendered = new Promise<CoverResult>((resolve, reject) => {
      frame.onload = () => {
        const engine = (frame.contentWindow as CoverWindow | null)?.picLiteCover;
        if (!engine) { reject(new Error("封面编辑器加载失败")); return; }
        engine.render(source).then(resolve, reject);
      };
      frame.srcdoc = template;
      document.body.append(frame);
    });
    const result = await Promise.race([rendered, new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error("封面生成超时，请检查预设背景图片")), 30000);
    })]);
    // Read the iframe-owned Blob before destroying its execution context.
    const bytes = await result.blob.arrayBuffer();
    return { ...result, blob: new Blob([bytes], { type: "image/png" }) };
  } finally {
    if (timeout) clearTimeout(timeout);
    frame.remove();
    URL.revokeObjectURL(source);
  }
}
