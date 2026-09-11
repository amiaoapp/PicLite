import { PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { disable as disableAutostart, enable as enableAutostart, isEnabled as isAutostartEnabled } from "@tauri-apps/plugin-autostart";
import { Icon } from "./clop-icons";
import { copyImageWithFeedback } from "./operation-feedback";
import type { OperationFeedbackTone } from "./operation-feedback";
import { fileName, formatBytes, loadSettings, saveSettings, subscribeSettings, toNativeFormat, tr } from "./clop-store";
import type { DesktopSettings, FloatingAction, FloatingWatermark, ImageFormat, Language, OptimisationPreset, PicLiteBridge, QuickCompressResult, QuickCompressSettings, StoredUploadProfile } from "./clop-types";
import packageManifest from "../package.json";

type ResultItem = QuickCompressResult & {
  id: string;
  preview?: string;
  width?: number;
  height?: number;
  history?: ResultItem[];
  status: "working" | "done" | "error";
};

const bridge = window.picLite as unknown as PicLiteBridge | undefined;

type SystemFontInfo = { family: string; path: string; faceIndex: number };
type WorkspacePlugin = { id: string; nameZh: string; nameEn: string; kind: "builtin" | "html" | "url"; enabled: boolean; source?: string; url?: string };
const WORKSPACE_PLUGINS_KEY = "piclite.workspacePlugins.v1";
const REQUESTED_SETTINGS_SECTION_KEY = "piclite.preferences.requested-section";
const APP_VERSION = packageManifest.version;
const APP_RELEASE_DATE = packageManifest.releaseDate;
const LAST_UPDATE_CHECK_KEY = "piclite.update.last-checked.v1";
const loadedFontFaces = new Set<string>();
const BUILTIN_WORKSPACE_PLUGINS: WorkspacePlugin[] = [
  { id: "watcher", nameZh: "文件夹监测", nameEn: "Folder watch", kind: "builtin", enabled: true },
  { id: "rename", nameZh: "图片批量重命名", nameEn: "Batch image rename", kind: "builtin", enabled: true },
  { id: "gallery", nameZh: "图库", nameEn: "Library", kind: "builtin", enabled: true },
];
const SPONSOR_METHODS = [
  { id: "alipay", image: "/sponsor/alipay.png", zh: "支付宝", en: "Alipay" },
  { id: "wechat-pay", image: "/sponsor/wechat-pay.png", zh: "微信支付", en: "WeChat Pay" },
  { id: "wechat-reward", image: "/sponsor/wechat-reward.png", zh: "微信赞赏码", en: "WeChat Reward" },
  { id: "tron", image: "/sponsor/tron.png", zh: "TRON · TRC10 / TRC20", en: "TRON · TRC10 / TRC20" },
] as const;
const CREATOR_LINKS = [
  { id: "website", icon: "globe", label: "appmiao.com", url: "https://www.appmiao.com" },
  { id: "bilibili", icon: "bilibili", label: "Bilibili", url: "https://space.bilibili.com/6623126" },
  { id: "douyin", icon: "douyin", label: "抖音", url: "https://v.douyin.com/qmJBSlpdlgs/" },
  { id: "youtube", icon: "youtube", label: "YouTube", url: "https://www.youtube.com/@amiaoapp" },
  { id: "x", icon: "x-social", label: "X", url: "https://x.com/amiaoapp" },
  { id: "telegram", icon: "telegram", label: "Telegram", url: "https://t.me/miaoaaaaa" },
] as const;
const SUPPORTED_IMAGE_PATH = /\.(?:jpe?g|jfif|png|webp|gif|avif|tiff?)$/i;

function supportedImagePaths(paths: string[]) {
  return [...new Set(paths.filter((path) => SUPPORTED_IMAGE_PATH.test(fileName(path))))];
}

function loadWorkspacePlugins() {
  try {
    const saved = JSON.parse(localStorage.getItem(WORKSPACE_PLUGINS_KEY) || "[]") as WorkspacePlugin[];
    return [...BUILTIN_WORKSPACE_PLUGINS.map((plugin) => ({ ...plugin, enabled: saved.find((item) => item.id === plugin.id)?.enabled ?? true })), ...saved.filter((plugin) => plugin.kind !== "builtin")];
  } catch {
    return BUILTIN_WORKSPACE_PLUGINS;
  }
}

function jsPluginDocument(script: string) {
  const safeScript = script.replace(/<[/]script/gi, "<" + "\\/" + "script");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>html,body,#piclite-plugin-root{height:100%;margin:0;font-family:system-ui;color:#172033;background:#f7f9fc}</style></head><body><main id="piclite-plugin-root"></main><script>window.PicLitePlugin={version:'1.0.0',root:document.getElementById('piclite-plugin-root'),post:function(type,payload){parent.postMessage({source:'piclite-plugin',type:type,payload:payload},'*')}};</script><script>${safeScript}</script></body></html>`;
}

async function installFontFace(family: string, data: Uint8Array) {
  if (loadedFontFaces.has(family)) return;
  const font = new FontFace(family, data.slice().buffer as ArrayBuffer);
  await font.load();
  document.fonts.add(font);
  loadedFontFaces.add(family);
}

async function ensureFontLoaded(api: PicLiteBridge, family: string, systemFonts?: SystemFontInfo[]) {
  if (!family || loadedFontFaces.has(family)) return;
  const imported = await api.loadImportedFonts();
  const importedFont = imported.find((font) => font.family === family);
  if (importedFont) return installFontFace(family, importedFont.data);
  const fonts = systemFonts || await api.listSystemFonts();
  const systemFont = fonts.find((font) => font.family === family);
  if (!systemFont) return;
  const { data } = await api.readSystemFont(systemFont.path, systemFont.faceIndex);
  await installFontFace(family, data);
}

function useDesktopSettings() {
  const [settings, setSettingsState] = useState(loadSettings);
  useEffect(() => subscribeSettings(setSettingsState), []);
  const setSettings = useCallback((next: DesktopSettings | ((current: DesktopSettings) => DesktopSettings)) => {
    setSettingsState((current) => {
      const value = typeof next === "function" ? next(current) : next;
      saveSettings(value);
      return value;
    });
  }, []);
  return [settings, setSettings] as const;
}

function T({ language, zh, en }: { language: Language; zh: string; en: string }) {
  return <>{tr(language, zh, en)}</>;
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return <button type="button" className={`clop-switch ${checked ? "on" : ""}`} role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}><i /></button>;
}

function Select<T extends string>({ value, onChange, children, label }: { value: T; onChange: (value: T) => void; children: React.ReactNode; label: string }) {
  return <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value as T)}>{children}</select>;
}

function percentage(item: QuickCompressResult) {
  if (!item.originalBytes || item.outputBytes == null) return null;
  return Math.round((1 - item.outputBytes / item.originalBytes) * 100);
}

type ShortcutKeyEvent = Pick<globalThis.KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

function shortcutFromEvent(event: ShortcutKeyEvent) {
  if (event.key === "Escape") return "escape";
  if (event.key === "Backspace" || event.key === "Delete") return "";
  if (["Meta", "Control", "Alt", "Shift"].includes(event.key)) return null;
  const modifiers: string[] = [];
  if (event.metaKey || event.ctrlKey) modifiers.push("CommandOrControl");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (!modifiers.length) return null;
  const aliases: Record<string, string> = { Space: "Space", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", Enter: "Enter", Tab: "Tab", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown" };
  const key = event.code.startsWith("Key")
    ? event.code.slice(3)
    : event.code.startsWith("Digit")
      ? event.code.slice(5)
      : /^F(?:[1-9]|1\d|2[0-4])$/.test(event.code)
        ? event.code
        : aliases[event.code] || (event.key.length === 1 && /[a-z0-9]/i.test(event.key) ? event.key.toUpperCase() : "");
  if (!key) return null;
  return [...modifiers, key].join("+");
}

function shortcutLabel(value: string, platform: string) {
  if (!value) return "—";
  return value.split("+").map((part) => part === "CommandOrControl" ? platform === "darwin" ? "⌘" : "Ctrl" : part === "Alt" && platform === "darwin" ? "⌥" : part === "Shift" && platform === "darwin" ? "⇧" : part).join(platform === "darwin" ? " " : " + ");
}

function cleanupSeconds(settings: DesktopSettings) {
  const unit = settings.autoCleanupUnit === "hours" ? 3_600 : settings.autoCleanupUnit === "days" ? 86_400 : 2_592_000;
  return Math.max(1, settings.autoCleanupAmount) * unit;
}

function nativeSettings(settings: DesktopSettings): QuickCompressSettings {
  const automatic = settings.preset.mode === "auto";
  return {
    mode: automatic ? "auto" : "manual",
    quality: automatic ? 86 : settings.preset.quality,
    scale: automatic ? 100 : settings.preset.scale,
    format: automatic ? "keep" : toNativeFormat(settings.preset.format),
    stripMetadata: settings.preset.stripMetadata,
    preventLarger: settings.preset.preventLarger,
    exportMode: settings.filePlacement,
    exportSuffix: settings.outputSuffix,
    renameTemplate: settings.renameTemplate,
    fixedFolder: settings.outputFolder || undefined,
  };
}

async function attachPreviews(items: ResultItem[], api: PicLiteBridge) {
  const paths = items.flatMap((item) => item.output ? [item.output] : []);
  if (!paths.length) return items;
  try {
    const images = await api.readImagesFromPaths(paths);
    const byPath = new Map(images.map((image) => [image.path, image]));
    return await Promise.all(items.map(async (item) => {
      const image = item.output ? byPath.get(item.output) : undefined;
      if (!image) return item;
      const blob = new Blob([image.data.slice().buffer as ArrayBuffer], { type: image.type });
      const preview = URL.createObjectURL(blob);
      try {
        // Decode directly from the blob. Fetching the freshly-created object
        // URL made a second full image copy and caused large transient spikes.
        const bitmap = await createImageBitmap(blob);
        const detailed = { ...item, preview, width: bitmap.width, height: bitmap.height };
        bitmap.close();
        return detailed;
      } catch {
        return { ...item, preview };
      }
    }));
  } catch {
    return items;
  }
}

