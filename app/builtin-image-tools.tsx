"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImagesIcon, FolderOpenIcon, ArrowsClockwiseIcon, SlidersHorizontalIcon, CheckCircleIcon, DownloadSimpleIcon } from "@phosphor-icons/react";
import "./image-tools-redesign.css";

export type NativeOutputFormat = "keep" | "image/jpeg" | "image/jfif" | "image/png" | "image/webp" | "image/avif" | "image/gif" | "image/bmp" | "image/tiff" | "image/x-icon" | "image/qoi" | "image/x-tga";
type ConversionOutputFormat = Exclude<NativeOutputFormat, "keep">;
type ResizeOutputFormat = "auto" | "source" | Exclude<NativeOutputFormat, "keep">;
type OptimisationMode = "lossless" | "balanced" | "small" | "manual";
type ResizeMode = "scale" | "width" | "height" | "fit" | "exact";
type OutputPlacement = "same-folder" | "fixed-folder";

const OUTPUT_FORMAT_OPTIONS: Array<{ value: ConversionOutputFormat; label: string }> = [
  { value: "image/webp", label: "WebP" },
  { value: "image/jpeg", label: "JPEG" },
  { value: "image/jfif", label: "JFIF" },
  { value: "image/png", label: "PNG" },
  { value: "image/avif", label: "AVIF" },
  { value: "image/gif", label: "GIF" },
  { value: "image/bmp", label: "BMP" },
  { value: "image/tiff", label: "TIFF" },
  { value: "image/x-icon", label: "ICO (≤ 256px)" },
  { value: "image/qoi", label: "QOI" },
  { value: "image/x-tga", label: "TGA" },
];

type NativeImageEntry = {
  name: string;
  type: string;
  path: string;
  originalBytes: number;
  width: number;
  height: number;
  thumbnailType: string;
  thumbnailData: Uint8Array;
};

type QuickSettings = {
  mode: OptimisationMode;
  quality: number;
  scale: number;
  format: NativeOutputFormat;
  stripMetadata: boolean;
  preventLarger: boolean;
  exportMode: "same-folder" | "fixed-folder";
  exportSuffix: string;
  fixedFolder?: string;
  resize?: boolean;
  resizeMode?: "shrink" | "fit" | "exact";
  maxWidth?: number;
  maxHeight?: number;
};

type QuickResult = {
  source: string;
  output?: string;
  originalBytes?: number;
  outputBytes?: number;
  keptOriginal: boolean;
  error?: string;
};

export type BuiltinToolBridge = {
  selectImageEntries: () => Promise<NativeImageEntry[]>;
  selectImageFolderEntries: () => Promise<NativeImageEntry[]>;
  selectFolder: (kind: "input" | "output" | "export") => Promise<string | null>;
  quickCompressPaths: (paths: string[], settings: QuickSettings) => Promise<QuickResult[]>;
};

export type WatcherPatch = {
  outputFolder?: string;
  mode?: OptimisationMode;
  quality?: number;
  scale?: number;
  format?: NativeOutputFormat;
  outputSuffix?: string;
  resize?: boolean;
  resizeMode?: "shrink" | "fit" | "exact";
  maxWidth?: number;
  maxHeight?: number;
  stripMetadata?: boolean;
  preventLarger?: boolean;
};

