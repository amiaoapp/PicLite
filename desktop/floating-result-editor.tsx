import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Crop, DotsThree } from "@phosphor-icons/react";
import { Icon } from "./clop-icons";
import type { ImageFormat, Language, OptimisationPreset, PicLiteBridge } from "./clop-types";
import { tr } from "./clop-store";
import { cropFromDrag, editorCompressionSettings } from "./floating-editor-model";
import "./floating-result-editor.css";

type Props = {
  api: PicLiteBridge; path?: string; preview?: string; width?: number; height?: number;
  filename: string; language: Language; format?: string; quality: number;
  previewContent: ReactNode; menuActions: ReactNode; disabled?: boolean;
  process?: (settings: Partial<OptimisationPreset>, source?: string) => Promise<void>;
  updateFormat: (format: ImageFormat) => void; dismiss: () => void;
  notify: (message: string, tone?: "error" | "success") => void;
};

/** Editing occupies the existing preview slot; no second toolbar or expanding card. */
export function FloatingResultEditor(p: Props) {
  const [mode, setMode] = useState<"crop" | "quality" | null>(null);
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [quality, setQuality] = useState(p.quality);
  const [format, setFormat] = useState<ImageFormat>(["jpeg", "png", "webp"].includes(p.format || "") ? p.format as ImageFormat : "keep");
  const [crop, setCrop] = useState({x: 0, y: 0, width: p.width || 1, height: p.height || 1});
  const [size, setSize] = useState({width: p.width || 1, height: p.height || 1});
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const start = useRef<{x: number; y: number} | null>(null);
  const running = useRef(false);
  const label = (zh: string, en: string) => tr(p.language, zh, en);
  const canEdit = !!p.path && !!p.process && !p.disabled;
  const canCrop = canEdit && !!p.preview && !!p.width && !!p.height && !/\.gif$/i.test(p.path || "");
  useEffect(() => {
    if (!mode && !menu) return;
    panel.current?.querySelector<HTMLElement>("button:not(:disabled), input")?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setMenu(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [mode, menu]);
  const close = () => { if (running.current) return; setMode(null); setMenu(false); trigger.current?.focus(); };
  const run = async (action: () => Promise<unknown>) => {
    if (running.current) return;
    running.current = true; setBusy(true);
    try { await action(); } catch (e) { p.notify(e instanceof Error ? e.message : String(e), "error"); }
    finally { running.current = false; setBusy(false); }
  };
  const save = () => run(async () => {
    if (!p.path) return;
    const folder = await p.api.selectFolder("export");
    if (!folder) return;
    const output = await p.api.saveFloatingResult(p.path, folder);
    p.notify(label("已保存副本：", "Copy saved: ") + output);
    setMenu(false);
  });
  const apply = () => run(async () => {
    if (!p.path || !p.process) return;
    let source: string | undefined;
    if (mode === "crop") source = await p.api.editFloatingImage(p.path, {...crop, outputWidth: size.width, outputHeight: size.height});
    await p.process(editorCompressionSettings(quality, format), source);
    setMode(null); setMenu(false);
  });
  const point = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height};
  };
  const selectCrop = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!start.current || !p.width || !p.height) return;
    const selection = cropFromDrag(start.current, point(event), p.width, p.height);
    setCrop(selection); setSize({width: selection.width, height: selection.height});
  };
  const resetCrop = () => {setCrop({x: 0, y: 0, width: p.width!, height: p.height!}); setSize({width: p.width!, height: p.height!});};
  const dimension = (value: string) => Math.max(1, Math.min(16384, Math.round(Number(value) || 1)));
  const validSize = size.width > 0 && size.height > 0 && size.width <= 16384 && size.height <= 16384 && size.width * size.height <= 64_000_000;
  return <div ref={root} className={`floating-card-content ${mode ? "is-editing" : ""}`} data-interacting={!!mode || menu || busy}
    onKeyDown={event => {if (event.key === "Escape") {event.preventDefault(); event.stopPropagation(); close();}}}
    onContextMenu={event => {event.preventDefault(); event.stopPropagation(); if (!busy) setMenu(true);}}>
    <header className="floating-card-header" onPointerDown={event => event.stopPropagation()}>
      <button data-action="dismiss" className="floating-card-icon" aria-label={label("移除", "Dismiss")} title={label("移除", "Dismiss")} disabled={busy} onClick={event => {event.stopPropagation(); p.dismiss();}}><Icon name="close" /></button>
      <span>{mode === "crop" ? label("裁剪与尺寸", "Crop & resize") : mode === "quality" ? label("压缩质量", "Compression quality") : label("优化结果", "Optimised image")}</span>
      <button ref={trigger} data-action="more" className="floating-card-icon" aria-label={label("更多操作", "More actions")} title={label("更多操作", "More actions")} aria-haspopup="menu" aria-expanded={menu} disabled={busy} onClick={event => {event.stopPropagation(); setMenu(!menu);}}><DotsThree weight="bold" /></button>
    </header>
    <div className="floating-card-body">
      {!mode ? p.previewContent : <section ref={panel} className={`floating-editor-panel mode-${mode}`} aria-label={mode === "crop" ? label("裁剪与尺寸", "Crop & resize") : label("压缩质量", "Compression quality")}
        onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}>
        <div className="floating-editor-parameters">
        {mode === "crop" && p.preview && p.width && p.height ? <>
          <div className="floating-crop-space">
            <div className="floating-crop-stage" style={{aspectRatio: `${p.width}/${p.height}`, width: `min(100%, ${138 * p.width / p.height}px)`}}
              onPointerDown={event => {if (event.button !== 0 || busy) return; event.preventDefault(); start.current = point(event); event.currentTarget.setPointerCapture(event.pointerId);}}
              onPointerMove={selectCrop}
              onPointerUp={event => {selectCrop(event); start.current = null; if(event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);}}
              onPointerCancel={() => {start.current = null;}}>
              <img src={p.preview} alt={label("拖动选择裁剪区域", "Drag to select a crop")} draggable={false} />
              <div className="floating-crop-selection" style={{left: `${crop.x/p.width*100}%`, top: `${crop.y/p.height*100}%`, width: `${crop.width/p.width*100}%`, height: `${crop.height/p.height*100}%`}} />
            </div>
          </div>
          <div className="floating-editor-size">
            <label>{label("宽", "Width")}<input aria-label={label("输出宽度", "Output width")} disabled={busy} type="number" min="1" max="16384" value={size.width} onChange={event => {const width = dimension(event.target.value); setSize({width, height: Math.max(1, Math.round(width * crop.height / crop.width))});}} /></label>
            <span aria-hidden="true">×</span>
            <label>{label("高", "Height")}<input aria-label={label("输出高度", "Output height")} disabled={busy} type="number" min="1" max="16384" value={size.height} onChange={event => {const height = dimension(event.target.value); setSize({height, width: Math.max(1, Math.round(height * crop.width / crop.height))});}} /></label>
            <button disabled={busy} onClick={resetCrop} title={`${crop.width} × ${crop.height}`}>{label("重置", "Reset")}</button>
          </div>
        </> : <div className="floating-quality-preview">{p.preview && <img src={p.preview} alt="" />}<p>{label("调整编码质量，文件大小以处理结果为准。", "Encoder quality. File size is measured after processing.")}</p></div>}
        <label className="floating-editor-quality"><span>{label("编码质量", "Encoder quality")}<output>{quality}%</output></span><input aria-label={label("编码质量", "Encoder quality")} disabled={busy} type="range" min="1" max="100" value={quality} onChange={event => setQuality(Number(event.target.value))} /></label>
        </div>
        <footer className="floating-editor-footer"><small>{!validSize ? label("输出最多 6400 万像素", "Maximum 64 megapixels") : label("保留原文件", "Original preserved")}</small><button disabled={busy} onClick={close}>{label("取消", "Cancel")}</button><button data-action="apply-edit" className="primary" disabled={busy || !validSize} onClick={() => void apply()}>{busy ? label("处理中…", "Processing…") : label("应用", "Apply")}</button></footer>
      </section>}
    </div>
    <div className="floating-card-file" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
      <strong title={p.filename}>{p.filename}</strong>
      <button data-action="crop" className="floating-card-icon" disabled={busy || !canCrop} aria-pressed={mode === "crop"} title={label("裁剪与调整尺寸（静态图片）", "Crop and resize (still images)")} aria-label={label("裁剪", "Crop")} onClick={() => {setMenu(false); setMode(mode === "crop" ? null : "crop");}}><Crop /></button>
      <button data-action="quality" className="floating-card-icon" disabled={busy || !canEdit} aria-pressed={mode === "quality"} title={label("调整编码质量", "Adjust encoder quality")} aria-label={label("质量", "Quality")} onClick={() => {setMenu(false); setMode(mode === "quality" ? null : "quality");}}><Icon name="sliders" /></button>
    </div>
    <div className="format-bar floating-card-formats" aria-label={label("输出格式", "Output format")} onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
      {(["keep", "jpeg", "webp", "png"] as ImageFormat[]).map(f => <button key={f} data-format={f} disabled={busy || !p.path || p.disabled} className={(mode ? format === f : p.format === f) ? "active" : ""} aria-pressed={mode ? format === f : p.format === f} onClick={() => {setFormat(f); if (!mode) p.updateFormat(f);}}>{f === "keep" ? "AUTO" : f.toUpperCase()}</button>)}
    </div>
    {menu && <section ref={panel} className="floating-overflow-menu" role="menu" aria-label={label("结果操作", "Result actions")} onPointerDown={event => event.stopPropagation()} onClick={event => {event.stopPropagation(); if ((event.target as HTMLElement).closest("button:not([data-action=save])")) setMenu(false);}} onWheel={event => event.stopPropagation()} onKeyDown={event => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length-1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }}>
      <button data-action="save" role="menuitem" disabled={busy || !p.path || p.disabled} onClick={() => void save()}><Icon name="save" />{label("保存副本…", "Save copy…")}</button>
      {p.menuActions}
    </section>}
  </div>;
}