function useOptimiser(api: PicLiteBridge | undefined, settings: DesktopSettings) {
  const [results, setResults] = useState<ResultItem[]>([]);
  const resultsRef = useRef<ResultItem[]>([]);
  const [working, setWorking] = useState(false);
  const resultLimit = Math.max(1, Math.min(20, settings.floatingMaxResults || 5));

  useEffect(() => { resultsRef.current = results; }, [results]);
  useEffect(() => () => {
    resultsRef.current.forEach((item) => item.preview && URL.revokeObjectURL(item.preview));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setResults((current) => {
      if (current.length <= resultLimit) return current;
      current.slice(resultLimit).forEach((item) => item.preview && URL.revokeObjectURL(item.preview));
      return current.slice(0, resultLimit);
    }), 0);
    return () => window.clearTimeout(timer);
  }, [resultLimit]);

  const optimise = useCallback(async (paths: string[], replace = false, overrides: Partial<OptimisationPreset> = {}) => {
    const imagePaths = supportedImagePaths(paths);
    if (!api || !imagePaths.length) return [] as ResultItem[];
    const effectiveSettings = { ...settings, preset: { ...settings.preset, ...overrides } };
    const unique = imagePaths;
    setWorking(true);
    const placeholders: ResultItem[] = unique.map((source) => ({ id: `${source}-${Date.now()}-${Math.random()}`, source, keptOriginal: false, status: "working" }));
    setResults((current) => {
      const next = (replace ? placeholders : [...placeholders, ...current]).slice(0, resultLimit);
      if (!replace) current.filter((item) => !next.some((candidate) => candidate.id === item.id)).forEach((item) => item.preview && URL.revokeObjectURL(item.preview));
      return next;
    });
    try {
      const output = await api.quickCompressPaths(unique, nativeSettings(effectiveSettings));
      const finished = await attachPreviews(output.map((item, index) => ({ ...item, id: placeholders[index].id, status: item.error ? "error" : "done" })), api);
      setResults((current) => current.map((item) => finished.find((candidate) => candidate.id === item.id) || item));
      return finished;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setResults((current) => current.map((item) => placeholders.some((candidate) => candidate.id === item.id) ? { ...item, status: "error", error: message } : item));
      return [] as ResultItem[];
    } finally {
      setWorking(false);
    }
  }, [api, resultLimit, settings]);

  const reoptimise = useCallback(async (item: ResultItem, overrides: Partial<OptimisationPreset> = {}, sourceOverride?: string) => {
    if (!api || item.status === "working") return;
    const source = sourceOverride || item.output || item.source;
    const effectiveSettings = { ...settings, preset: { ...settings.preset, ...overrides } };
    setWorking(true);
    setResults((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, source, status: "working", error: undefined } : candidate));
    try {
      const [output] = await api.quickCompressPaths([source], nativeSettings(effectiveSettings));
      if (!output) throw new Error(tr(settings.language, "没有生成压缩结果", "No optimised result was created"));
      const snapshot: ResultItem = { ...item, history: undefined };
      const [next] = await attachPreviews([{ ...output, id: item.id, status: output.error ? "error" : "done" }], api);
      const finished = { ...next, history: [...(item.history || []), snapshot] };
      setResults((current) => current.map((candidate) => {
        if (candidate.id !== item.id) return candidate;
        return finished;
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setResults((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status: "error", error: message } : candidate));
    } finally {
      setWorking(false);
    }
  }, [api, settings]);

  const remove = useCallback((id: string) => setResults((current) => {
    const target = current.find((item) => item.id === id);
    if (target?.preview) URL.revokeObjectURL(target.preview);
    return current.filter((item) => item.id !== id);
  }), []);

  const clear = useCallback(() => setResults((current) => {
    current.forEach((item) => item.preview && URL.revokeObjectURL(item.preview));
    return [];
  }), []);

  return { results, setResults, optimise, reoptimise, remove, clear, working };
}

function Brand({ compact = false }: { compact?: boolean }) {
  return <div className={`piclite-brand ${compact ? "compact" : ""}`}><span className="piclite-symbol"><i /><i /><i /><i /></span>{!compact && <strong>PicLite</strong>}</div>;
}

function DropSurface({ language, active, compact = false }: { language: Language; active: boolean; compact?: boolean }) {
  return <div className={`drop-surface ${active ? "active" : ""} ${compact ? "compact" : ""}`}>
    <span className="drop-rings"><i /><i /><i /></span>
    {!compact && <><strong><T language={language} zh="拖到这里优化" en="Drop to optimise" /></strong><small><T language={language} zh="图片将在本机处理" en="Images stay on this device" /></small></>}
  </div>;
}

function ResultActions({ item, api, settings, notify, onDownscale, onWatermark, onUndo, onUpload }: { item: ResultItem; api: PicLiteBridge; settings: DesktopSettings; notify: (text: string, tone?: OperationFeedbackTone) => void; onDownscale: () => void; onWatermark: () => void; onUndo: () => void; onUpload: () => void }) {
  const language = settings.language;
  const copy = () => copyImageWithFeedback(api.copyImagePath, item.output, language, notify);
  const runWithNotice = async (operation: () => Promise<unknown>, success: string) => {
    try {
      await operation();
      notify(success);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      notify(detail, "error");
    }
  };
  const preview = async () => {
    const output = item.output;
    if (!output) return;
    await runWithNotice(() => api.openImage(output), tr(language, "已打开预览", "Preview opened"));
  };
  const reveal = async () => {
    const output = item.output;
    if (!output) return;
    await runWithNotice(() => api.revealPath(output), tr(language, "已在文件夹中定位", "Shown in folder"));
  };
  const actions: Record<FloatingAction, { title: string; icon: string; disabled?: boolean; run: () => void }> = {
    downscale: { title: tr(language, "再缩小一半", "Downscale by half again"), icon: "minus", run: onDownscale },
    watermark: { title: tr(language, "按已保存参数添加水印", "Apply the saved watermark"), icon: "watermark", run: onWatermark },
    undo: { title: tr(language, "撤销上一次处理", "Undo last operation"), icon: "undo", disabled: !item.history?.length, run: onUndo },
    copy: { title: tr(language, "复制优化结果", "Copy optimised result"), icon: "copy", run: () => void copy() },
    preview: { title: tr(language, "在新窗口预览", "Open image in a new window"), icon: "eye", run: () => void preview() },
    reveal: { title: tr(language, "在文件夹中显示", "Show in folder"), icon: "folder", run: () => void reveal() },
    gallery: { title: tr(language, "打开图库", "Open library"), icon: "gallery", run: () => void runWithNotice(() => api.showGalleryWindow(), tr(language, "已打开图库", "Library opened")) },
    upload: { title: tr(language, "上传图床并复制链接", "Upload and copy URL"), icon: "upload", run: onUpload },
  };
  return <div className="result-actions">{settings.floatingActions.slice(0, 6).map((id) => { const action = actions[id]; return <button key={id} disabled={action.disabled} title={action.title} onClick={action.run}><Icon name={action.icon} /></button>; })}</div>;
}

async function makeWatermarkedImage(api: PicLiteBridge, item: ResultItem, watermark: FloatingWatermark) {
  const source = item.output || item.source;
  const [image] = await api.readImagesFromPaths([source]);
  if (!image) throw new Error("Image data is unavailable");
  const blob = new Blob([image.data.slice().buffer as ArrayBuffer], { type: image.type || "image/png" });
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable");
  context.drawImage(bitmap, 0, 0); bitmap.close();
  const watermarkLayer = document.createElement("canvas");
  watermarkLayer.width = canvas.width; watermarkLayer.height = canvas.height;
  const watermarkContext = watermarkLayer.getContext("2d", { alpha: true });
  if (!watermarkContext) throw new Error("Watermark canvas is unavailable");
  const fontSize = Math.max(8, Math.round(Math.min(canvas.width, canvas.height) * watermark.fontScale / 100));
  watermarkContext.font = `700 ${fontSize}px ${JSON.stringify(watermark.fontFamily)}, sans-serif`;
  watermarkContext.fillStyle = watermark.color;
  watermarkContext.textAlign = "center"; watermarkContext.textBaseline = "middle";
  if (watermark.shadow) { watermarkContext.shadowColor = watermark.shadowColor; watermarkContext.shadowBlur = watermark.shadowBlur; }
  const textWidth = Math.max(watermarkContext.measureText(watermark.text).width, fontSize * 2);
  const gap = Math.max(fontSize * 1.6, textWidth * (0.7 + (100 - watermark.density) / 25));
  watermarkContext.save();
  watermarkContext.translate(canvas.width / 2, canvas.height / 2); watermarkContext.rotate(watermark.rotation * Math.PI / 180);
  for (let y = -canvas.height * 1.5; y <= canvas.height * 1.5; y += gap) for (let x = -canvas.width * 1.5; x <= canvas.width * 1.5; x += gap) watermarkContext.fillText(watermark.text, x, y);
  watermarkContext.restore();
  context.save();
  context.globalAlpha = Math.max(0.01, Math.min(1, watermark.opacity / 100));
  context.drawImage(watermarkLayer, 0, 0);
  context.restore();
  const output = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Watermark encoding failed")), "image/png"));
  return api.cacheImageData(new Uint8Array(await output.arrayBuffer()), `watermark-${Date.now()}.png`);
}

function resultFormat(item: ResultItem) {
  const extension = fileName(item.output || item.source).split(".").pop()?.toLowerCase();
  return extension === "jpg" ? "jpeg" : extension;
}

function FormatBar({ value, update }: { value?: string; update: (format: ImageFormat) => void }) {
  return <div className="format-bar">
    {(["keep", "jpeg", "webp", "png"] as ImageFormat[]).map((format) => <button key={format} className={(format === "keep" ? value === "auto" : value === format) ? "active" : ""} onClick={(event) => { event.stopPropagation(); update(format); }}>{format === "keep" ? "AUTO" : format.toUpperCase()}</button>)}
  </div>;
}

function ResultCard({ item, api, settings, active, allowWindowDrag = true, notify, remove, select, downscale, watermark, undo, upload, updateFormat }: { item: ResultItem; api: PicLiteBridge; settings: DesktopSettings; active: boolean; allowWindowDrag?: boolean; notify?: (text: string, tone?: OperationFeedbackTone) => void; remove: () => void; select: () => void; downscale: () => void; watermark: () => void; undo: () => void; upload: () => void; updateFormat: (format: ImageFormat) => void }) {
  const saved = percentage(item);
  const format = resultFormat(item);
  const startWindowDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button, input, select, a")) return;
    event.preventDefault();
    void api.startDragging();
  };
  return <article className={`result-card ${settings.floatingLayout} ${item.status} ${active ? "active" : ""}`} onClick={select} onContextMenu={(event) => { if (!item.output) return; event.preventDefault(); void api.openImage(item.output); }}>
    <div className="result-preview" onPointerDown={allowWindowDrag ? startWindowDrag : undefined}>
      {item.preview ? <img src={item.preview} alt={fileName(item.source)} /> : <Icon name={item.status === "working" ? "spark" : "image"} />}
      <div className="result-overlay">
        <strong className="result-name" title={fileName(item.source)}>{fileName(item.source)}</strong>
        {item.status === "working" ? <><span className="result-state"><T language={settings.language} zh="正在自动选择最优结果…" en="Choosing the best result…" /></span><div className="progress"><i /></div></> : item.error ? <span className="result-error">{item.error}</span> : <>
          <div className="result-metrics"><b>{formatBytes(item.originalBytes)}</b><span>→</span><b>{formatBytes(item.outputBytes)}</b>{saved != null && <em className={saved < 0 ? "bad" : ""}>{saved > 0 ? `−${saved}%` : saved === 0 ? "0%" : `+${Math.abs(saved)}%`}</em>}</div>
          {(item.width && item.height) ? <small className="result-dimensions"><Icon name="image" /> {item.width.toLocaleString()} × {item.height.toLocaleString()}</small> : null}
          <FormatBar value={settings.preset.mode === "auto" && item.keptOriginal ? "auto" : format} update={updateFormat} />
        </>}
      </div>
      {item.status === "done" && <div className="result-hover-actions" onClick={(event) => event.stopPropagation()}>
        <ResultActions item={item} api={api} settings={settings} notify={notify || (() => undefined)} onDownscale={downscale} onWatermark={watermark} onUndo={undo} onUpload={upload} />
      </div>}
    </div>
    <button className="result-close" title={tr(settings.language, "移除", "Dismiss")} onClick={(event) => { event.stopPropagation(); remove(); }}><Icon name="close" /></button>
  </article>;
}