type ToolItem = NativeImageEntry & {
  id: string;
  previewUrl: string;
  status: "ready" | "working" | "done" | "error";
  result?: QuickResult;
};

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatBytes(value?: number) {
  if (value === undefined) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

function modeQuality(mode: OptimisationMode, manualQuality: number) {
  if (mode === "lossless") return 92;
  if (mode === "balanced") return 82;
  if (mode === "small") return 45;
  return manualQuality;
}

function makeToolItems(entries: NativeImageEntry[]): ToolItem[] {
  return entries.map((entry) => {
    const data = entry.thumbnailData?.length ? new Uint8Array(entry.thumbnailData) : new Uint8Array();
    const previewUrl = data.length ? URL.createObjectURL(new Blob([data], { type: entry.thumbnailType || "image/webp" })) : "";
    return { ...entry, id: uid(), previewUrl, status: "ready" };
  });
}

async function runConcurrent<T>(items: T[], worker: (item: T, index: number) => Promise<void>) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(4, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

function ToolQueue({ items, remove, clear, language }: { items: ToolItem[]; remove: (id: string) => void; clear: () => void; language: "zh" | "en" }) {
  const t = (zh: string, en: string) => language === "en" ? en : zh;
  return <aside className="tool-queue">
    <header><div><span>{t("处理队列", "QUEUE")}</span><strong>{items.length ? t(`${items.length} 张图片`, `${items.length} images`) : t("等待导入", "Ready to import")}</strong></div>{items.length > 0 && <button type="button" onClick={clear}>{t("清空", "Clear")}</button>}</header>
    <div className="tool-queue-list">{items.length ? items.map((item) => <article key={item.id} className={item.status}>
      {item.previewUrl ? <img src={item.previewUrl} alt="" /> : <span className="tool-file-placeholder">IMG</span>}
      <div><strong title={item.path}>{item.name}</strong><small>{item.width} × {item.height} · {formatBytes(item.originalBytes)}</small><em>{item.status === "working" ? t("处理中…", "Processing…") : item.status === "done" ? `${formatBytes(item.result?.originalBytes)} → ${formatBytes(item.result?.outputBytes)}` : item.result?.error || t("等待处理", "Ready")}</em></div>
      <button type="button" aria-label={t("移除", "Remove")} onClick={() => remove(item.id)}>×</button>
    </article>) : <div className="tool-queue-empty"><b>＋</b><strong>{t("先加入要处理的图片", "Add images to begin")}</strong><small>{t("支持多选与整个文件夹", "Choose multiple files or a folder")}</small></div>}</div>
  </aside>;
}

type SharedProps = {
  bridge?: BuiltinToolBridge;
  language: "zh" | "en";
  onCreateMonitor: (patch: WatcherPatch, suggestedName: string) => Promise<string>;
};

function OutputLocationFields({ bridge, language, placement, setPlacement, folder, setFolder }: {
  bridge?: BuiltinToolBridge;
  language: "zh" | "en";
  placement: OutputPlacement;
  setPlacement: (value: OutputPlacement) => void;
  folder: string;
  setFolder: (value: string) => void;
}) {
  const t = (zh: string, en: string) => language === "en" ? en : zh;
  return <>
    <label><span>{t("输出位置", "Output location")}</span><select value={placement} onChange={(event) => setPlacement(event.target.value as OutputPlacement)}><option value="same-folder">{t("每张原图所在文件夹", "Beside each source")}</option><option value="fixed-folder">{t("指定文件夹", "Custom folder")}</option></select></label>
    {placement === "fixed-folder" && <label className="tool-folder-field"><span>{t("指定输出文件夹", "Custom output folder")}</span><button type="button" onClick={async () => { const selected = await bridge?.selectFolder("output"); if (selected) setFolder(selected); }}>{folder || t("选择文件夹…", "Choose folder…")}</button>{folder && <button className="tool-clear-folder" type="button" onClick={() => setFolder("")}>×</button>}</label>}
  </>;
}

function useToolQueue(bridge: BuiltinToolBridge | undefined, language: "zh" | "en") {
  const [items, setItems] = useState<ToolItem[]>([]);
  const itemsRef = useRef<ToolItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const t = useCallback((zh: string, en: string) => language === "en" ? en : zh, [language]);
  const add = useCallback((entries: NativeImageEntry[]) => {
    const next = makeToolItems(entries);
    setItems((current) => [...current, ...next]);
    setNotice(t(`已加入 ${next.length} 张图片`, `Added ${next.length} images`));
  }, [t]);
  const choose = useCallback(async (folder: boolean) => {
    if (!bridge) { setNotice(t("此插件需要桌面客户端", "This plugin requires the desktop app")); return; }
    try { add(await (folder ? bridge.selectImageFolderEntries() : bridge.selectImageEntries())); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  }, [add, bridge, t]);
  const remove = useCallback((id: string) => setItems((current) => {
    const item = current.find((candidate) => candidate.id === id);
    if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
    return current.filter((candidate) => candidate.id !== id);
  }), []);
  const clear = useCallback(() => setItems((current) => {
    current.forEach((item) => { if (item.previewUrl) URL.revokeObjectURL(item.previewUrl); });
    return [];
  }), []);
  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => () => { itemsRef.current.forEach((item) => { if (item.previewUrl) URL.revokeObjectURL(item.previewUrl); }); }, []);
  return { items, setItems, busy, setBusy, notice, setNotice, choose, remove, clear, t };
}

export function FormatConverterPlugin({ bridge, language, onCreateMonitor }: SharedProps) {
  const queue = useToolQueue(bridge, language);
  const [format, setFormat] = useState<ConversionOutputFormat>("image/webp");
  const [mode, setMode] = useState<OptimisationMode>("balanced");
  const [quality, setQuality] = useState(82);
  const [suffix, setSuffix] = useState("-converted");
  const [placement, setPlacement] = useState<OutputPlacement>("same-folder");
  const [folder, setFolder] = useState("");
  const effectiveQuality = modeQuality(mode, quality);
  const process = async () => {
    if (!bridge || !queue.items.length) return;
    if (placement === "fixed-folder" && !folder) { queue.setNotice(queue.t("请先选择输出文件夹", "Choose an output folder first")); return; }
    queue.setBusy(true); queue.setNotice(queue.t("正在并行转换…", "Converting in parallel…"));
    let completed = 0;
    await runConcurrent(queue.items, async (item) => {
      queue.setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status: "working" } : candidate));
      try {
        const [result] = await bridge.quickCompressPaths([item.path], { mode, quality: effectiveQuality, scale: 100, format, stripMetadata: true, preventLarger: false, exportMode: placement, exportSuffix: suffix, fixedFolder: placement === "fixed-folder" ? folder : undefined });
        queue.setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status: result?.error ? "error" : "done", result } : candidate));
      } catch (error) {
        queue.setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status: "error", result: { source: item.path, keptOriginal: false, error: error instanceof Error ? error.message : String(error) } } : candidate));
      }
      completed += 1; queue.setNotice(queue.t(`已处理 ${completed} / ${queue.items.length}`, `Processed ${completed} / ${queue.items.length}`));
    });
    queue.setBusy(false);
  };
  return <section className="builtin-tool-page converter-page">
    <header className="tool-hero"><div><h1>{queue.t("格式转换", "Format converter")}</h1><p>{queue.t("批量转换图片格式，原图保留在本机。支持 HEIC / HEIF 导入。", "Batch convert your images locally. Original files stay intact. HEIC / HEIF supported.")}</p></div><ArrowsClockwiseIcon size={32} weight="duotone" /></header>
    <div className="tool-layout converter-layout">
      <section className="converter-input" aria-label={queue.t("源图片", "Source images")}><header className="converter-section-heading"><ImagesIcon size={22} /><div><h2>{queue.t("源图片", "Source images")}</h2><p>{queue.t("选择图片或导入整个文件夹", "Choose files or import an entire folder")}</p></div></header><div className="tool-import-actions"><button type="button" disabled={queue.busy} onClick={() => void queue.choose(false)}><ImagesIcon size={18} />{queue.t("添加图片", "Add images")}</button><button type="button" disabled={queue.busy} onClick={() => void queue.choose(true)}><FolderOpenIcon size={18} />{queue.t("导入文件夹", "Import folder")}</button></div><ToolQueue items={queue.items} remove={queue.remove} clear={queue.clear} language={language} /></section>
      <div className="tool-console"><header className="converter-section-heading"><SlidersHorizontalIcon size={22} /><div><h2>{queue.t("转换设置", "Conversion settings")}</h2><p>{queue.t("设置格式、质量与保存位置", "Format, quality and destination")}</p></div></header>
        <fieldset className="tool-fields" disabled={queue.busy}>
          <label><span>{queue.t("目标格式", "Output format")}</span><select value={format} onChange={(event) => setFormat(event.target.value as typeof format)}>{OUTPUT_FORMAT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label><span>{queue.t("压缩方案", "Optimisation mode")}</span><select value={mode} onChange={(event) => setMode(event.target.value as OptimisationMode)}><option value="lossless">{queue.t("无损优先", "High quality")}</option><option value="balanced">{queue.t("智能平衡", "Balanced")}</option><option value="small">{queue.t("更小体积", "Smaller")}</option><option value="manual">{queue.t("手动质量", "Manual quality")}</option></select></label>
          {mode === "manual" && <label><span>{queue.t("编码质量", "Encoding quality")} <b>{quality}%</b></span><input type="range" min="1" max="100" value={quality} onChange={(event) => setQuality(Number(event.target.value))} /></label>}
          <label><span>{queue.t("文件名后缀", "Filename suffix")}</span><input value={suffix} onChange={(event) => setSuffix(event.target.value)} /></label>
          <OutputLocationFields bridge={bridge} language={language} placement={placement} setPlacement={setPlacement} folder={folder} setFolder={setFolder} />
        </fieldset>
        <footer className="tool-actions"><small role="status" aria-live="polite">{queue.notice || queue.t("所有图片仅在本机处理", "All images stay on this device")}</small><div><button type="button" disabled={queue.busy || (placement === "fixed-folder" && !folder)} onClick={async () => queue.setNotice(await onCreateMonitor({ outputFolder: placement === "fixed-folder" ? folder : "@same-folder", outputSuffix: suffix, mode, quality: effectiveQuality, format, scale: 100, resize: false }, queue.t("格式转换", "Format conversion")))}>{queue.t("保存为监控任务", "Create watch task")}</button><button className="primary" type="button" disabled={queue.busy || !queue.items.length || (placement === "fixed-folder" && !folder)} onClick={() => void process()}>{queue.busy ? queue.t("转换中…", "Converting…") : queue.t("开始转换", "Convert")}</button></div></footer>
      </div>
      <section className="converter-results" aria-label={queue.t("转换结果", "Results")}><header className="converter-section-heading"><DownloadSimpleIcon size={22} /><div><h2>{queue.t("转换结果", "Results")}</h2><p>{queue.t("完成后可查看文件大小和保存路径", "Review file sizes and saved locations")}</p></div><span className="converter-count">{queue.items.filter((item) => item.status === "done").length} / {queue.items.length}</span></header>
        {queue.items.some((item) => item.status === "done" || item.status === "error") ? <div className="converter-result-list">{queue.items.filter((item) => item.status === "done" || item.status === "error").map((item) => <article key={item.id} className={item.status}><CheckCircleIcon size={20} /><div><strong>{item.name}</strong><p>{item.result?.error || `${formatBytes(item.result?.originalBytes)} → ${formatBytes(item.result?.outputBytes)}`}</p><small title={item.result?.output}>{item.result?.output}</small></div><span>{item.status === "error" ? queue.t("失败", "Failed") : queue.t("已保存", "Saved")}</span></article>)}</div> : <div className="converter-results-empty"><DownloadSimpleIcon size={26} /><p>{queue.t("转换完成的文件会显示在这里", "Converted files will appear here")}</p><small>{queue.t("设置输出格式后，点击开始转换", "Choose an output format, then select Convert")}</small></div>}
      </section>
    </div>
  </section>;
}

