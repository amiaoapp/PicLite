import { useRef, useState } from "react";
import type { ImageFormat, Language, OptimisationPreset, PicLiteBridge } from "./clop-types";
import { tr } from "./clop-store";
import { cropFromDrag, editorCompressionSettings } from "./floating-editor-model";
import "./floating-result-editor.css";

type Props = {
  api: PicLiteBridge; path: string; preview?: string; width?: number; height?: number;
  language: Language; format?: string; quality: number; canUndo: boolean;
  process: (settings: Partial<OptimisationPreset>, source?: string) => Promise<void>;
  undo: () => void; notify: (message: string, tone?: "error" | "success") => void;
};

export function FloatingResultEditor(p: Props) {
  const [open, setOpen] = useState(false);
  const [cropMode, setCropMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [quality, setQuality] = useState(p.quality);
  const [format, setFormat] = useState<ImageFormat>(["jpeg", "png", "webp"].includes(p.format || "") ? p.format as ImageFormat : "keep");
  const [crop, setCrop] = useState({x: 0, y: 0, width: p.width || 1, height: p.height || 1});
  const [size, setSize] = useState({width: p.width || 1, height: p.height || 1});
  const start = useRef<{x: number; y: number} | null>(null);
  const label = (zh: string, en: string) => tr(p.language, zh, en);
  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try { await action(); } catch (e) { p.notify(String(e), "error"); } finally { setBusy(false); }
  };
  const save = () => run(async () => {
    const folder = await p.api.selectFolder("export");
    if (!folder) return;
    const output = await p.api.saveFloatingResult(p.path, folder);
    p.notify(label("已保存副本：", "Copy saved: ") + output);
  });
  const apply = () => run(async () => {
    let source: string | undefined;
    if (cropMode) source = await p.api.editFloatingImage(p.path, {...crop, outputWidth: size.width, outputHeight: size.height});
    await p.process(editorCompressionSettings(quality, format), source);
    setCropMode(false);
    setOpen(false);
  });
  const point = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height};
  };
  return <div className="floating-editor" onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()} onContextMenu={e => {e.preventDefault(); e.stopPropagation(); setOpen(true);}}>
    <div className="floating-editor-toolbar" aria-label={label("结果工具栏", "Result toolbar")}>
      <button onClick={() => {setOpen(!open); setCropMode(true);}} disabled={busy || !p.preview || !p.width} title={label("裁剪与调整尺寸", "Crop and resize")}>⌗ {label("裁剪", "Crop")}</button>
      <button onClick={() => {setOpen(!open); setCropMode(false);}} aria-expanded={open}>⚙ {label("质量", "Quality")}</button>
      <button disabled={busy} onClick={() => void run(() => p.api.copyImagePath(p.path))}>{label("复制", "Copy")}</button>
      <button disabled={busy} onClick={() => void save()}>{label("另存", "Save copy")}</button>
      <button disabled={busy || !p.canUndo} onClick={p.undo}>{label("撤销", "Undo")}</button>
      <button onClick={() => setOpen(!open)} aria-label={label("更多操作", "More actions")}>•••</button>
    </div>
    {open && <section className="floating-editor-panel" aria-label={label("编辑结果", "Edit result")} onKeyDown={e => { if(e.key === "Escape") setOpen(false); }}>
      <div className="floating-editor-menu" role="menu">
        <button role="menuitem" onClick={() => void run(() => p.api.openImage(p.path))}>{label("打开预览", "Open preview")}</button>
        <button role="menuitem" onClick={() => void run(() => p.api.revealPath(p.path))}>{label("在文件夹显示", "Reveal in folder")}</button>
        <button role="menuitem" onClick={() => {setCropMode(!cropMode);}} disabled={!p.width}>{label("裁剪 / 尺寸", "Crop / resize")}</button>
      </div>
      {cropMode && p.preview && p.width && p.height && <>
        <p>{label("在图上拖动选择裁剪区域。动图裁剪暂不支持。", "Drag on the image to crop. Animation cropping is unavailable.")}</p>
        <div className="floating-crop-stage" style={{aspectRatio: `${p.width}/${p.height}`, width: `min(100%, ${220 * p.width / p.height}px)`}}
          onPointerDown={e => { if (e.button !== 0) return; e.preventDefault(); start.current = point(e); e.currentTarget.setPointerCapture(e.pointerId); }}
          onPointerMove={e => {if (!start.current) return; const selection = cropFromDrag(start.current, point(e), p.width!, p.height!); setCrop(selection); setSize({width: selection.width, height: selection.height});}}
          onPointerUp={e => {if (start.current) {const selection = cropFromDrag(start.current, point(e), p.width!, p.height!); setCrop(selection); setSize({width: selection.width, height: selection.height});} start.current = null; if(e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);}}
          onPointerCancel={() => {start.current = null;}}>
          <img src={p.preview} alt={label("拖动裁剪", "Drag to crop")} draggable={false} />
          <div className="floating-crop-selection" style={{left: `${crop.x/p.width*100}%`, top: `${crop.y/p.height*100}%`, width: `${crop.width/p.width*100}%`, height: `${crop.height/p.height*100}%`}} />
        </div>
        <div className="floating-editor-size"><span>{crop.width} × {crop.height} →</span>
          <input aria-label={label("输出宽度", "Output width")} type="number" min="1" max="16384" value={size.width} onChange={e => {const width = Number(e.target.value); setSize({width, height: Math.max(1, Math.round(width * crop.height / crop.width))});}} /> ×
          <input aria-label={label("输出高度", "Output height")} type="number" min="1" max="16384" value={size.height} onChange={e => {const height = Number(e.target.value); setSize({height, width: Math.max(1, Math.round(height * crop.width / crop.height))});}} />
          <button onClick={() => {setCrop({x: 0, y: 0, width: p.width!, height: p.height!}); setSize({width: p.width!, height: p.height!});}}>{label("重置", "Reset")}</button>
        </div>
      </>}
      <label className="floating-editor-quality">{label("压缩质量", "Quality")} <output>{quality}%</output><input type="range" min="1" max="100" value={quality} onChange={e => setQuality(Number(e.target.value))} /></label>
      <div className="floating-editor-formats" aria-label={label("输出格式", "Output format")}>{(["keep", "jpeg", "webp", "png"] as ImageFormat[]).map(f => <button key={f} aria-pressed={format === f} onClick={() => setFormat(f)}>{f === "keep" ? label("保持格式", "Keep") : f.toUpperCase()}</button>)}</div>
      <footer><small>{label("保存为新文件，撤销保留历史文件", "Creates a new file; undo keeps earlier files")}</small><button disabled={busy || size.width < 1 || size.height < 1} onClick={() => void apply()}>{busy ? label("处理中…", "Processing…") : label("应用", "Apply")}</button><button disabled={busy} onClick={() => setOpen(false)}>{label("取消", "Cancel")}</button></footer>
    </section>}
  </div>;
}