function FloatingResults({ api }: { api: PicLiteBridge }) {
  const [settings, setSettings] = useDesktopSettings();
  const { results, setResults, optimise, reoptimise, remove, clear, working } = useOptimiser(api, settings);
  const [dragging, setDragging] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [updateNotice, setUpdateNotice] = useState<{ text: string; url?: string } | null>(null);
  const [operationNotice, setOperationNotice] = useState<{ text: string; tone: OperationFeedbackTone } | null>(null);
  const timer = useRef<number | null>(null);
  const operationNoticeTimer = useRef<number | null>(null);
  const resizeTimer = useRef<number | null>(null);
  const swipeStartY = useRef<number | null>(null);
  const wheelLocked = useRef(false);
  const autoUpdateCheckStartedRef = useRef(false);
  const cleanupRetentionSeconds = cleanupSeconds(settings);

  const showOperationNotice = useCallback((text: string, tone: OperationFeedbackTone = "success") => {
    if (operationNoticeTimer.current) window.clearTimeout(operationNoticeTimer.current);
    setOperationNotice({ text, tone });
    operationNoticeTimer.current = window.setTimeout(() => {
      setOperationNotice(null);
      operationNoticeTimer.current = null;
    }, 2400);
  }, []);

  useEffect(() => () => {
    if (operationNoticeTimer.current) window.clearTimeout(operationNoticeTimer.current);
  }, []);

  const startEmptyWindowDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button, input, select, a")) return;
    event.preventDefault();
    void api.startDragging();
  };
  const chooseLocalImages = async () => {
    const images = await api.selectImages();
    if (images.length) await optimise(images.map((image) => image.path));
  };

  useEffect(() => { void api.configureDropzoneWindow(settings.floatingWidth, settings.floatingHeight); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void api.setContentProtected(!settings.allowFloatingCapture).catch(() => undefined); }, [api, settings.allowFloatingCapture]);
  useEffect(() => { void ensureFontLoaded(api, settings.floatingWatermark.fontFamily).catch(() => undefined); }, [api, settings.floatingWatermark.fontFamily]);
  useEffect(() => api.onWindowResized((size) => {
    if (resizeTimer.current) window.clearTimeout(resizeTimer.current);
    resizeTimer.current = window.setTimeout(() => setSettings((current) => {
      const width = Math.max(280, size.width); const height = Math.max(220, size.height);
      return current.floatingWidth === width && current.floatingHeight === height ? current : { ...current, floatingWidth: width, floatingHeight: height };
    }), 220);
  }), [api, setSettings]);
  useEffect(() => {
    if (!settings.autoCleanupEnabled || settings.filePlacement !== "fixed-folder" || !settings.outputFolder) return;
    const cleanup = () => api.cleanupOptimisedFiles({ folder: settings.outputFolder, suffix: settings.outputSuffix, olderThanSeconds: cleanupRetentionSeconds }).catch(() => undefined);
    void cleanup();
    const interval = window.setInterval(() => void cleanup(), Math.min(30 * 60 * 1000, Math.max(5 * 60 * 1000, cleanupRetentionSeconds * 250)));
    return () => window.clearInterval(interval);
  }, [api, cleanupRetentionSeconds, settings.autoCleanupEnabled, settings.filePlacement, settings.outputFolder, settings.outputSuffix]);
  useEffect(() => api.onFileDrop((event) => {
    setDragging(event.type === "over");
    if (event.type === "drop" && event.paths?.length) void optimise(event.paths);
  }), [api, optimise]);
  useEffect(() => api.onClipboardPaths((paths) => {
    if (!settings.clipboardOptimiser || !settings.clipboardImageFiles || settings.pauseAutomaticOptimisations) return;
    void api.showDropzoneWindow().then(() => optimise(paths));
  }), [api, optimise, settings.clipboardImageFiles, settings.clipboardOptimiser, settings.pauseAutomaticOptimisations]);
  useEffect(() => api.onClipboardImage((data) => {
    if (!settings.clipboardOptimiser || !settings.clipboardImageData || settings.pauseAutomaticOptimisations) return;
    void api.cacheImageData(data, `clipboard-${Date.now()}.png`).then((path) => api.showDropzoneWindow().then(() => optimise([path])));
  }), [api, optimise, settings.clipboardImageData, settings.clipboardOptimiser, settings.pauseAutomaticOptimisations]);
  useEffect(() => api.onWatcherEvent((event) => {
    if (event.type !== "success" || !event.file || !event.output) return;
    const item: ResultItem = {
      id: `watch-${event.time}-${event.output}`,
      source: event.file,
      output: event.output,
      originalBytes: event.originalBytes,
      outputBytes: event.outputBytes,
      keptOriginal: false,
      status: "done",
    };
    void attachPreviews([item], api).then((items) => setResults((current) => [...items, ...current]));
  }), [api, setResults]);
  const checkUpdates = useCallback(async (showResult: boolean) => {
    try {
      const info = await api.checkForUpdates();
      localStorage.setItem(LAST_UPDATE_CHECK_KEY, String(Date.now()));
      setUpdateNotice(info.available
        ? { text: tr(settings.language, `发现 PicLite ${info.latestVersion}`, `PicLite ${info.latestVersion} available`), url: info.releaseUrl }
        : showResult ? { text: tr(settings.language, `PicLite ${info.currentVersion} 已是最新版`, `PicLite ${info.currentVersion} is up to date`) } : null);
    } catch {
      if (showResult) {
        setUpdateNotice({ text: tr(settings.language, "检查更新失败，请稍后重试", "Update check failed. Try again later.") });
      }
    }
  }, [api, settings.language]);
  const uploadResult = useCallback(async (item: ResultItem) => {
    if (!item.output) return;
    try {
      const profile = await api.loadUploadProfile();
      if (!profile) { setUpdateNotice({ text: tr(settings.language, "请先在设置中保存图床配置", "Save an image-host profile in Settings first") }); await api.showPreferencesWindow(); return; }
      const [image] = await api.readImagesFromPaths([item.output]);
      if (!image) throw new Error(tr(settings.language, "无法读取当前结果图", "Could not read the current result"));
      const uploaded = await api.uploadImage({ ...profile, fileName: image.name, mimeType: image.type, data: image.data });
      await api.copyText(uploaded.url);
      setUpdateNotice({ text: tr(settings.language, "图床链接已复制", "Image URL copied") });
    } catch (error) { setUpdateNotice({ text: error instanceof Error ? error.message : String(error) }); }
  }, [api, settings.language]);
  useEffect(() => {
    if (autoUpdateCheckStartedRef.current || settings.updateCheckFrequency === "never") return;
    const lastChecked = Number(localStorage.getItem(LAST_UPDATE_CHECK_KEY) || 0);
    const elapsed = Date.now() - lastChecked;
    const due = settings.updateCheckFrequency === "startup"
      || (settings.updateCheckFrequency === "daily" && elapsed >= 24 * 60 * 60 * 1000)
      || (settings.updateCheckFrequency === "weekly" && elapsed >= 7 * 24 * 60 * 60 * 1000);
    if (!due) return;
    autoUpdateCheckStartedRef.current = true;
    const timer = window.setTimeout(() => void checkUpdates(false), 0);
    return () => window.clearTimeout(timer);
  }, [checkUpdates, settings.updateCheckFrequency]);
  useEffect(() => api.onTrayAction((action) => {
    if (action === "about") {
      void api.openExternal("https://github.com/amiaoapp/PicLite");
      return;
    }
    if (action === "dropzone") { void api.showDropzoneWindow(); return; }
    if (action === "gallery") { void api.showGalleryWindow(); return; }
    if (action === "image_host_settings") { void api.showPreferencesWindow(); return; }
    if (action === "upload_current") {
      const current = results.find((item) => item.id === selectedId) || results[0];
      if (current) void uploadResult(current);
      return;
    }
    if (action !== "optimise_clipboard" && action !== "optimise_clipboard_aggressive" && action !== "downscale_clipboard") return;
    void api.readClipboardImage().then(async (image) => {
      const clipboardPaths = image ? [] : await api.readClipboardPaths();
      if (!image && !clipboardPaths.length) return;
      const paths = image ? [await api.cacheImageData(image.data, `clipboard-${Date.now()}.png`)] : clipboardPaths;
      const overrides: Partial<OptimisationPreset> = action === "optimise_clipboard_aggressive"
        ? { mode: "manual", quality: 45 }
        : action === "downscale_clipboard"
          ? { mode: "manual", scale: Math.max(10, Math.round(settings.preset.scale / 2)) }
          : {};
      if (Object.keys(overrides).length) setSettings((current) => ({ ...current, preset: { ...current.preset, ...overrides } }));
      await optimise(paths, false, overrides);
    });
  }), [api, checkUpdates, optimise, results, selectedId, setSettings, settings.preset.scale, uploadResult]);
  useEffect(() => {
    if (!settings.autoHideResults || !results.length || working) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void api.hideCurrentWindow(), Math.max(1, settings.autoHideSeconds) * 1000);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [api, results.length, settings.autoHideResults, settings.autoHideSeconds, working]);

  const updateFormat = async (item: ResultItem, format: ImageFormat) => {
    setSettings((current) => ({ ...current, preset: { ...current.preset, mode: format === "keep" ? "auto" : "manual", format, scale: format === "keep" ? 100 : current.preset.scale } }));
    await reoptimise(item, { mode: format === "keep" ? "auto" : "manual", format, scale: format === "keep" ? 100 : settings.preset.scale, preventLarger: format === "keep" });
  };
  const undo = (item: ResultItem) => setResults((current) => current.map((candidate) => {
    if (candidate.id !== item.id || !candidate.history?.length) return candidate;
    const restored = candidate.history[candidate.history.length - 1];
    if (candidate.preview && candidate.preview !== restored.preview) URL.revokeObjectURL(candidate.preview);
    return { ...restored, history: candidate.history.slice(0, -1) };
  }));
  const applySavedWatermark = async (item: ResultItem) => {
    try {
      const path = await makeWatermarkedImage(api, item, settings.floatingWatermark);
      const currentFormat = resultFormat(item);
      const format: ImageFormat = currentFormat === "jpeg" || currentFormat === "webp" || currentFormat === "png" ? currentFormat : "keep";
      // Preserve the displayed format. The old path forced every watermarked
      // result through lossless PNG, turning small WebP files into multi-MB PNGs.
      await reoptimise(item, {
        mode: format === "keep" ? "auto" : "manual",
        format,
        scale: 100,
        quality: format === "png" ? Math.min(90, settings.preset.quality || 86) : settings.preset.mode === "auto" ? 86 : settings.preset.quality,
        preventLarger: false,
      }, path);
    } catch (error) {
      setUpdateNotice({ text: error instanceof Error ? error.message : String(error) });
    }
  };
  const rotateResults = (direction: 1 | -1) => setResults((current) => {
    if (current.length < 2) return current;
    const next = direction > 0 ? [...current.slice(1), current[0]] : [current[current.length - 1], ...current.slice(0, -1)];
    setSelectedId(next[0].id);
    return next;
  });
  return <main className={`floating-results ${settings.floatingLayout} display-${settings.floatingDisplayMode}`} onMouseEnter={() => timer.current && window.clearTimeout(timer.current)}>
    {!results.length ? <section className="floating-empty" onPointerDown={startEmptyWindowDrag}>
      <DropSurface language={settings.language} active={dragging} />
      <div className="floating-empty-footer">
        <span><T language={settings.language} zh="拖动空白区域可移动悬浮窗" en="Drag the empty area to move this window" /></span>
        <div>
          <button title={tr(settings.language, "选择本地图片", "Choose local images")} onPointerDown={(event) => event.stopPropagation()} onClick={() => void chooseLocalImages()}><Icon name="plus" /></button>
          <button title={tr(settings.language, "打开工作台", "Open workbench")} onPointerDown={(event) => event.stopPropagation()} onClick={() => void api.showMainWindow()}><Icon name="external" /></button>
          <button title={tr(settings.language, "关闭悬浮窗", "Close floating window")} onPointerDown={(event) => event.stopPropagation()} onClick={() => void api.hideCurrentWindow()}><Icon name="close" /></button>
        </div>
      </div>
    </section> : <>
      <div className={`floating-list ${settings.floatingDisplayMode}`} onClick={(event) => { if (settings.floatingDisplayMode === "stack" && !(event.target as HTMLElement).closest("button, input, select, a")) rotateResults(1); }} onWheel={(event) => { if (settings.floatingDisplayMode !== "stack" || Math.abs(event.deltaY) < 4 || wheelLocked.current) return; event.preventDefault(); wheelLocked.current = true; rotateResults(event.deltaY > 0 ? 1 : -1); window.setTimeout(() => { wheelLocked.current = false; }, 180); }} onPointerDown={(event) => { if (settings.floatingDisplayMode === "stack" && !(event.target as HTMLElement).closest("button, input, select, a")) swipeStartY.current = event.clientY; }} onPointerUp={(event) => { if (swipeStartY.current == null) return; const delta = event.clientY - swipeStartY.current; swipeStartY.current = null; if (Math.abs(delta) > 28) rotateResults(delta < 0 ? 1 : -1); }}>{results.map((item, index) => {
        const active = selectedId ? selectedId === item.id : index === 0;
        return <div className="floating-result-slot" key={item.id} style={{ "--stack-index": index } as React.CSSProperties}><ResultCard item={item} api={api} settings={settings} active={active} allowWindowDrag={settings.floatingDisplayMode !== "stack"} notify={showOperationNotice} select={() => setSelectedId(item.id)} remove={() => remove(item.id)} downscale={() => void reoptimise(item, { mode: "manual", scale: 50, preventLarger: false })} watermark={() => void applySavedWatermark(item)} upload={() => void uploadResult(item)} undo={() => { undo(item); showOperationNotice(tr(settings.language, "已撤销上一次处理", "Last operation undone")); }} updateFormat={(format) => void updateFormat(item, format)} /></div>;
      })}</div>
      <footer className="floating-footer" onPointerDown={startEmptyWindowDrag}>
        <button className={`automatic-badge ${operationNotice ? `operation-${operationNotice.tone}` : updateNotice?.url ? "has-update" : ""}`} title={operationNotice?.text || updateNotice?.text} aria-live="polite" onClick={() => !operationNotice && updateNotice?.url && void api.openExternal(updateNotice.url)}><Icon name={operationNotice ? operationNotice.tone === "success" ? "check" : "info" : "spark"} /><span>{operationNotice?.text || updateNotice?.text || <T language={settings.language} zh="首次自动择优" en="Smart first pass" />}</span></button>
        <div><button title={tr(settings.language, settings.floatingDisplayMode === "stack" ? "展开结果" : "堆叠结果", settings.floatingDisplayMode === "stack" ? "Expand results" : "Stack results")} onClick={() => setSettings((current) => ({ ...current, floatingDisplayMode: current.floatingDisplayMode === "stack" ? "list" : "stack" }))}><Icon name="results" /></button><button title={tr(settings.language, "打开完整工作台", "Open full workbench")} onClick={() => void api.showMainWindow()}><Icon name="menu" /></button>{settings.showCopyClearButtons && <button title={tr(settings.language, "清空", "Clear all")} onClick={clear}><Icon name="clear" /></button>}<button title={tr(settings.language, "关闭悬浮窗", "Close floating window")} onClick={() => void api.hideCurrentWindow()}><Icon name="close" /></button></div>
      </footer>
    </>}
    <button className="floating-resize-handle" aria-label={tr(settings.language, "调整悬浮窗大小", "Resize floating window")} title={tr(settings.language, "拖动调整大小", "Drag to resize")} onPointerDown={(event) => { event.preventDefault(); void api.startResizeDragging("SouthEast"); }} />
  </main>;
}