export function ResizePlugin({ bridge, language, onCreateMonitor }: SharedProps) {
  const queue = useToolQueue(bridge, language);
  const [resizeMode, setResizeMode] = useState<ResizeMode>("scale");
  const [scale, setScale] = useState(200);
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const [format, setFormat] = useState<ResizeOutputFormat>("source");
  const [mode, setMode] = useState<OptimisationMode>("balanced");
  const [quality, setQuality] = useState(82);
  const [suffix, setSuffix] = useState("-resized");
  const [placement, setPlacement] = useState<OutputPlacement>("same-folder");
  const [folder, setFolder] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = queue.items.find((item) => item.id === selectedId) || queue.items[0];
  const completedItems = queue.items.filter((item) => item.status === "done" || item.status === "error");
  const effectiveQuality = modeQuality(mode, quality);
  const settingsFor = useCallback((item: ToolItem): QuickSettings => {
    let itemScale = scale;
    let nativeResize = false;
    let nativeResizeMode: "shrink" | "fit" | "exact" = "shrink";
    const maxWidth = width;
    const maxHeight = height;
    if (resizeMode === "width") itemScale = width / Math.max(1, item.width) * 100;
    if (resizeMode === "height") itemScale = height / Math.max(1, item.height) * 100;
    if (resizeMode === "fit" || resizeMode === "exact") { nativeResize = true; nativeResizeMode = resizeMode; itemScale = 100; }
    const nativeFormat: NativeOutputFormat = format === "auto" || format === "source" ? "keep" : format;
    const nativeMode: OptimisationMode = format === "source" ? "manual" : mode;
    return { mode: nativeMode, quality: effectiveQuality, scale: Math.max(0.1, Math.min(800, itemScale)), format: nativeFormat, stripMetadata: true, preventLarger: false, exportMode: placement, exportSuffix: suffix, fixedFolder: placement === "fixed-folder" ? folder : undefined, resize: nativeResize, resizeMode: nativeResizeMode, maxWidth, maxHeight };
  }, [effectiveQuality, folder, format, height, mode, placement, resizeMode, scale, suffix, width]);
  const monitorPatch = useMemo((): WatcherPatch => {
    const nativeFormat: NativeOutputFormat = format === "auto" || format === "source" ? "keep" : format;
    const nativeMode: OptimisationMode = format === "source" ? "manual" : mode;
    if (resizeMode === "fit" || resizeMode === "exact") return { mode: nativeMode, quality: effectiveQuality, scale: 100, format: nativeFormat, resize: true, resizeMode, maxWidth: width, maxHeight: height };
    if (resizeMode === "width") return { mode: nativeMode, quality: effectiveQuality, scale: 800, format: nativeFormat, resize: true, resizeMode: "shrink", maxWidth: width, maxHeight: 4_294_967_295 };
    if (resizeMode === "height") return { mode: nativeMode, quality: effectiveQuality, scale: 800, format: nativeFormat, resize: true, resizeMode: "shrink", maxWidth: 4_294_967_295, maxHeight: height };
    return { mode: nativeMode, quality: effectiveQuality, scale, format: nativeFormat, resize: false, resizeMode: "shrink", maxWidth: width, maxHeight: height };
  }, [effectiveQuality, format, height, mode, resizeMode, scale, width]);
  const process = async () => {
    if (!bridge || !queue.items.length) return;
    if (placement === "fixed-folder" && !folder) { queue.setNotice(queue.t("请先选择输出文件夹", "Choose an output folder first")); return; }
    queue.setBusy(true); queue.setNotice(queue.t("正在并行调整尺寸…", "Resizing in parallel…"));
    let completed = 0;
    await runConcurrent(queue.items, async (item) => {
      queue.setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status: "working" } : candidate));
      try {
        const [result] = await bridge.quickCompressPaths([item.path], settingsFor(item));
        queue.setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status: result?.error ? "error" : "done", result } : candidate));
      } catch (error) {
        queue.setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status: "error", result: { source: item.path, keptOriginal: false, error: error instanceof Error ? error.message : String(error) } } : candidate));
      }
      completed += 1; queue.setNotice(queue.t(`已处理 ${completed} / ${queue.items.length}`, `Processed ${completed} / ${queue.items.length}`));
    });
    queue.setBusy(false);
  };
  // This is a dimension estimate of the selected source, never a fabricated output preview.
  const selectedSettings = selected ? settingsFor(selected) : undefined;
  const ratio = selected && selectedSettings ? resizeMode === "fit"
    ? Math.max(0.001, Math.min(8, width / Math.max(1, selected.width), height / Math.max(1, selected.height)))
    : selectedSettings.scale / 100 : 1;
  const targetWidth = selected ? resizeMode === "exact" ? width : Math.max(1, Math.round(selected.width * ratio)) : 0;
  const targetHeight = selected ? resizeMode === "exact" ? height : Math.max(1, Math.round(selected.height * ratio)) : 0;
  const needsFolder = placement === "fixed-folder" && !folder;
  return <section className="builtin-tool-page resize-page">
    <header className="resize-toolbar">
      <div className="resize-title"><h1>{queue.t("尺寸调整与扩图", "Resize & enlarge")}</h1><p>{queue.t("批量调整尺寸，原图保留在本机", "Batch resize locally. Originals stay intact.")}</p></div>
      <div className="resize-top-actions">
        <button type="button" disabled={queue.busy || needsFolder} onClick={async () => {
          try { queue.setNotice(await onCreateMonitor({ ...monitorPatch, outputFolder: placement === "fixed-folder" ? folder : "@same-folder", outputSuffix: suffix }, queue.t("尺寸调整", "Resize"))); }
          catch (error) { queue.setNotice(error instanceof Error ? error.message : String(error)); }
        }}><ArrowsClockwiseIcon size={17} />{queue.t("保存监控任务", "Create watch task")}</button>
        <button className="primary" type="button" disabled={queue.busy || !queue.items.length || needsFolder} onClick={() => void process()}><DownloadSimpleIcon size={17} />{queue.busy ? queue.t("处理中…", "Resizing…") : queue.t("调整尺寸", "Resize images")}</button>
      </div>
    </header>
    <div className="resize-workspace">
      <section className="resize-panel resize-sources" aria-label={queue.t("源图片", "Source images")}>
        <header className="resize-panel-heading"><ImagesIcon size={19} /><h2>{queue.t("源图片", "Source images")}</h2><span>{queue.items.length}</span></header>
        <div className="resize-import-actions"><button type="button" disabled={queue.busy} onClick={() => void queue.choose(false)}><ImagesIcon size={16} />{queue.t("添加图片", "Add images")}</button><button type="button" disabled={queue.busy} onClick={() => void queue.choose(true)}><FolderOpenIcon size={16} />{queue.t("导入文件夹", "Import folder")}</button></div>
        <div className="resize-source-list">{queue.items.length ? queue.items.map((item) => <article key={item.id} className={selected?.id === item.id ? "selected" : ""}>
          <button type="button" className="resize-source-item" aria-pressed={selected?.id === item.id} onClick={() => setSelectedId(item.id)}>
            {item.previewUrl ? <img src={item.previewUrl} alt="" /> : <ImagesIcon size={24} />}
            <span><strong title={item.name}>{item.name}</strong><small>{item.width} × {item.height}</small><small>{formatBytes(item.originalBytes)}</small></span>
          </button><button className="resize-remove" type="button" disabled={queue.busy} aria-label={queue.t(`移除 ${item.name}`, `Remove ${item.name}`)} onClick={() => queue.remove(item.id)}>×</button>
        </article>) : <div className="resize-empty"><ImagesIcon size={27} /><strong>{queue.t("加入要调整的图片", "Add images to begin")}</strong><p>{queue.t("支持多选图片或整个文件夹", "Choose multiple files or a folder")}</p></div>}</div>
        <footer className="resize-source-footer"><span>{queue.t("原图不会被覆盖", "Originals are preserved")}</span><button type="button" disabled={queue.busy || !queue.items.length} onClick={queue.clear}>{queue.t("清空", "Clear")}</button></footer>
      </section>
      <div className="resize-preview-column">
        <section className="resize-panel resize-preview-panel" aria-label={queue.t("原图预览", "Source preview")}>
          <header className="resize-panel-heading"><h2>{queue.t("原图预览", "Source preview")}</h2><span>{queue.t("适应画布", "Fit to view")}</span></header>
          <div className="resize-preview">{selected?.previewUrl ? <img src={selected.previewUrl} alt={queue.t(`原图：${selected.name}`, `Source: ${selected.name}`)} /> : <div className="resize-empty"><ImagesIcon size={36} /><strong>{queue.t("在这里查看原图", "Your source preview")}</strong><p>{queue.t("导入后选择图片查看尺寸", "Import an image to inspect its dimensions")}</p></div>}</div>
          <div className="resize-preview-caption"><strong title={selected?.name}>{selected?.name || queue.t("尚未选择图片", "No image selected")}</strong><span>{selected ? `${selected.width} × ${selected.height} px` : queue.t("等待导入", "Ready to import")}</span></div>
          <div className="resize-dimension-summary"><span>{queue.t("预计输出", "Estimated output")}</span><strong>{selected ? `${targetWidth} × ${targetHeight} px` : "-"}</strong><small>{resizeMode === "exact" ? queue.t("精确尺寸", "Exact dimensions") : queue.t("保持比例", "Aspect preserved")}</small></div>
        </section>
        <section className="resize-panel resize-results" aria-label={queue.t("输出文件", "Output files")}>
          <header className="resize-panel-heading"><DownloadSimpleIcon size={18} /><h2>{queue.t("输出文件", "Output files")}</h2><span>{queue.items.filter((item) => item.status === "done").length} / {queue.items.length}</span></header>
          <div className="resize-result-list">{completedItems.length ? completedItems.map((item) => <article key={item.id} className={item.status}>
            <CheckCircleIcon size={17} /><div><strong>{item.name}</strong><p>{item.result?.error || `${formatBytes(item.result?.originalBytes)} → ${formatBytes(item.result?.outputBytes)}`}</p>{item.result?.output && <small>{item.result.output}</small>}</div><span>{item.status === "error" ? queue.t("失败", "Failed") : queue.t("已保存", "Saved")}</span>
          </article>) : <div className="resize-results-empty"><p>{queue.t("处理完成的文件会显示在这里", "Saved files will appear here")}</p><small>{queue.t("包含文件大小与实际保存路径", "With file sizes and saved locations")}</small></div>}</div>
        </section>
      </div>
      <section className="resize-panel resize-settings" aria-label={queue.t("尺寸设置", "Resize settings")}>
        <header className="resize-panel-heading"><SlidersHorizontalIcon size={19} /><h2>{queue.t("尺寸设置", "Resize settings")}</h2></header>
        <div className="resize-settings-scroll"><fieldset className="resize-fields" disabled={queue.busy}>
          <label><span>{queue.t("尺寸方式", "Resize method")}</span><select value={resizeMode} onChange={(event) => setResizeMode(event.target.value as ResizeMode)}><option value="scale">{queue.t("等比百分比", "Percentage")}</option><option value="width">{queue.t("指定宽度", "Set width")}</option><option value="height">{queue.t("指定高度", "Set height")}</option><option value="fit">{queue.t("适应宽高边界", "Fit inside box")}</option><option value="exact">{queue.t("精确宽高", "Exact dimensions")}</option></select></label>
          {resizeMode === "scale" ? <div className="resize-scale"><label><span>{queue.t("缩放比例", "Scale")}</span><div className="resize-number-unit"><input type="number" min="1" max="800" value={scale} onChange={(event) => setScale(Math.max(1, Math.min(800, Number(event.target.value) || 1)))} /><span>%</span></div></label><input aria-label={queue.t("缩放比例滑块", "Scale slider")} type="range" min="1" max="800" value={scale} onChange={(event) => setScale(Number(event.target.value))} /><div className="resize-scale-presets">{[50,100,200,400].map((value) => <button type="button" key={value} aria-pressed={value === scale} onClick={() => setScale(value)}>{value}%</button>)}</div></div> : <div className="resize-size-fields">
            <label><span>{queue.t("宽度", "Width")}</span><div className="resize-number-unit"><input type="number" min="1" value={resizeMode === "height" && selected ? targetWidth : width} disabled={resizeMode === "height"} onChange={(event) => setWidth(Math.max(1, Number(event.target.value) || 1))} /><span>px</span></div></label>
            <label><span>{queue.t("高度", "Height")}</span><div className="resize-number-unit"><input type="number" min="1" value={resizeMode === "width" && selected ? targetHeight : height} disabled={resizeMode === "width"} onChange={(event) => setHeight(Math.max(1, Number(event.target.value) || 1))} /><span>px</span></div></label>
          </div>}
          <p className="resize-aspect-note">{resizeMode === "exact" ? queue.t("精确宽高会改变比例，图片可能变形。", "Exact dimensions change the aspect ratio and may distort the image.") : queue.t("保持原图比例。指定单边时另一边自动计算。", "Aspect ratio stays intact. The other dimension is calculated automatically.")}</p>
          <p className="resize-upscale-note">{queue.t("最高 8 倍等比放大。Lanczos3 缩放不会生成新细节。", "Up to 8× proportional enlargement. Lanczos3 does not generate new detail.")}</p>
          <h3>{queue.t("格式与质量", "Format & quality")}</h3>
          <label><span>{queue.t("输出格式", "Output format")}</span><select value={format} onChange={(event) => setFormat(event.target.value as ResizeOutputFormat)}><option value="source">{queue.t("保持原格式", "Keep source format")}</option><option value="auto">{queue.t("智能择优格式", "Choose smallest format")}</option>{OUTPUT_FORMAT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label><span>{queue.t("压缩方案", "Optimisation mode")}</span><select value={mode} onChange={(event) => setMode(event.target.value as OptimisationMode)}><option value="lossless">{queue.t("无损优先", "High quality")}</option><option value="balanced">{queue.t("智能平衡", "Balanced")}</option><option value="small">{queue.t("更小体积", "Smaller")}</option><option value="manual">{queue.t("手动质量", "Manual quality")}</option></select></label>
          {mode === "manual" && <label><span>{queue.t("编码质量", "Encoding quality")} <b>{quality}%</b></span><input type="range" min="1" max="100" value={quality} onChange={(event) => setQuality(Number(event.target.value))} /></label>}
          <h3>{queue.t("保存位置", "Save destination")}</h3>
          <label><span>{queue.t("文件名后缀", "Filename suffix")}</span><input value={suffix} onChange={(event) => setSuffix(event.target.value)} /></label>
          <OutputLocationFields bridge={bridge} language={language} placement={placement} setPlacement={setPlacement} folder={folder} setFolder={setFolder} />
          {needsFolder && <p className="resize-aspect-note">{queue.t("选择输出文件夹后即可处理。", "Choose an output folder to enable resizing.")}</p>}
        </fieldset></div>
        <footer className="resize-scroll-hint">{queue.t("向下滚动查看质量与保存设置", "Scroll for quality & save settings")}</footer>
      </section>
    </div>
    <footer className="resize-status" role="status" aria-live="polite">{queue.notice || queue.t("所有图片仅在本机处理", "All images stay on this device")}</footer>
  </section>;
}