function BatchOptimiser({ api }: { api: PicLiteBridge }) {
  const [settings] = useDesktopSettings();
  const { results, optimise, remove, clear, working } = useOptimiser(api, settings);
  const [dragging, setDragging] = useState(false);
  useEffect(() => api.onFileDrop((event) => {
    setDragging(event.type === "over");
    if (event.type === "drop" && event.paths?.length) void optimise(event.paths);
  }), [api, optimise]);
  useEffect(() => api.onTrayAction((action) => {
    if (action === "preferences") void api.showPreferencesWindow();
    if (action === "dropzone") void api.showDropzoneWindow();
  }), [api]);
  const choose = async () => {
    const files = await api.selectImages();
    await optimise(files.map((file) => file.path));
  };
  return <main className="batch-window">
    <header className="batch-toolbar"><Brand /><div className="window-title"><T language={settings.language} zh="批量优化器" en="Batch optimiser" /></div><div className="toolbar-actions"><button title={tr(settings.language, "设置", "Settings")} onClick={() => void api.showPreferencesWindow()}><Icon name="gear" /></button></div></header>
    <section className={`batch-drop ${dragging ? "active" : ""}`} onDoubleClick={() => void choose()}>
      <DropSurface language={settings.language} active={dragging} />
      <button className="primary" onClick={() => void choose()}><Icon name="plus" /><T language={settings.language} zh="选择图片" en="Choose images" /></button>
    </section>
    <section className="batch-table">
      <header><span><T language={settings.language} zh="文件" en="File" /></span><span><T language={settings.language} zh="原始" en="Original" /></span><span><T language={settings.language} zh="结果" en="Result" /></span><span><T language={settings.language} zh="节省" en="Saved" /></span><span /></header>
      {!results.length ? <div className="batch-empty"><Icon name="image" /><T language={settings.language} zh="拖入图片或点击“选择图片”开始" en="Drop images or choose files to begin" /></div> : results.map((item) => <div className="batch-row" key={item.id}>
        <span className="batch-name">{item.preview ? <img src={item.preview} alt="" /> : <Icon name="image" />}<span><strong>{fileName(item.source)}</strong><small>{item.status === "working" ? tr(settings.language, "正在优化", "Optimising") : item.error || fileName(item.output || "")}</small></span></span>
        <span>{formatBytes(item.originalBytes)}</span><span>{formatBytes(item.outputBytes)}</span><span className="saved">{percentage(item) == null ? "—" : `${percentage(item)}%`}</span><span className="row-actions"><button disabled={!item.output} title={tr(settings.language, "显示文件", "Reveal")} onClick={() => item.output && void api.revealPath(item.output)}><Icon name="folder" /></button><button title={tr(settings.language, "移除", "Remove")} onClick={() => remove(item.id)}><Icon name="close" /></button></span>
      </div>)}
    </section>
    <footer className="batch-status"><span>{working ? tr(settings.language, "正在处理…", "Working…") : tr(settings.language, `完成 ${results.filter((item) => item.status === "done").length} / ${results.length}`, `Done ${results.filter((item) => item.status === "done").length} / ${results.length}`)}</span><div className="progress"><i style={{ width: results.length ? `${results.filter((item) => item.status !== "working").length / results.length * 100}%` : "0%" }} /></div><button disabled={!results.length} onClick={clear}><T language={settings.language} zh="停止并清空" en="Stop and clear" /></button></footer>
  </main>;
}

type SettingsSection = "general" | "clipboard" | "files" | "images" | "dropzone" | "zones" | "floating" | "hosting" | "plugins" | "shortcuts" | "about" | "sponsor";

const SETTINGS_SECTIONS = new Set<SettingsSection>(["general", "clipboard", "files", "images", "dropzone", "zones", "floating", "hosting", "plugins", "shortcuts", "about", "sponsor"]);

function requestedSettingsSection(): SettingsSection {
  const requested = localStorage.getItem(REQUESTED_SETTINGS_SECTION_KEY);
  localStorage.removeItem(REQUESTED_SETTINGS_SECTION_KEY);
  if (requested && SETTINGS_SECTIONS.has(requested as SettingsSection)) return requested as SettingsSection;
  return "general";
}

const settingsNav: Array<{ id: SettingsSection; icon: string; zh: string; en: string; group?: string }> = [
  { id: "general", icon: "gear", zh: "外观与通用", en: "Appearance & General" },
  { id: "clipboard", icon: "clipboard", zh: "剪贴板", en: "Clipboard" },
  { id: "files", icon: "folder", zh: "文件处理", en: "File handling" },
  { id: "images", icon: "image", zh: "图片", en: "Images", group: "types" },
  { id: "dropzone", icon: "drop", zh: "拖放区", en: "Drop Zone", group: "results" },
  { id: "zones", icon: "zones", zh: "悬浮按钮", en: "Action Buttons" },
  { id: "floating", icon: "results", zh: "悬浮结果", en: "Floating Results" },
  { id: "hosting", icon: "upload", zh: "图床上传", en: "Image Hosting" },
  { id: "plugins", icon: "zones", zh: "插件", en: "Plugins" },
  { id: "shortcuts", icon: "shortcut", zh: "键盘快捷键", en: "Keyboard Shortcuts", group: "automation" },
  { id: "about", icon: "info", zh: "更新与关于", en: "Updates & About", group: "support" },
  { id: "sponsor", icon: "heart", zh: "赞助支持", en: "Support PicLite" },
];

const FLOATING_ACTION_OPTIONS: FloatingAction[] = ["downscale", "watermark", "undo", "copy", "preview", "reveal", "gallery", "upload"];

function floatingActionLabel(language: Language, action: FloatingAction) {
  return ({
    downscale: tr(language, "减半", "Half"),
    watermark: tr(language, "水印", "Watermark"),
    undo: tr(language, "撤销", "Undo"),
    copy: tr(language, "复制", "Copy"),
    preview: tr(language, "预览", "Preview"),
    reveal: tr(language, "定位", "Reveal"),
    gallery: tr(language, "图库", "Library"),
    upload: tr(language, "图床", "Upload"),
  } as Record<FloatingAction, string>)[action];
}

function floatingActionIcon(action: FloatingAction) {
  return ({ downscale: "minus", watermark: "watermark", undo: "undo", copy: "copy", preview: "eye", reveal: "folder", gallery: "gallery", upload: "upload" } as Record<FloatingAction, string>)[action];
}

function SettingsRow({ title, note, children }: { title: React.ReactNode; note?: React.ReactNode; children: React.ReactNode }) {
  return <div className="settings-row"><div><strong>{title}</strong>{note && <small>{note}</small>}</div><div className="settings-control">{children}</div></div>;
}

function SettingsCard({ title, note, children }: { title?: React.ReactNode; note?: React.ReactNode; children: React.ReactNode }) {
  return <section className="settings-block">{title && <header><h2>{title}</h2>{note && <p>{note}</p>}</header>}<div className="settings-card">{children}</div></section>;
}

function Preferences({ api }: { api: PicLiteBridge }) {
  const [settings, setSettings] = useDesktopSettings();
  const [section, setSection] = useState<SettingsSection>(requestedSettingsSection);
  const [updateText, setUpdateText] = useState("");
  const [recordingShortcut, setRecordingShortcut] = useState<"shortcutToggleDropzone" | "shortcutOptimiseClipboard" | "shortcutShowMain" | "shortcutShowGallery" | "shortcutUploadCurrent" | null>(null);
  const [shortcutStatus, setShortcutStatus] = useState("");
  const [cleanupText, setCleanupText] = useState("");
  const [systemFonts, setSystemFonts] = useState<SystemFontInfo[]>([]);
  const [fontStatus, setFontStatus] = useState("");
  const fontInputRef = useRef<HTMLInputElement>(null);
  const pluginInputRef = useRef<HTMLInputElement>(null);
  const [workspacePlugins, setWorkspacePlugins] = useState<WorkspacePlugin[]>(loadWorkspacePlugins);
  const [pluginUrl, setPluginUrl] = useState("https://banner.xmit.dev/");
  const [pluginStatus, setPluginStatus] = useState("");
  const [uploadProfile, setUploadProfile] = useState<StoredUploadProfile>({ provider: "webdav", endpoint: "", bucket: "", region: "auto", accessKey: "", username: "", port: 22, remotePath: "piclite", publicBaseUrl: "", keyPath: "", pathStyle: true, secret: "" });
  const [uploadSaved, setUploadSaved] = useState("");
  const language = settings.language;
  const patch = <K extends keyof DesktopSettings>(key: K, value: DesktopSettings[K]) => setSettings((current) => ({ ...current, [key]: value }));
  const patchPreset = (value: Partial<DesktopSettings["preset"]>) => setSettings((current) => ({ ...current, preset: { ...current.preset, ...value } }));
  useEffect(() => { void isAutostartEnabled().then((value) => patch("launchAtLogin", value)).catch(() => undefined); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    void api.setWindowTheme(settings.appearance);
    void api.updateDesktopPreferences({
      minimizeToTray: true,
      showInTaskbarDock: settings.showInTaskbarDock,
      clipboardWatcherEnabled: settings.clipboardOptimiser,
    });
  }, [api, settings.appearance, settings.clipboardOptimiser, settings.showInTaskbarDock]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyAppearance = () => {
      const resolved = settings.appearance === "system" ? (media.matches ? "dark" : "light") : settings.appearance;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.dataset.palette = settings.colorTheme;
      document.documentElement.style.colorScheme = resolved;
    };
    applyAppearance();
    media.addEventListener("change", applyAppearance);
    return () => media.removeEventListener("change", applyAppearance);
  }, [settings.appearance, settings.colorTheme]);
  const refreshFonts = useCallback(async () => {
    setFontStatus(tr(language, "正在读取本地字体…", "Reading local fonts…"));
    try {
      const [fonts, imported] = await Promise.all([api.listSystemFonts(), api.loadImportedFonts()]);
      setSystemFonts([...fonts, ...imported.map((font) => ({ family: font.family, path: "", faceIndex: 0 }))]);
      await Promise.all(imported.map((font) => installFontFace(font.family, font.data).catch(() => undefined)));
      setFontStatus(tr(language, `已读取 ${new Set([...fonts.map((font) => font.family), ...imported.map((font) => font.family)]).size} 个字体`, `${new Set([...fonts.map((font) => font.family), ...imported.map((font) => font.family)]).size} fonts available`));
    } catch (error) {
      setFontStatus(error instanceof Error ? error.message : String(error));
    }
  }, [api, language]);
  useEffect(() => {
    const timer = window.setTimeout(() => void Promise.all([refreshFonts(), api.loadUploadProfile()]).then(([, profile]) => { if (profile) setUploadProfile(profile); }), 0);
    return () => window.clearTimeout(timer);
  }, [api, refreshFonts]);
  useEffect(() => { localStorage.setItem(WORKSPACE_PLUGINS_KEY, JSON.stringify(workspacePlugins)); }, [workspacePlugins]);
  useEffect(() => api.onTrayAction((action) => {
    if (action === "image_host_settings") setSection("hosting");
    if (action.startsWith("preferences_section:")) {
      const requested = action.slice("preferences_section:".length) as SettingsSection;
      if (SETTINGS_SECTIONS.has(requested)) setSection(requested);
    }
  }), [api]);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== REQUESTED_SETTINGS_SECTION_KEY || !event.newValue) return;
      const requested = event.newValue as SettingsSection;
      if (SETTINGS_SECTIONS.has(requested)) {
        setSection(requested);
        localStorage.removeItem(REQUESTED_SETTINGS_SECTION_KEY);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);


  const toggleAutostart = async (value: boolean) => {
    if (value) await enableAutostart(); else await disableAutostart();
    patch("launchAtLogin", value);
  };
  const chooseOutput = async () => {
    const path = await api.selectFolder("export");
    if (path) patch("outputFolder", path);
  };
  const captureShortcut = useCallback((event: ShortcutKeyEvent & { preventDefault: () => void; stopPropagation: () => void }, key: "shortcutToggleDropzone" | "shortcutOptimiseClipboard" | "shortcutShowMain" | "shortcutShowGallery" | "shortcutUploadCurrent") => {
    event.preventDefault();
    event.stopPropagation();
    const shortcut = shortcutFromEvent(event);
    if (shortcut === null) return;
    if (shortcut === "escape") {
      setRecordingShortcut(null);
      return;
    }
    setSettings((current) => ({ ...current, [key]: shortcut }));
    setRecordingShortcut(null);
  }, [setSettings]);
  useEffect(() => {
    if (!recordingShortcut) return;
    const capture = (event: globalThis.KeyboardEvent) => captureShortcut(event, recordingShortcut);
    window.addEventListener("keydown", capture, true);
    return () => window.removeEventListener("keydown", capture, true);
  }, [captureShortcut, recordingShortcut]);
  useEffect(() => {
    void api.configureGlobalShortcuts({
      enabled: settings.shortcutsEnabled && !recordingShortcut,
      toggleDropzone: settings.shortcutToggleDropzone,
      optimiseClipboard: settings.shortcutOptimiseClipboard,
      showMain: settings.shortcutShowMain,
      showGallery: settings.shortcutShowGallery,
      uploadCurrent: settings.shortcutUploadCurrent,
    }).then(() => setShortcutStatus(""), (error) => setShortcutStatus(error instanceof Error ? error.message : String(error)));
  }, [api, recordingShortcut, settings.shortcutOptimiseClipboard, settings.shortcutShowGallery, settings.shortcutShowMain, settings.shortcutToggleDropzone, settings.shortcutUploadCurrent, settings.shortcutsEnabled]);
  const cleanNow = async () => {
    if (!settings.outputFolder) return;
    setCleanupText(tr(language, "正在清理…", "Cleaning…"));
    try {
      const result = await api.cleanupOptimisedFiles({ folder: settings.outputFolder, suffix: settings.outputSuffix, olderThanSeconds: cleanupSeconds(settings) });
      setCleanupText(tr(language, `已删除 ${result.deleted} 张到期结果图`, `Deleted ${result.deleted} expired result(s)`));
    } catch (error) {
      setCleanupText(error instanceof Error ? error.message : String(error));
    }
  };
  const checkUpdates = useCallback(async () => {
    setUpdateText(tr(language, "正在检查…", "Checking…"));
    try {
      const info = await api.checkForUpdates();
      localStorage.setItem(LAST_UPDATE_CHECK_KEY, String(Date.now()));
      setUpdateText(info.available ? tr(language, `发现新版本 ${info.latestVersion}`, `Version ${info.latestVersion} is available`) : tr(language, `已经是最新版 ${info.currentVersion}`, `PicLite ${info.currentVersion} is up to date`));
    } catch (error) {
      setUpdateText(String(error));
    }
  }, [api, language]);
  useEffect(() => {
    if (section !== "about" || updateText) return;
    const timer = window.setTimeout(() => void checkUpdates(), 80);
    return () => window.clearTimeout(timer);
  }, [checkUpdates, section, updateText]);
  const selectWatermarkFont = async (family: string) => {
    patch("floatingWatermark", { ...settings.floatingWatermark, fontFamily: family });
    setFontStatus(tr(language, `正在载入 ${family}…`, `Loading ${family}…`));
    try {
      await ensureFontLoaded(api, family, systemFonts);
      setFontStatus(tr(language, `已应用 ${family}`, `${family} applied`));
    } catch (error) {
      setFontStatus(error instanceof Error ? error.message : String(error));
    }
  };
  const importFont = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const family = file.name.replace(/\.(ttf|otf|ttc|woff2?)$/i, "");
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      await api.saveImportedFont(family, data);
      await installFontFace(family, data);
      await selectWatermarkFont(family);
      await refreshFonts();
    } catch (error) {
      setFontStatus(error instanceof Error ? error.message : String(error));
    }
  };
  const importPlugin = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const raw = await file.text();
      let name = file.name.replace(/\.(html?|js|json)$/i, "");
      let source = file.name.toLowerCase().endsWith(".js") ? jsPluginDocument(raw) : raw;
      if (file.name.toLowerCase().endsWith(".json")) {
        const manifest = JSON.parse(raw) as { name?: string; nameZh?: string; nameEn?: string; html?: string; script?: string; url?: string };
        name = manifest.name || manifest.nameZh || name;
        source = manifest.html || (manifest.script ? jsPluginDocument(manifest.script) : "");
        setWorkspacePlugins((current) => [...current, { id: `custom-${Date.now()}`, nameZh: manifest.nameZh || name, nameEn: manifest.nameEn || manifest.name || name, kind: manifest.url ? "url" : "html", enabled: true, source, url: manifest.url }]);
      } else {
        setWorkspacePlugins((current) => [...current, { id: `custom-${Date.now()}`, nameZh: name, nameEn: name, kind: "html", enabled: true, source }]);
      }
      setPluginStatus(tr(language, "插件已添加到工作台", "Plugin added to the workbench"));
    } catch (error) {
      setPluginStatus(error instanceof Error ? error.message : String(error));
    }
  };
  const addUrlPlugin = () => {
    try {
      const url = new URL(pluginUrl);
      if (!/^https?:$/.test(url.protocol)) throw new Error(tr(language, "只支持 HTTP(S) 地址", "Only HTTP(S) URLs are supported"));
      setWorkspacePlugins((current) => [...current, { id: `url-${Date.now()}`, nameZh: url.hostname, nameEn: url.hostname, kind: "url", enabled: true, url: url.toString() }]);
      setPluginStatus(tr(language, "网页插件已添加到工作台", "Web plugin added to the workbench"));
    } catch (error) {
      setPluginStatus(error instanceof Error ? error.message : String(error));
    }
  };

  return <main className="preferences-window">
    <input ref={fontInputRef} className="visually-hidden" type="file" accept=".ttf,.otf,.ttc,.woff,.woff2,font/ttf,font/otf" onChange={(event) => void importFont(event)} />
    <input ref={pluginInputRef} className="visually-hidden" type="file" accept=".html,.htm,.js,.json,text/html,text/javascript,application/json" onChange={(event) => void importPlugin(event)} />
    <aside className="settings-sidebar"><Brand />
      <nav>{settingsNav.map((item) => {
        const marker = item.group ? <span className="nav-group" key={`${item.group}-label`}>{item.group === "types" ? tr(language, "文件类型", "File types") : item.group === "results" ? tr(language, "拖放与结果", "Drops & Results") : item.group === "automation" ? tr(language, "快捷键与自动化", "Shortcuts & Automation") : tr(language, "支持", "Support")}</span> : null;
        return <span className="nav-entry" key={item.id}>{marker}<button className={section === item.id ? "active" : ""} onClick={() => setSection(item.id)}><Icon name={item.icon} /><span>{tr(language, item.zh, item.en)}</span></button></span>;
      })}</nav>
    </aside>
    <div className="settings-content">
      {section === "general" && <>
        <SettingsCard title={<T language={language} zh="外观与配色" en="Appearance & colours" />} note={<T language={language} zh="选择后会立即同步到主窗口、设置和悬浮结果" en="Changes apply immediately to the main window, preferences and floating results" />}>
          <SettingsRow title={<T language={language} zh="语言" en="Language" />}><div className="segmented"><button className={language === "zh" ? "active" : ""} onClick={() => patch("language", "zh")}>中文</button><button className={language === "en" ? "active" : ""} onClick={() => patch("language", "en")}>English</button></div></SettingsRow>
          <SettingsRow title={<T language={language} zh="外观" en="Appearance" />}><Select label={tr(language, "外观", "Appearance")} value={settings.appearance} onChange={(value) => patch("appearance", value)}><option value="system">{tr(language, "跟随系统", "System")}</option><option value="light">{tr(language, "浅色", "Light")}</option><option value="dark">{tr(language, "深色", "Dark")}</option></Select></SettingsRow>
          <SettingsRow title={<T language={language} zh="界面配色" en="Colour theme" />} note={<T language={language} zh="选择一套你看着舒服的主色调" en="Choose the colour palette you prefer" />}><div className="settings-palette-picker">
            {([
              ["graphite", tr(language, "石墨蓝", "Graphite")],
              ["mist", tr(language, "雾蓝", "Mist blue")],
              ["violet", tr(language, "紫晶", "Violet")],
              ["green", tr(language, "经典绿", "Classic green")],
            ] as const).map(([value, label]) => <button type="button" className={`settings-palette ${value} ${settings.colorTheme === value ? "active" : ""}`} aria-pressed={settings.colorTheme === value} key={value} onClick={() => patch("colorTheme", value)}><span aria-hidden="true"><i /><i /><i /></span><b>{label}</b></button>)}
          </div></SettingsRow>
          <SettingsRow title={<T language={language} zh="登录时启动" en="Launch at login" />}><Switch label="launch" checked={settings.launchAtLogin} onChange={(value) => void toggleAutostart(value)} /></SettingsRow>
          <SettingsRow title={<T language={language} zh="暂停自动优化" en="Pause automatic optimisations" />} note={<T language={language} zh="保留菜单栏功能，但暂停监测和自动处理" en="Keep PicLite running without automatic processing" />}><Switch label="pause" checked={settings.pauseAutomaticOptimisations} onChange={(value) => patch("pauseAutomaticOptimisations", value)} /></SettingsRow>
          <SettingsRow title={<T language={language} zh="在任务栏 / Dock 显示" en="Show in taskbar / Dock" />} note={settings.showInTaskbarDock ? <T language={language} zh="主窗口失焦后保持显示，可从任务栏或 Dock 随时切换回来" en="Keep the main window available from the taskbar or Dock when it loses focus" /> : <T language={language} zh="不占用任务栏或 Dock，主窗口失焦后隐藏到托盘或菜单栏" en="Hide the main window to the tray or menu bar when it loses focus" />}><Switch label="taskbar dock" checked={settings.showInTaskbarDock} onChange={(value) => patch("showInTaskbarDock", value)} /></SettingsRow>
        </SettingsCard>
        <SettingsCard title={<T language={language} zh="优化" en="Optimisation" />}>
          <SettingsRow title={<T language={language} zh="移除 EXIF 元数据" en="Strip EXIF metadata" />} note={<T language={language} zh="移除位置、相机、日期等可识别信息" en="Remove location, camera, date and other identifiable metadata" />}><Switch label="metadata" checked={settings.stripMetadata} onChange={(value) => { patch("stripMetadata", value); patchPreset({ stripMetadata: value }); }} /></SettingsRow>
          <SettingsRow title={<T language={language} zh="保留色彩配置" en="Preserve colour profile" />} note={<T language={language} zh="转换格式时尽量保持视觉颜色一致" en="Keep visual colours consistent across conversions" />}><Switch label="color" checked={settings.preserveColorProfile} onChange={(value) => patch("preserveColorProfile", value)} /></SettingsRow>
          <SettingsRow title={<T language={language} zh="避免优化后变大" en="Never make files larger" />}><Switch label="larger" checked={settings.preset.preventLarger} onChange={(value) => patchPreset({ preventLarger: value })} /></SettingsRow>
        </SettingsCard>
      </>}
      {section === "clipboard" && <SettingsCard title={<T language={language} zh="剪贴板" en="Clipboard" />} note={<T language={language} zh="自动监测复制的图片并优化" en="Watch copied images and optimise them automatically" />}>
        <SettingsRow title={<T language={language} zh="启用剪贴板优化器" en="Enable clipboard optimiser" />}><Switch label="clipboard" checked={settings.clipboardOptimiser} onChange={(value) => patch("clipboardOptimiser", value)} /></SettingsRow>
        <SettingsRow title={<T language={language} zh="图片数据" en="Image data" />} note={<T language={language} zh="截图和从应用中复制的像素数据" en="Screenshots and pixels copied from applications" />}><Switch label="image data" checked={settings.clipboardImageData} onChange={(value) => patch("clipboardImageData", value)} /></SettingsRow>
        <SettingsRow title={<T language={language} zh="图片文件" en="Image files" />} note={<T language={language} zh="从文件管理器复制的图片路径" en="Image paths copied from the file manager" />}><Switch label="files" checked={settings.clipboardImageFiles} onChange={(value) => patch("clipboardImageFiles", value)} /></SettingsRow>
        <SettingsRow title={<T language={language} zh="保留所有剪贴板结果" en="Keep all clipboard results" />} note={<T language={language} zh="每次复制生成独立结果，不替换上一次" en="Append each result instead of replacing the previous one" />}><Switch label="keep" checked={settings.keepClipboardResults} onChange={(value) => patch("keepClipboardResults", value)} /></SettingsRow>
      </SettingsCard>}
      {section === "files" && <><SettingsCard title={<T language={language} zh="图片文件处理" en="Image file handling" />}>
        <SettingsRow title={<T language={language} zh="优化文件位置" en="Optimised file placement" />} note={<T language={language} zh="原图保留不变，优化结果写入所选位置" en="Keep originals and write optimised results to the selected location" />}><Select label="placement" value={settings.filePlacement} onChange={(value) => patch("filePlacement", value)}><option value="same-folder">{tr(language, "原文件夹", "Same folder as original")}</option><option value="fixed-folder">{tr(language, "指定文件夹", "Specific folder")}</option></Select></SettingsRow>
        <SettingsRow title={<T language={language} zh="文件名后缀" en="Filename suffix" />}><input value={settings.outputSuffix} onChange={(event) => patch("outputSuffix", event.target.value)} placeholder="-piclite" /></SettingsRow>
        <SettingsRow title={<T language={language} zh="重命名模板" en="Rename template" />} note={<T language={language} zh="可用：{name} {suffix} {date} {time} {datetime} {size} {width} {height} {ext}" en="Variables: {name} {suffix} {date} {time} {datetime} {size} {width} {height} {ext}" />}><input value={settings.renameTemplate} onChange={(event) => patch("renameTemplate", event.target.value)} placeholder="{name}{suffix}" /></SettingsRow>
        {settings.filePlacement === "fixed-folder" && <SettingsRow title={<T language={language} zh="输出目录" en="Output folder" />}><button className="path-button" onClick={() => void chooseOutput()}>{settings.outputFolder || tr(language, "选择文件夹…", "Choose folder…")}</button></SettingsRow>}
        <SettingsRow title={<T language={language} zh="保留创建和修改日期" en="Preserve creation and modification dates" />}><Switch label="dates" checked={settings.preserveDates} onChange={(value) => patch("preserveDates", value)} /></SettingsRow>
        <SettingsRow title={<T language={language} zh="定期清理结果图" en="Clean up results automatically" />} note={settings.filePlacement === "fixed-folder" ? <T language={language} zh="只删除指定输出目录中带当前 PicLite 后缀的到期图片" en="Only expired images with the current PicLite suffix are removed from the output folder" /> : <T language={language} zh="请先选择“指定文件夹”，以免扫描和误删原图目录" en="Choose “Specific folder” first so original folders are never scanned" />}><Switch label="cleanup" checked={settings.autoCleanupEnabled} onChange={(value) => patch("autoCleanupEnabled", value)} /></SettingsRow>
        {settings.autoCleanupEnabled && <SettingsRow title={<T language={language} zh="保留时长" en="Keep results for" />} note={cleanupText}><span className="number-field"><input type="number" min="1" max="999" value={settings.autoCleanupAmount} onChange={(event) => patch("autoCleanupAmount", Math.max(1, Number(event.target.value)))} /><Select label="cleanup unit" value={settings.autoCleanupUnit} onChange={(value) => patch("autoCleanupUnit", value)}><option value="hours">{tr(language, "小时", "hours")}</option><option value="days">{tr(language, "天", "days")}</option><option value="months">{tr(language, "月", "months")}</option></Select><button className="settings-button" disabled={settings.filePlacement !== "fixed-folder" || !settings.outputFolder} onClick={() => void cleanNow()}>{tr(language, "立即清理", "Clean now")}</button></span></SettingsRow>}
      </SettingsCard></>}
      {section === "images" && <>
        <SettingsCard title={<T language={language} zh="图片优化规则" en="Image optimisation rules" />}>
          <SettingsRow title={<T language={language} zh="智能首次优化" en="Smart first pass" />} note={<T language={language} zh="保持原尺寸和原格式，按高质量参数快速实测一次，有实际收益时采用结果" en="Keep the original dimensions and format, run one fast high-quality encode, and use it when the savings are meaningful" />}><Switch label="automatic optimisation" checked={settings.preset.mode === "auto"} onChange={(value) => patchPreset({ mode: value ? "auto" : "manual", format: value ? "keep" : settings.preset.format, scale: value ? 100 : settings.preset.scale })} /></SettingsRow>
          <SettingsRow title={<T language={language} zh="压缩质量" en="Compression quality" />} note={settings.preset.mode === "auto" ? tr(language, "自动", "Automatic") : `${settings.preset.quality}%`}><input disabled={settings.preset.mode === "auto"} type="range" min="5" max="100" value={settings.preset.quality} onChange={(event) => patchPreset({ mode: "manual", quality: Number(event.target.value) })} /></SettingsRow>
          <SettingsRow title={<T language={language} zh="缩放" en="Downscale" />} note={settings.preset.mode === "auto" ? "100%" : `${settings.preset.scale}%`}><input disabled={settings.preset.mode === "auto"} type="range" min="5" max="100" value={settings.preset.scale} onChange={(event) => patchPreset({ mode: "manual", scale: Number(event.target.value) })} /></SettingsRow>
          <SettingsRow title={<T language={language} zh="输出格式" en="Output format" />}><Select label="format" value={settings.preset.mode === "auto" ? "keep" : settings.preset.format} onChange={(value) => patchPreset({ mode: value === "keep" ? "auto" : "manual", format: value, scale: value === "keep" ? 100 : settings.preset.scale })}><option value="keep">{tr(language, "保持原格式", "Keep original format")}</option><option value="jpeg">JPEG</option><option value="webp">WebP</option><option value="png">PNG</option></Select></SettingsRow>
        </SettingsCard>
      </>}
      {section === "dropzone" && <SettingsCard title={<T language={language} zh="拖放区" en="Drop zone" />} note={<T language={language} zh="把图片拖入悬浮结果窗口即可优化" en="Drop images into the floating results window to optimise them" />}>
        <SettingsRow title={<T language={language} zh="自动复制优化结果" en="Auto copy optimised files" />} note={<T language={language} zh="处理完成后可立即粘贴到其他应用" en="Paste results immediately after optimisation" />}><Switch label="copy" checked={settings.autoCopyDropResults} onChange={(value) => patch("autoCopyDropResults", value)} /></SettingsRow>
        <SettingsRow title={<T language={language} zh="批量模式阈值" en="Batch mode threshold" />} note={<T language={language} zh="超过此数量时改用批量窗口" en="Use the batch window above this file count" />}><span className="number-field"><input type="number" min="2" max="500" value={settings.batchThreshold} onChange={(event) => patch("batchThreshold", Math.max(2, Number(event.target.value)))} /> {tr(language, "个文件", "files")}</span></SettingsRow>
        <div className="dropzone-demo"><DropSurface language={language} active /></div>
      </SettingsCard>}
      {section === "zones" && <SettingsCard title={<T language={language} zh="悬浮按钮" en="Floating action buttons" />} note={<T language={language} zh="按顺序配置悬浮结果中显示的功能，最多 6 个。点击下方功能即可添加。" en="Choose and order up to six actions shown over floating results. Select an action below to add it." />}>
        <div className="floating-action-configurator">
          <div className="floating-action-slots">
            {Array.from({ length: 6 }, (_, index) => {
              const action = settings.floatingActions[index];
              if (!action) return <div className="floating-action-slot empty" key={`empty-${index}`}><Icon name="plus" /><span>{tr(language, "添加功能", "Add action")}</span><small>{index + 1}</small></div>;
              return <div className="floating-action-slot" key={action}>
                <span className="action-slot-icon"><Icon name={floatingActionIcon(action)} /></span>
                <strong>{floatingActionLabel(language, action)}</strong>
                <small>{index + 1}</small>
                <span className="action-slot-controls">
                  <button disabled={index === 0} title={tr(language, "向前移动", "Move earlier")} onClick={() => setSettings((current) => { const next = [...current.floatingActions]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return { ...current, floatingActions: next }; })}>←</button>
                  <button disabled={index === settings.floatingActions.length - 1} title={tr(language, "向后移动", "Move later")} onClick={() => setSettings((current) => { const next = [...current.floatingActions]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; return { ...current, floatingActions: next }; })}>→</button>
                  <button title={tr(language, "移除", "Remove")} onClick={() => setSettings((current) => ({ ...current, floatingActions: current.floatingActions.filter((value) => value !== action) }))}>×</button>
                </span>
              </div>;
            })}
          </div>
          <div className="floating-action-library">
            <span>{tr(language, "可添加功能", "Available actions")}</span>
            <div>{FLOATING_ACTION_OPTIONS.map((action) => {
              const selected = settings.floatingActions.includes(action);
              return <button key={action} disabled={selected || settings.floatingActions.length >= 6} onClick={() => setSettings((current) => ({ ...current, floatingActions: [...current.floatingActions, action].slice(0, 6) }))}><Icon name={floatingActionIcon(action)} /><span>{floatingActionLabel(language, action)}</span>{selected && <small>{tr(language, "已添加", "Added")}</small>}</button>;
            })}</div>
          </div>
        </div>
      </SettingsCard>}
      {section === "floating" && <SettingsCard title={<T language={language} zh="悬浮结果" en="Floating results" />} note={<T language={language} zh="优化结束后在桌面边缘显示结果卡片" en="Show result cards at the edge of the desktop" />}>
        <SettingsRow title={<T language={language} zh="显示悬浮结果" en="Show floating results" />}><Switch label="floating" checked={settings.enableFloatingResults} onChange={(value) => patch("enableFloatingResults", value)} /></SettingsRow>
        <SettingsRow title={<T language={language} zh="允许截图 / 录屏捕获" en="Allow screenshot / recording capture" />} note={settings.allowFloatingCapture ? <T language={language} zh="悬浮窗会出现在系统截图和录屏中" en="The floating window can appear in screenshots and recordings" /> : <T language={language} zh="使用系统内容保护隐藏悬浮窗；部分第三方采集工具可能不遵守此设置" en="Hide the floating window using OS content protection; some third-party capture tools may ignore it" />}><Switch label="screen capture" checked={settings.allowFloatingCapture} onChange={(value) => patch("allowFloatingCapture", value)} /></SettingsRow>
        <SettingsRow title={<T language={language} zh="屏幕位置" en="Position on screen" />}><Select label="corner" value={settings.floatingCorner} onChange={(value) => patch("floatingCorner", value)}><option value="bottom-right">{tr(language, "右下角", "Bottom right")}</option><option value="bottom-left">{tr(language, "左下角", "Bottom left")}</option><option value="top-right">{tr(language, "右上角", "Top right")}</option><option value="top-left">{tr(language, "左上角", "Top left")}</option></Select></SettingsRow>
        <SettingsRow title={<T language={language} zh="布局" en="Layout" />}><div className="segmented"><button className={settings.floatingLayout === "compact" ? "active" : ""} onClick={() => patch("floatingLayout", "compact")}>{tr(language, "紧凑", "Compact")}</button><button className={settings.floatingLayout === "full" ? "active" : ""} onClick={() => patch("floatingLayout", "full")}>{tr(language, "完整", "Full")}</button></div></SettingsRow>
        <SettingsRow title={<T language={language} zh="结果展示方式" en="Result presentation" />} note={<T language={language} zh="堆叠占用更少空间，展开可连续浏览" en="Stacked uses less space; list shows every result" />}><div className="segmented"><button className={settings.floatingDisplayMode === "stack" ? "active" : ""} onClick={() => patch("floatingDisplayMode", "stack")}>{tr(language, "堆叠", "Stacked")}</button><button className={settings.floatingDisplayMode === "list" ? "active" : ""} onClick={() => patch("floatingDisplayMode", "list")}>{tr(language, "展开", "List")}</button></div></SettingsRow>
        <SettingsRow title={<T language={language} zh="最多保留结果" en="Maximum results" />} note={<T language={language} zh="超过数量时自动移除最早的结果" en="The oldest result is dismissed when the limit is reached" />}><span className="number-field"><input type="number" min="1" max="20" value={settings.floatingMaxResults} onChange={(event) => patch("floatingMaxResults", Math.max(1, Math.min(20, Number(event.target.value) || 1)))} /> {tr(language, "张", "images")}</span></SettingsRow>
        <SettingsRow title={<T language={language} zh="悬浮按钮" en="Floating actions" />} note={<T language={language} zh="已移到“悬浮按钮”页面，可配置顺序和最多 6 个功能。" en="Configure the order and up to six actions on the Action Buttons page." />}><button className="settings-button" onClick={() => setSection("zones")}><T language={language} zh="配置按钮" en="Configure actions" /></button></SettingsRow>
        <SettingsRow title={<T language={language} zh="水印文字与字体" en="Watermark text and font" />} note={fontStatus}><span className="inline-fields"><input value={settings.floatingWatermark.text} onChange={(event) => patch("floatingWatermark", { ...settings.floatingWatermark, text: event.target.value })} /><select value={settings.floatingWatermark.fontFamily} onChange={(event) => void selectWatermarkFont(event.target.value)}><option value={settings.floatingWatermark.fontFamily}>{settings.floatingWatermark.fontFamily}</option>{[...new Set(systemFonts.map((font) => font.family))].filter((font) => font !== settings.floatingWatermark.fontFamily).sort().map((font) => <option key={font} value={font}>{font}</option>)}</select><button className="settings-button" onClick={() => void refreshFonts()}>{tr(language, "读取系统字体", "Scan fonts")}</button><button className="settings-button" onClick={() => fontInputRef.current?.click()}>{tr(language, "导入字体", "Import font")}</button></span></SettingsRow>
        <SettingsRow title={<T language={language} zh="字号 / 密度 / 方向" en="Size / density / angle" />}><span className="inline-fields compact"><input title="size" type="number" min="0.5" max="30" step="0.5" value={settings.floatingWatermark.fontScale} onChange={(event) => patch("floatingWatermark", { ...settings.floatingWatermark, fontScale: Number(event.target.value) })} /><input title="density" type="number" min="1" max="100" value={settings.floatingWatermark.density} onChange={(event) => patch("floatingWatermark", { ...settings.floatingWatermark, density: Number(event.target.value) })} /><input title="rotation" type="number" min="-180" max="180" value={settings.floatingWatermark.rotation} onChange={(event) => patch("floatingWatermark", { ...settings.floatingWatermark, rotation: Number(event.target.value) })} /></span></SettingsRow>
        <SettingsRow title={<T language={language} zh="颜色 / 透明度" en="Colour / opacity" />}><span className="inline-fields compact"><input type="color" value={settings.floatingWatermark.color} onChange={(event) => patch("floatingWatermark", { ...settings.floatingWatermark, color: event.target.value })} /><input type="number" min="1" max="100" value={settings.floatingWatermark.opacity} onChange={(event) => patch("floatingWatermark", { ...settings.floatingWatermark, opacity: Number(event.target.value) })} /></span></SettingsRow>
        <SettingsRow title={<T language={language} zh="自动隐藏" en="Auto hide" />}><Switch label="hide" checked={settings.autoHideResults} onChange={(value) => patch("autoHideResults", value)} /></SettingsRow>
        <SettingsRow title={<T language={language} zh="结果保留时间" en="Dismiss result after" />}><span className="number-field"><input type="number" min="1" max="300" value={settings.autoHideSeconds} onChange={(event) => patch("autoHideSeconds", Math.max(1, Number(event.target.value)))} /> {tr(language, "秒", "seconds")}</span></SettingsRow>
        <div className="floating-preview"><ResultCard item={{ id: "preview", source: "example-photo.jpg", output: "example-photo-piclite.webp", originalBytes: 750000, outputBytes: 211000, keptOriginal: false, status: "done", width: 1920, height: 1080 }} api={api} settings={settings} active select={() => undefined} remove={() => undefined} downscale={() => undefined} watermark={() => undefined} upload={() => undefined} undo={() => undefined} updateFormat={() => undefined} /></div>
      </SettingsCard>}
      {section === "hosting" && <SettingsCard title={<T language={language} zh="图床上传" en="Image hosting" />} note={<T language={language} zh="兼容 WebDAV、S3/R2、OSS、FTP 和 SFTP；成功后自动复制链接" en="WebDAV, S3/R2, OSS, FTP and SFTP; the resulting URL is copied automatically" />}>
        <SettingsRow title={<T language={language} zh="服务类型" en="Provider" />}><Select label="provider" value={uploadProfile.provider} onChange={(provider) => setUploadProfile((current) => ({ ...current, provider }))}><option value="webdav">WebDAV</option><option value="s3">S3 / MinIO</option><option value="r2">Cloudflare R2</option><option value="oss">Aliyun OSS</option><option value="ftp">FTP</option><option value="sftp">SFTP</option></Select></SettingsRow>
        <SettingsRow title="Endpoint"><input value={uploadProfile.endpoint} onChange={(event) => setUploadProfile((current) => ({ ...current, endpoint: event.target.value }))} placeholder="https://…" /></SettingsRow>
        {(["s3", "r2", "oss"] as string[]).includes(uploadProfile.provider) && <><SettingsRow title="Bucket"><input value={uploadProfile.bucket} onChange={(event) => setUploadProfile((current) => ({ ...current, bucket: event.target.value }))} /></SettingsRow><SettingsRow title="Access Key"><input value={uploadProfile.accessKey} onChange={(event) => setUploadProfile((current) => ({ ...current, accessKey: event.target.value }))} /></SettingsRow></>}
        {(["s3", "r2"] as string[]).includes(uploadProfile.provider) && <SettingsRow title="Region"><input value={uploadProfile.region} onChange={(event) => setUploadProfile((current) => ({ ...current, region: event.target.value }))} placeholder={uploadProfile.provider === "r2" ? "auto" : "us-east-1"} /></SettingsRow>}
        {(["webdav", "ftp", "sftp"] as string[]).includes(uploadProfile.provider) && <SettingsRow title={<T language={language} zh="用户名" en="Username" />}><input value={uploadProfile.username} onChange={(event) => setUploadProfile((current) => ({ ...current, username: event.target.value }))} /></SettingsRow>}
        {(["ftp", "sftp"] as string[]).includes(uploadProfile.provider) && <SettingsRow title={<T language={language} zh="端口" en="Port" />}><input type="number" min="1" max="65535" value={uploadProfile.port} onChange={(event) => setUploadProfile((current) => ({ ...current, port: Number(event.target.value) }))} /></SettingsRow>}
        {uploadProfile.provider === "sftp" && <SettingsRow title={<T language={language} zh="SSH 私钥路径（可选）" en="SSH private key path (optional)" />}><input value={uploadProfile.keyPath} onChange={(event) => setUploadProfile((current) => ({ ...current, keyPath: event.target.value }))} /></SettingsRow>}
        <SettingsRow title={<T language={language} zh="密码 / Secret" en="Password / Secret" />}><input type="password" value={uploadProfile.secret} onChange={(event) => setUploadProfile((current) => ({ ...current, secret: event.target.value }))} /></SettingsRow>
        {uploadProfile.provider === "s3" && <SettingsRow title={<T language={language} zh="Path-style 地址" en="Path-style URLs" />} note={<T language={language} zh="MinIO 与部分自建 S3 通常需要开启" en="Usually required by MinIO and some self-hosted S3 services" />}><Switch label="path style" checked={uploadProfile.pathStyle} onChange={(pathStyle) => setUploadProfile((current) => ({ ...current, pathStyle }))} /></SettingsRow>}
        <SettingsRow title={<T language={language} zh="远端目录" en="Remote folder" />}><input value={uploadProfile.remotePath} onChange={(event) => setUploadProfile((current) => ({ ...current, remotePath: event.target.value }))} /></SettingsRow>
        <SettingsRow title={<T language={language} zh="公开访问地址" en="Public base URL" />} note={uploadSaved}><span className="inline-fields"><input value={uploadProfile.publicBaseUrl} onChange={(event) => setUploadProfile((current) => ({ ...current, publicBaseUrl: event.target.value }))} /><button className="settings-button" onClick={() => void api.saveUploadProfile(uploadProfile).then(() => setUploadSaved(tr(language, "已保存到本机", "Saved locally")))}><T language={language} zh="保存" en="Save" /></button></span></SettingsRow>
      </SettingsCard>}
      {section === "plugins" && <SettingsCard title={<T language={language} zh="工作台插件" en="Workbench plugins" />} note={pluginStatus || <T language={language} zh="启用内置功能，或载入本地 HTML / JavaScript 和网页工具。插件在隔离工作台中运行。" en="Enable built-ins or load local HTML/JavaScript and web tools. Plugins run in an isolated workbench." />}>
        {workspacePlugins.map((plugin) => <SettingsRow key={plugin.id} title={plugin.kind === "builtin" ? (language === "zh" ? plugin.nameZh : plugin.nameEn) : <input className="plugin-title-input" aria-label={tr(language, "插件显示名称", "Plugin display title")} value={language === "zh" ? plugin.nameZh : plugin.nameEn} onChange={(event) => { const name = event.target.value; setWorkspacePlugins((current) => current.map((item) => item.id === plugin.id ? { ...item, nameZh: name, nameEn: name } : item)); }} />} note={plugin.kind === "builtin" ? tr(language, "内置插件", "Built-in plugin") : plugin.kind === "url" ? plugin.url : tr(language, "本地沙箱插件", "Local sandboxed plugin")}><span className="inline-fields"><Switch label={plugin.nameEn} checked={plugin.enabled} onChange={(enabled) => setWorkspacePlugins((current) => current.map((item) => item.id === plugin.id ? { ...item, enabled } : item))} />{plugin.kind !== "builtin" && <button className="settings-button danger" onClick={() => setWorkspacePlugins((current) => current.filter((item) => item.id !== plugin.id))}>{tr(language, "移除", "Remove")}</button>}</span></SettingsRow>)}
        <SettingsRow title={<T language={language} zh="本地插件" en="Local plugin" />} note={<T language={language} zh="支持 .html、.js 和 manifest.json" en="Supports .html, .js and manifest.json" />}><button className="settings-button" onClick={() => pluginInputRef.current?.click()}>{tr(language, "导入插件", "Import plugin")}</button></SettingsRow>
        <SettingsRow title={<T language={language} zh="网页工具" en="Web tool" />} note={<T language={language} zh="例如 https://banner.xmit.dev/" en="For example https://banner.xmit.dev/" />}><span className="inline-fields"><input value={pluginUrl} onChange={(event) => setPluginUrl(event.target.value)} /><button className="settings-button" onClick={addUrlPlugin}>{tr(language, "添加", "Add")}</button></span></SettingsRow>
        <SettingsRow title={<T language={language} zh="打开工作台" en="Open workbench" />} note={<T language={language} zh="启用的插件会显示在主窗口顶部导航中" en="Enabled plugins appear in the main window navigation" />}><button className="settings-button" onClick={() => void api.showMainWindow()}>{tr(language, "查看插件", "View plugins")}</button></SettingsRow>
      </SettingsCard>}
      {section === "shortcuts" && <SettingsCard title={<T language={language} zh="键盘快捷键" en="Keyboard shortcuts" />} note={<T language={language} zh="点击快捷键后直接按下新组合；Delete 可清除，Esc 可取消。剪贴板快捷压缩不依赖自动监听。" en="Click a shortcut and press a new combination. Delete clears it and Esc cancels. Clipboard optimisation works without clipboard monitoring." />}>
        <SettingsRow title={<T language={language} zh="启用全局快捷键" en="Enable global shortcuts" />}><Switch label="shortcuts" checked={settings.shortcutsEnabled} onChange={(value) => patch("shortcutsEnabled", value)} /></SettingsRow>
        {([
          ["shortcutToggleDropzone", tr(language, "打开 / 关闭悬浮窗", "Toggle floating window")],
          ["shortcutOptimiseClipboard", tr(language, "压缩当前剪贴板图片", "Optimise current clipboard image")],
          ["shortcutShowMain", tr(language, "显示主窗口", "Show main window")],
          ["shortcutShowGallery", tr(language, "打开图库", "Open library")],
          ["shortcutUploadCurrent", tr(language, "上传当前悬浮结果", "Upload current floating result")],
        ] as const).map(([key, title]) => <SettingsRow key={key} title={title}><button className={`shortcut-recorder ${recordingShortcut === key ? "recording" : ""}`} aria-pressed={recordingShortcut === key} onClick={() => setRecordingShortcut((current) => current === key ? null : key)}>{recordingShortcut === key ? tr(language, "请按快捷键…", "Press shortcut…") : shortcutLabel(settings[key], api.platform)}</button></SettingsRow>)}
        {shortcutStatus && <p className="settings-status error">{shortcutStatus}</p>}
      </SettingsCard>}
      {section === "about" && <>
        <section className="update-about-hero"><Brand /><div><span><T language={language} zh="当前版本" en="Current version" /></span><strong>PicLite v{APP_VERSION}</strong><small><T language={language} zh={`更新时间 ${APP_RELEASE_DATE}`} en={`Updated ${APP_RELEASE_DATE}`} /> · Tauri 2 + Rust</small></div></section>
        <SettingsCard title={<T language={language} zh="更新" en="Updates" />}>
          <SettingsRow title={<T language={language} zh="自动检查更新" en="Automatic update checks" />} note={<T language={language} zh="按设定频率检查 GitHub Releases" en="Check GitHub Releases at the selected interval" />}><Select label={tr(language, "自动检查更新", "Automatic update checks")} value={settings.updateCheckFrequency} onChange={(value) => patch("updateCheckFrequency", value)}><option value="startup">{tr(language, "打开软件时", "When PicLite opens")}</option><option value="daily">{tr(language, "每天", "Daily")}</option><option value="weekly">{tr(language, "每周", "Weekly")}</option><option value="never">{tr(language, "不自动检查", "Never")}</option></Select></SettingsRow>
          <SettingsRow title={<T language={language} zh="检查 GitHub Releases" en="Check GitHub Releases" />} note={updateText}><button className="settings-button" onClick={() => void checkUpdates()}><T language={language} zh="立即检查" en="Check now" /></button></SettingsRow>
        </SettingsCard>
        <SettingsCard title={<T language={language} zh="关于 PicLite" en="About PicLite" />}><div className="about-pane"><p><T language={language} zh="面向自媒体工作人员和开发人员的本地优先跨平台媒体优化工具。" en="A local-first, cross-platform media optimiser for content creators and developers." /></p><small>GPL-3.0-or-later · Tauri 2 + Rust</small><p><T language={language} zh="工作流与部分实现基于 GPL 项目 Clop；PicLite 使用独立名称、图标和跨平台实现。" en="Workflow and parts of the implementation are based on the GPL-licensed Clop project. PicLite uses its own name, icons and cross-platform implementation." /></p><button className="settings-button" onClick={() => void api.openExternal("https://github.com/amiaoapp/PicLite")}><T language={language} zh="打开 GitHub" en="Open GitHub" /></button></div></SettingsCard>
      </>}
      {section === "sponsor" && <>
        <section className="sponsor-hero">
          <span className="sponsor-heart" aria-hidden="true"><Icon name="heart" /></span>
          <div><span><T language={language} zh="感谢赞助支持" en="Thank you for supporting PicLite" /></span><strong><T language={language} zh="让 PicLite 继续轻盈地走下去" en="Help PicLite keep moving forward" /></strong><small><T language={language} zh="软件会继续免费维护。每一份支持，都会用于开发、测试和跨平台发布。" en="PicLite will remain free to use. Your support helps fund development, testing and cross-platform releases." /></small></div>
        </section>
        <SettingsCard title={<T language={language} zh="赞助方式" en="Ways to support" />} note={<T language={language} zh="请选择你方便的方式，感谢你的认可。" en="Choose whichever method works for you. Thank you." />}>
          <div className="sponsor-grid">
            {SPONSOR_METHODS.map((method) => <figure className="sponsor-method" key={method.id}>
              <div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={method.image} alt={tr(language, `${method.zh}收款码`, `${method.en} payment QR code`)} />
              </div>
              <figcaption>{tr(language, method.zh, method.en)}</figcaption>
            </figure>)}
          </div>
        </SettingsCard>
        <SettingsCard title={<T language={language} zh="找到阿喵" en="Find Amiao online" />} note={<T language={language} zh="网站与社交平台" en="Website and social profiles" />}>
          <div className="creator-links">
            {CREATOR_LINKS.map((link) => <button type="button" key={link.id} title={link.label} aria-label={link.label} onClick={() => void api.openExternal(link.url)}><Icon name={link.icon} /><span>{link.label}</span></button>)}
          </div>
        </SettingsCard>
      </>}
    </div>
  </main>;
}

export function PicLiteDesktopApp() {
  if (!bridge) return <div className="fatal">PicLite desktop bridge is unavailable.</div>;
  if (bridge.windowLabel === "preferences") return <Preferences api={bridge} />;
  if (bridge.windowLabel === "dropzone") return <FloatingResults api={bridge} />;
  return <BatchOptimiser api={bridge} />;
}
