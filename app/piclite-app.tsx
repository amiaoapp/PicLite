"use client";
/* eslint-disable @next/next/no-img-element -- Blob URLs are created and revoked locally. */

import {
  ChangeEvent,
  CSSProperties,
  DragEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { applyPalette, GIFEncoder, quantize } from "gifenc";
import { disable as disableAutostart, enable as enableAutostart, isEnabled as isAutostartEnabled } from "@tauri-apps/plugin-autostart";
import { isRequestedMimeType, isSmartCompressionWorthwhile, minimumSmartSavingsBytes, smartCandidateOutputFormats } from "./compression-policy";
import packageManifest from "../package.json";
import { loadSettings as loadDesktopSettings, saveSettings as saveDesktopSettings } from "../desktop/clop-store";

type CompressionMode = "lossless" | "balanced" | "small" | "manual";
type OutputFormat = "keep" | "image/jpeg" | "image/png" | "image/webp";
type ViewName = "workspace" | "watcher" | "rename" | "gallery" | "preferences" | `plugin:${string}`;
type PreviewMode = "compare" | "original" | "result";
type ItemStatus = "ready" | "processing" | "done" | "error";
type ExportMode = "download" | "overwrite" | "same-folder" | "fixed-folder";
type WatermarkLayout = "tile" | "single";
type ThemeMode = "system" | "light" | "dark";
type ColorTheme = "graphite" | "mist" | "violet" | "green";
type UpdateCheckFrequency = "startup" | "daily" | "weekly" | "never";
type UiDensity = "auto" | "comfortable" | "compact";
type ShortcutPreferenceKey = "shortcutShow" | "shortcutPaste" | "shortcutDock" | "shortcutGallery" | "shortcutUpload";
type DockLayout = "compact" | "full";
type PreferenceSection = "rename" | "general" | "clipboard" | "files" | "images" | "dropzone" | "floating" | "hosting" | "plugins" | "shortcuts" | "about";

const APP_VERSION = packageManifest.version;
const APP_RELEASE_DATE = packageManifest.releaseDate;
const LAST_UPDATE_CHECK_KEY = "piclite.update.last-checked.v1";
const GITHUB_RELEASES_URL = "https://github.com/amiaoapp/PicLite/releases/latest";

type UpdateInfo = {
  currentVersion: string;
  latestVersion: string;
  available: boolean;
  releaseUrl: string;
  publishedAt?: string;
};

type WritableFileLike = {
  write: (data: Blob) => Promise<void>;
  close: () => Promise<void>;
};

type FileHandleLike = {
  name: string;
  getFile: () => Promise<File>;
  createWritable: () => Promise<WritableFileLike>;
  requestPermission?: (options: { mode: "readwrite" }) => Promise<"granted" | "denied" | "prompt">;
};

type DirectoryHandleLike = {
  name: string;
  getFileHandle: (name: string, options: { create: boolean }) => Promise<FileHandleLike>;
};

type NativeImage = { name: string; type: string; path: string; data: Uint8Array };
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
type NativeExportItem = { sourcePath?: string; outputName: string; data: Uint8Array };
type ImageSourceInput = { file: File; fileHandle?: FileHandleLike; sourcePath?: string };
type UploadProvider = "webdav" | "s3" | "r2" | "oss" | "ftp" | "sftp";

type UploadSettings = {
  provider: UploadProvider;
  endpoint: string;
  bucket: string;
  region: string;
  accessKey: string;
  username: string;
  port: number;
  remotePath: string;
  publicBaseUrl: string;
  keyPath: string;
  pathStyle: boolean;
};

type StoredUploadProfile = UploadSettings & { secret: string };

type NativeUploadPayload = UploadSettings & {
  secret: string;
  fileName: string;
  mimeType: string;
  data: Uint8Array;
};

type SystemFontInfo = {
  family: string;
  path: string;
  faceIndex: number;
};

type WatcherEvent = {
  id: string;
  type: "success" | "error" | "started" | "stopped";
  file?: string;
  output?: string;
  originalBytes?: number;
  outputBytes?: number;
  message?: string;
  time: number;
};

type WatcherSettings = {
  profiles?: WatcherSettings[];
  folderRename?: BatchRenameRequest;
  onlyWhenNeeded?: boolean;
  notifyOnComplete?: boolean;
  showFloatingResult?: boolean;
  inputFolder: string;
  inputFolders: string[];
  outputFolder: string;
  mode: CompressionMode;
  quality: number;
  scale: number;
  format: OutputFormat;
  resize: boolean;
  maxWidth: number;
  maxHeight: number;
  stripMetadata: boolean;
  preventLarger: boolean;
};

type WatchProfile = WatcherSettings & { id: string; name: string; enabled: boolean };

type BatchRenameRequest = {
  rootFolder: string;
  folderPattern: string;
  renameTemplate: string;
  firstPadding: number;
  secondPadding: number;
};

type BatchRenameResult = {
  entries: Array<{ source: string; target: string; sourceName: string; targetName: string; matchedFolder?: string; code?: string; ready: boolean; unchanged: boolean; error?: string }>;
  matched: number;
  renamed: number;
  skipped: number;
  failed: number;
};

type NativeBridge = {
  platform: string;
  windowLabel: string;
  readClipboardImage: () => Promise<{ data: Uint8Array } | null>;
  readClipboardPaths: () => Promise<string[]>;
  copyImageData: (data: Uint8Array) => Promise<void>;
  copyCompressedData: (data: Uint8Array, fileName: string) => Promise<string>;
  cacheImageData: (data: Uint8Array, fileName: string) => Promise<string>;
  copyImagePath: (path: string) => Promise<void>;
  copyText: (text: string) => Promise<void>;
  selectImages: () => Promise<NativeImage[]>;
  selectImageEntries: () => Promise<NativeImageEntry[]>;
  selectImageFolderEntries: () => Promise<NativeImageEntry[]>;
  readImagesFromPaths: (paths: string[]) => Promise<NativeImage[]>;
  readImageEntriesFromPaths: (paths: string[]) => Promise<NativeImageEntry[]>;
  selectFolder: (kind: "input" | "output" | "export") => Promise<string | null>;
  suggestScreenshotFolder: () => Promise<string | null>;
  exportImages: (payload: { mode: Exclude<ExportMode, "download">; suffix: string; fixedFolder?: string; items: NativeExportItem[] }) => Promise<{ ok: boolean; paths?: string[]; error?: string }>;
  validateWatcher: (settings: import("../desktop/clop-types").WatcherSettings) => Promise<{ ok: boolean; error?: string }>;
  startWatcher: (settings: WatcherSettings) => Promise<{ ok: boolean; error?: string }>;
  stopWatcher: () => Promise<{ ok: boolean }>;
  getWatcherState: () => Promise<{ active: boolean; settings?: WatcherSettings }>;
  quickCompressPaths: (paths: string[], settings: QuickCompressSettings) => Promise<QuickCompressResult[]>;
  compressImageData: (data: Uint8Array, fileName: string, settings: QuickCompressSettings) => Promise<{ data: Uint8Array; mimeType: string; extension: string; width: number; height: number; keptOriginal: boolean }>;
  compressAnimationData: (data: Uint8Array, fileName: string, settings: QuickCompressSettings) => Promise<{ data: Uint8Array; mimeType: string; extension: string; width: number; height: number; keptOriginal: boolean }>;
  configureGlobalShortcuts: (bindings: { enabled: boolean; toggleDropzone: string; optimiseClipboard: string; showMain: string; showGallery?: string; uploadCurrent?: string }) => Promise<void>;
  cleanupOptimisedFiles: (payload: { folder: string; suffix: string; olderThanSeconds: number }) => Promise<{ deleted: number }>;
  previewBatchRename: (request: BatchRenameRequest) => Promise<BatchRenameResult>;
  applyBatchRename: (request: BatchRenameRequest) => Promise<BatchRenameResult>;
  revealPath: (path: string) => Promise<void>;
  openImage: (path: string) => Promise<void>;
  uploadImage: (payload: NativeUploadPayload) => Promise<{ url: string; remotePath: string }>;
  loadUploadProfile: () => Promise<StoredUploadProfile | null>;
  saveUploadProfile: (profile: StoredUploadProfile) => Promise<void>;
  loadAppProfile: () => Promise<NativeAppProfile | null>;
  saveAppProfile: (profile: NativeAppProfile) => Promise<void>;
  loadImportedFonts: () => Promise<Array<{ family: string; data: Uint8Array }>>;
  saveImportedFont: (family: string, data: Uint8Array) => Promise<void>;
  listSystemFonts: () => Promise<SystemFontInfo[]>;
  readSystemFont: (path: string, faceIndex: number) => Promise<{ data: Uint8Array }>;
  updateDesktopPreferences: (preferences: { minimizeToTray: boolean; showInTaskbarDock: boolean; clipboardWatcherEnabled: boolean }) => Promise<void>;
  setWindowTheme: (theme: ThemeMode) => Promise<void>;
  startDragging: () => Promise<void>;
  startResizeDragging: (direction: "East" | "North" | "NorthEast" | "NorthWest" | "South" | "SouthEast" | "SouthWest" | "West") => Promise<void>;
  showMainWindow: () => Promise<void>;
  showGalleryWindow: () => Promise<void>;
  showPreferencesWindow: (section?: PreferenceSection) => Promise<void>;
  showDropzoneWindow: () => Promise<void>;
  submitCornerDrop: (paths: string[]) => Promise<void>;
  takePendingCornerDrop: () => Promise<string[]>;
  configureDropzoneWindow: (width: number, height: number) => Promise<void>;
  resizeDropzoneWindow: (width: number, height: number) => Promise<void>;
  setAlwaysOnTop: (enabled: boolean) => Promise<void>;
  setContentProtected: (protected_: boolean) => Promise<void>;
  hideCurrentWindow: () => Promise<void>;
  quitApplication: () => Promise<void>;
  onFileDrop: (callback: (event: { type: "over" | "drop" | "leave" | "error"; paths?: string[]; error?: string }) => void) => () => void;
  onCornerDrop: (callback: () => void) => () => void;
  onTrayAction: (callback: (action: string) => void) => () => void;
  onImageImportProgress: (callback: (progress: { current: number; total: number }) => void) => () => void;
  onWatcherEvent: (callback: (event: WatcherEvent) => void) => () => void;
  onClipboardImage: (callback: (data: Uint8Array) => void) => () => void;
  onClipboardPaths: (callback: (paths: string[]) => void) => () => void;
  onWindowResized: (callback: (size: { width: number; height: number }) => void) => () => void;
  checkForUpdates: () => Promise<UpdateInfo>;
  fetchPluginSource: (url: string) => Promise<string>;
  openExternal: (url: string) => Promise<void>;
};

declare global {
  interface Window {
    picLite?: NativeBridge;
    showOpenFilePicker?: (options: { multiple: boolean; types: Array<{ description: string; accept: Record<string, string[]> }> }) => Promise<FileHandleLike[]>;
    showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<DirectoryHandleLike>;
    queryLocalFonts?: () => Promise<Array<{ family: string; fullName: string; postscriptName: string }>>;
  }
}

type ImageItem = {
  id: string;
  file: File;
  name: string;
  type: string;
  width: number;
  height: number;
  originalBytes: number;
  sourceUrl: string;
  outputUrl?: string;
  outputBlob?: Blob;
  outputBytes?: number;
  outputType?: string;
  outputWidth?: number;
  outputHeight?: number;
  status: ItemStatus;
  error?: string;
  keptOriginal?: boolean;
  sizeGuardQuality?: number;
  strategy?: string;
  fileHandle?: FileHandleLike;
  sourcePath?: string;
  sourceIsThumbnail?: boolean;
};

type WatermarkSettings = {
  enabled: boolean;
  text: string;
  layout: WatermarkLayout;
  fontFamily: string;
  fontScale: number;
  color: string;
  opacity: number;
  rotation: number;
  density: number;
  positionX: number;
  positionY: number;
  shadow: boolean;
  shadowBlur: number;
  shadowColor: string;
};

type CompressionSettings = {
  mode: CompressionMode;
  quality: number;
  scale: number;
  targetSizeKb: number;
  format: OutputFormat;
  resize: boolean;
  width: number;
  height: number;
  lockRatio: boolean;
  stripMetadata: boolean;
  preventLarger: boolean;
  watermark: WatermarkSettings;
};

type DesktopPreferences = {
  exportMode: Exclude<ExportMode, "download">;
  exportSuffix: string;
  exportFolder: string;
  renameTemplate: string;
  confirmOverwrite: boolean;
  preventLarger: boolean;
  theme: ThemeMode;
  colorTheme: ColorTheme;
  dockTheme: ThemeMode;
  density: UiDensity;
  minimizeToTray: boolean;
  showInTaskbarDock: boolean;
  allowFloatingCapture: boolean;
  launchAtStartup: boolean;
  shortcutsEnabled: boolean;
  shortcutShow: string;
  shortcutPaste: string;
  shortcutDock: string;
  shortcutGallery: string;
  shortcutUpload: string;
  dockLayout: DockLayout;
  floatingResultSeconds: number;
  clipboardWatcherEnabled: boolean;
  autoCheckUpdates: boolean;
  updateCheckFrequency: UpdateCheckFrequency;
  language: "zh" | "en";
};

type SavedPreset = {
  id: string;
  name: string;
  settings: CompressionSettings;
  custom?: boolean;
};

type NativeAppProfile = {
  settings: CompressionSettings;
  customPresets: SavedPreset[];
  activePresetId: string;
  localFonts: string[];
  desktopPreferences?: DesktopPreferences;
};

type QuickCompressSettings = {
  mode?: "auto" | "balanced" | "small" | "lossless" | "manual";
  quality: number;
  scale: number;
  format: OutputFormat;
  stripMetadata: boolean;
  preventLarger: boolean;
  exportMode: Exclude<ExportMode, "download">;
  exportSuffix: string;
  renameTemplate?: string;
  fixedFolder?: string;
};

type QuickCompressResult = {
  source: string;
  output?: string;
  originalBytes?: number;
  outputBytes?: number;
  keptOriginal: boolean;
  error?: string;
};

type GalleryRecord = {
  id: string;
  name: string;
  createdAt: number;
  originalBytes: number;
  outputBytes: number;
  width: number;
  height: number;
  mimeType: string;
  blob: Blob;
  sourcePath?: string;
  outputPath?: string;
  remoteUrl?: string;
};

type GalleryViewItem = GalleryRecord & { previewUrl: string };

type WorkspacePlugin = {
  id: string;
  nameZh: string;
  nameEn: string;
  kind: "builtin" | "html" | "url";
  enabled: boolean;
  source?: string;
  url?: string;
};

const BUILTIN_WORKSPACE_PLUGINS: WorkspacePlugin[] = [
  { id: "watcher", nameZh: "文件夹监测", nameEn: "Folder watch", kind: "builtin", enabled: true },
  { id: "rename", nameZh: "图片批量重命名", nameEn: "Batch image rename", kind: "builtin", enabled: true },
  { id: "gallery", nameZh: "图库", nameEn: "Library", kind: "builtin", enabled: true },
];

function loadWorkspacePlugins(): WorkspacePlugin[] {
  if (typeof window === "undefined") return BUILTIN_WORKSPACE_PLUGINS;
  try {
    const saved = JSON.parse(window.localStorage.getItem("piclite.workspacePlugins.v1") || "[]") as WorkspacePlugin[];
    const builtins = BUILTIN_WORKSPACE_PLUGINS.map((plugin) => ({ ...plugin, enabled: saved.find((item) => item.id === plugin.id)?.enabled ?? true }));
    return [...builtins, ...saved.filter((plugin) => plugin.kind !== "builtin")];
  } catch { return BUILTIN_WORKSPACE_PLUGINS; }
}

function jsPluginDocument(script: string) {
  const safeScript = script.replace(/<[/]script/gi, "<" + "\\/" + "script");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>html,body,#piclite-plugin-root{height:100%;margin:0;font-family:system-ui;color:#172033;background:#f7f9fc}</style></head><body><main id="piclite-plugin-root"></main><script>${safeScript}</script></body></html>`;
}

function absolutisePluginUrl(value: string, baseUrl?: string) {
  if (!baseUrl || !value || value.startsWith("#") || value.startsWith("data:") || value.startsWith("blob:") || value.startsWith("javascript:")) return value;
  try { return new URL(value, baseUrl).toString(); } catch { return value; }
}

function rewritePluginCss(css: string, baseUrl?: string) {
  if (!baseUrl) return css;
  return css.replace(/url\((['"]?)([^)'"\s]+)\1\)/g, (_match, quote: string, value: string) => `url(${quote}${absolutisePluginUrl(value, baseUrl)}${quote})`);
}

async function loadPluginText(url: string, bridge?: NativeBridge) {
  if (bridge) return bridge.fetchPluginSource(url);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function PluginRuntime({ plugin, bridge, language, theme }: { plugin: WorkspacePlugin; bridge?: NativeBridge; language: "zh" | "en"; theme: "light" | "dark" }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let disposed = false;
    let activeApi: unknown;
    let activeHost: HTMLDivElement | null = null;
    const boot = async () => {
      try {
        setError("");
        const source = plugin.source || (plugin.url ? await loadPluginText(plugin.url, bridge) : "");
        if (!source) throw new Error(language === "en" ? "The plugin has no page source." : "插件没有可运行的页面内容。");
        if (disposed || !hostRef.current) return;

        const parsed = new DOMParser().parseFromString(source, "text/html");
        activeHost = hostRef.current;
        activeHost.dataset.theme = theme;
        const shadow = activeHost.shadowRoot || activeHost.attachShadow({ mode: "open" });
        shadow.replaceChildren();
        const runtimeStyle = document.createElement("style");
        runtimeStyle.textContent = ":host{display:block;width:100%;min-height:100%;background:#fff;color:#172033}:host([data-theme='dark']){background:#0b1220;color:#e6eef8}.piclite-plugin-page{width:100%;min-height:100%;height:auto;overflow:visible;box-sizing:border-box}";
        shadow.append(runtimeStyle);

        for (const style of Array.from(parsed.querySelectorAll("style"))) {
          const element = document.createElement("style");
          element.textContent = rewritePluginCss(style.textContent || "", plugin.url);
          shadow.append(element);
        }
        for (const link of Array.from(parsed.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]'))) {
          const href = absolutisePluginUrl(link.getAttribute("href") || "", plugin.url);
          if (!href) continue;
          const element = document.createElement("style");
          element.textContent = rewritePluginCss(await loadPluginText(href, bridge), href);
          shadow.append(element);
        }

        const page = document.createElement("div");
        page.className = "piclite-plugin-page";
        page.dataset.theme = theme;
        const body = parsed.body.cloneNode(true) as HTMLBodyElement;
        body.querySelectorAll("script").forEach((script) => script.remove());
        page.innerHTML = body.innerHTML;
        for (const element of Array.from(page.querySelectorAll<HTMLElement>("[src],[href],[action],[poster]"))) {
          for (const attribute of ["src", "href", "action", "poster"]) {
            const value = element.getAttribute(attribute);
            if (value) element.setAttribute(attribute, absolutisePluginUrl(value, plugin.url));
          }
        }
        page.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((anchor) => {
          anchor.target = "_blank";
          anchor.rel = "noreferrer noopener";
        });
        shadow.append(page);

        const api = {
          version: "1.0.0",
          root: page.querySelector<HTMLElement>("#piclite-plugin-root") || page,
          theme,
          post(type: string, payload?: unknown) {
            window.dispatchEvent(new CustomEvent("piclite:plugin-message", { detail: { pluginId: plugin.id, type, payload } }));
          },
        };
        activeApi = api;
        (window as unknown as { PicLitePlugin?: unknown }).PicLitePlugin = api;
        const scopedStorage = new Proxy(window.localStorage, {
          get(target, key) {
            if (key === "getItem") return (name: string) => /theme/i.test(name) ? theme : target.getItem(name);
            if (key === "setItem") return (name: string, value: string) => { if (!/theme/i.test(name)) target.setItem(name, value); };
            if (key === "removeItem") return (name: string) => { if (!/theme/i.test(name)) target.removeItem(name); };
            const value = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        const scopedDocument = new Proxy(document, {
          get(target, key) {
            if (key === "documentElement" || key === "body") return page;
            if (key === "querySelector") return shadow.querySelector.bind(shadow);
            if (key === "querySelectorAll") return shadow.querySelectorAll.bind(shadow);
            if (key === "getElementById") return (id: string) => shadow.querySelector(`#${CSS.escape(id)}`);
            const value = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        const scopedWindow = new Proxy(window, {
          get(target, key) {
            if (key === "document") return scopedDocument;
            if (key === "localStorage") return scopedStorage;
            if (key === "PicLitePlugin") return api;
            const value = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        for (const [index, script] of Array.from(parsed.querySelectorAll("script")).entries()) {
          if ((script.type || "").toLowerCase() === "module") throw new Error(language === "en" ? "Module scripts are not supported by the trusted plugin runtime. Bundle the plugin into one classic JavaScript file." : "可信插件运行容器暂不支持 module 脚本，请把插件打包为单个普通 JavaScript 文件。");
          const src = script.getAttribute("src");
          const code = src ? await loadPluginText(absolutisePluginUrl(src, plugin.url), bridge) : script.textContent || "";
          if (disposed) return;
          new Function("window", "document", "PicLitePlugin", "localStorage", `${code}\n//# sourceURL=piclite-plugin-${plugin.id}-${index}.js`)(scopedWindow, scopedDocument, api, scopedStorage);
        }
      } catch (reason) {
        if (!disposed) setError(reason instanceof Error ? reason.message : String(reason));
      }
    };
    void boot();
    return () => {
      disposed = true;
      const target = window as unknown as { PicLitePlugin?: unknown };
      if (target.PicLitePlugin === activeApi) delete target.PicLitePlugin;
      activeHost?.shadowRoot?.replaceChildren();
    };
  }, [bridge, language, plugin, theme]);

  return <div className="plugin-runtime-shell">{error && <div className="plugin-runtime-error"><strong>{language === "en" ? "Plugin could not be loaded" : "插件载入失败"}</strong><p>{error}</p></div>}<div className="plugin-runtime" ref={hostRef} /></div>;
}

function BatchRenamePage({ bridge, language }: { bridge?: NativeBridge; language: "zh" | "en" }) {
  const t = useCallback((zh: string, en: string) => language === "en" ? en : zh, [language]);
  const [request, setRequest] = useState<BatchRenameRequest>({
    rootFolder: "",
    folderPattern: String.raw`[【\[]\s*(\d+)\s*-\s*(\d+)\s*[】\]]`,
    renameTemplate: "{code}_{name}",
    firstPadding: 2,
    secondPadding: 2,
  });
  const [preview, setPreview] = useState<BatchRenameResult | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const patch = (value: Partial<BatchRenameRequest>) => { setRequest((current) => ({ ...current, ...value })); setPreview(null); };
  const chooseRoot = async () => {
    const rootFolder = await bridge?.selectFolder("input");
    if (rootFolder) { patch({ rootFolder }); setStatus(""); }
  };
  const scan = async () => {
    if (!bridge || !request.rootFolder) { setStatus(t("请先选择根目录", "Choose a root folder first")); return; }
    setBusy(true); setStatus(t("正在递归扫描图片…", "Scanning images recursively…"));
    try {
      const result = await bridge.previewBatchRename(request);
      setPreview(result);
      setStatus(t(`找到 ${result.entries.length} 张图片，${result.matched} 张匹配规则`, `${result.entries.length} images found; ${result.matched} match`));
    } catch (error) { setPreview(null); setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    if (!bridge || !preview?.entries.some((entry) => entry.ready)) return;
    setBusy(true); setStatus(t("正在批量重命名…", "Renaming images…"));
    try {
      const result = await bridge.applyBatchRename(request);
      setPreview(result);
      setStatus(t(`已重命名 ${result.renamed} 张，跳过 ${result.skipped} 张`, `Renamed ${result.renamed}; skipped ${result.skipped}`));
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const applyPreset = (value: string) => {
    const presets: Record<string, Partial<BatchRenameRequest>> = {
      numbers: { folderPattern: String.raw`[【\[]\s*(\d+)\s*-\s*(\d+)\s*[】\]]`, renameTemplate: "{code}_{name}" },
      chinese: { folderPattern: "(风景|人物)", renameTemplate: "{1}_{name}" },
      english: { folderPattern: "([A-Za-z]+)", renameTemplate: "{1}_{name}" },
      initials: { folderPattern: "([A-Za-z]+(?:[ _-]+[A-Za-z]+)*)", renameTemplate: "{1:initials}_{name}" },
    };
    if (presets[value]) patch(presets[value]);
  };
  return <section className="rename-page">
    <header className="rename-hero"><span className="section-index">BUILT-IN PLUGIN / RENAME</span><h1>{t("从目录里提取，", "Extract from folders,")}<br /><span>{t("批量命名。", "rename in batches.")}</span></h1><p>{t("向上查找第一个匹配的父目录，先预览，再安全重命名。不会覆盖已有文件，也不会改动其它格式文件。", "Find the first matching parent, preview every change, then rename safely without overwriting other files.")}</p></header>
    <div className="rename-console">
      <div className="rename-console-head"><div><i className={preview ? "active" : ""} /><strong>{busy ? t("处理中", "WORKING") : t("规则编辑器", "RULE EDITOR")}</strong></div><small>{status || t("所有处理都在本机完成", "Everything stays on this device")}</small></div>
      <div className="rename-root"><button type="button" onClick={() => void chooseRoot()}><span>⌑</span><small>{t("扫描根目录", "Root folder")}</small><strong>{request.rootFolder || t("选择包含多级子目录的文件夹", "Choose a folder with nested images")}</strong><b>{t("选择", "Choose")}</b></button></div>
      <div className="rename-fields">
        <label><span>{t("常用规则", "Rule preset")}</span><select defaultValue="" onChange={(event) => applyPreset(event.target.value)}><option value="">{t("选择示例，可继续修改", "Choose an editable example")}</option><option value="numbers">【1-1】 → 0101</option><option value="chinese">风景 / 人物</option><option value="english">English word</option><option value="initials">New York → NY</option></select></label>
        <label className="rename-pattern"><span>{t("父目录匹配规则（正则）", "Parent-folder pattern (regex)")}</span><input value={request.folderPattern} onChange={(event) => patch({ folderPattern: event.target.value })} /></label>
        <label className="rename-template"><span>{t("新文件名模板", "New filename template")}</span><input value={request.renameTemplate} onChange={(event) => patch({ renameTemplate: event.target.value })} /><small>{"{code} {name} {ext} {folder} {match} {1} {2} {1:initials} {index:03}"}</small></label>
        <label><span>{t("数字补齐位数", "Numeric padding")}</span><div className="rename-padding"><input aria-label="First padding" type="number" min="1" max="12" value={request.firstPadding} onChange={(event) => patch({ firstPadding: Math.max(1, Math.min(12, Number(event.target.value) || 1)) })} /><b>+</b><input aria-label="Second padding" type="number" min="1" max="12" value={request.secondPadding} onChange={(event) => patch({ secondPadding: Math.max(1, Math.min(12, Number(event.target.value) || 1)) })} /></div></label>
      </div>
      <div className="rename-actions"><button type="button" disabled={busy || !request.rootFolder} onClick={() => void scan()}>{busy ? "···" : "⌕"} {t("扫描并预览", "Scan and preview")}</button><button className="primary" type="button" disabled={busy || !preview?.entries.some((entry) => entry.ready)} onClick={() => void apply()}>{t("执行重命名", "Apply rename")}</button></div>
      {preview && <div className="rename-preview"><header><strong>{t("重命名预览", "Rename preview")}</strong><span>{t(`${preview.matched} 个匹配 · ${preview.failed} 个冲突`, `${preview.matched} matches · ${preview.failed} conflicts`)}</span></header>{preview.entries.slice(0, 200).map((entry) => <div className={entry.ready ? "ready" : "blocked"} key={entry.source}><span title={entry.source}>{entry.sourceName}</span><b>→</b><span title={entry.target}>{entry.targetName || entry.error}</span><small>{entry.error || entry.code}</small></div>)}</div>}
    </div>
  </section>;
}

const DEFAULT_SETTINGS: CompressionSettings = {
  mode: "lossless",
  quality: 100,
  scale: 100,
  targetSizeKb: 0,
  format: "keep",
  resize: false,
  width: 1920,
  height: 1080,
  lockRatio: true,
  stripMetadata: true,
  preventLarger: true,
  watermark: {
    enabled: false,
    text: "PicLite",
    layout: "tile",
    fontFamily: "Microsoft YaHei",
    fontScale: 4.5,
    color: "#ffffff",
    opacity: 28,
    rotation: -28,
    density: 55,
    positionX: 82,
    positionY: 88,
    shadow: true,
    shadowBlur: 7,
    shadowColor: "#000000",
  },
};

const DEFAULT_DESKTOP_PREFERENCES: DesktopPreferences = {
  exportMode: "same-folder",
  exportSuffix: "-piclite",
  exportFolder: "",
  renameTemplate: "{name}{suffix}",
  confirmOverwrite: true,
  preventLarger: true,
  theme: "system",
  colorTheme: "graphite",
  dockTheme: "system",
  density: "auto",
  minimizeToTray: true,
  showInTaskbarDock: true,
  allowFloatingCapture: false,
  launchAtStartup: false,
  shortcutsEnabled: true,
  shortcutShow: "CommandOrControl+Alt+P",
  shortcutPaste: "CommandOrControl+Alt+V",
  shortcutDock: "CommandOrControl+Alt+D",
  shortcutGallery: "CommandOrControl+Alt+L",
  shortcutUpload: "CommandOrControl+Alt+U",
  dockLayout: "compact",
  floatingResultSeconds: 10,
  clipboardWatcherEnabled: false,
  autoCheckUpdates: true,
  updateCheckFrequency: "startup",
  language: "zh",
};

const DEFAULT_UPLOAD_SETTINGS: UploadSettings = {
  provider: "webdav",
  endpoint: "",
  bucket: "",
  region: "auto",
  accessKey: "",
  username: "",
  port: 22,
  remotePath: "piclite",
  publicBaseUrl: "",
  keyPath: "",
  pathStyle: true,
};

function loadStoredDesktopPreferences(): DesktopPreferences {
  if (typeof window === "undefined") return DEFAULT_DESKTOP_PREFERENCES;
  try {
    const saved = window.localStorage.getItem("piclite.desktopPreferences.v1");
    if (!saved) return DEFAULT_DESKTOP_PREFERENCES;
    const preferences = { ...DEFAULT_DESKTOP_PREFERENCES, ...JSON.parse(saved) } as DesktopPreferences & { dockLayout?: string };
    // 0.11 之前的“桌宠”偏好自动迁移到紧凑压缩坞。
    const colorTheme: ColorTheme = ["graphite", "mist", "violet", "green"].includes(preferences.colorTheme)
      ? preferences.colorTheme
      : "graphite";
    const updateCheckFrequency: UpdateCheckFrequency = ["startup", "daily", "weekly", "never"].includes(preferences.updateCheckFrequency)
      ? preferences.updateCheckFrequency
      : preferences.autoCheckUpdates === false ? "never" : "startup";
    return { ...preferences, colorTheme, updateCheckFrequency, autoCheckUpdates: updateCheckFrequency !== "never", dockLayout: preferences.dockLayout === "full" ? "full" : "compact", language: preferences.language === "en" ? "en" : "zh" };
  } catch {
    return DEFAULT_DESKTOP_PREFERENCES;
  }
}

function loadUploadSettings(): UploadSettings {
  if (typeof window === "undefined") return DEFAULT_UPLOAD_SETTINGS;
  try {
    const saved = window.localStorage.getItem("piclite.uploadSettings.v1");
    return saved ? { ...DEFAULT_UPLOAD_SETTINGS, ...JSON.parse(saved) } as UploadSettings : DEFAULT_UPLOAD_SETTINGS;
  } catch {
    return DEFAULT_UPLOAD_SETTINGS;
  }
}

function resolveTheme(theme: ThemeMode) {
  return theme === "system"
    ? (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : theme;
}

type ShortcutKeyEvent = Pick<globalThis.KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

function shortcutFromKeyboardEvent(event: ShortcutKeyEvent) {
  const key = event.key;
  if (["Control", "Meta", "Alt", "Shift"].includes(key)) return null;
  if (key === "Escape") return "escape";
  if (key === "Backspace" || key === "Delete") return "";
  const modifiers: string[] = [];
  if (event.metaKey || event.ctrlKey) modifiers.push("CommandOrControl");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (!modifiers.length) return null;
  const codeAliases: Record<string, string> = {
    Space: "Space", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
    Enter: "Enter", Tab: "Tab", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown",
  };
  const normalizedKey = event.code.startsWith("Key")
    ? event.code.slice(3)
    : event.code.startsWith("Digit")
      ? event.code.slice(5)
      : /^F(?:[1-9]|1\d|2[0-4])$/.test(event.code)
        ? event.code
        : codeAliases[event.code] || (key.length === 1 && /[a-z0-9]/i.test(key) ? key.toUpperCase() : "");
  if (!normalizedKey) return null;
  return [...modifiers, normalizedKey].join("+");
}

function shortcutLabel(value: string, platform: string) {
  if (!value) return "未设置";
  const labels = value.split("+").map((part) => {
    if (part === "CommandOrControl") return platform === "darwin" ? "⌘" : "Ctrl";
    if (part === "Alt") return platform === "darwin" ? "⌥" : "Alt";
    if (part === "Shift") return platform === "darwin" ? "⇧" : "Shift";
    return part;
  });
  return labels.join(platform === "darwin" ? "  " : " + ");
}

function presetSettings(mode: CompressionMode, quality: number, scale = 100): CompressionSettings {
  return { ...DEFAULT_SETTINGS, mode, quality, scale, watermark: { ...DEFAULT_SETTINGS.watermark } };
}

const BUILT_IN_PRESETS: SavedPreset[] = [
  { id: "lossless", name: "无损优先", settings: presetSettings("lossless", 100) },
  { id: "balanced", name: "智能平衡", settings: presetSettings("balanced", 82) },
  { id: "small", name: "更小体积", settings: presetSettings("small", 45, 75) },
];

function loadStoredSettings() {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const saved = window.localStorage.getItem("piclite.compressionSettings.v2");
    if (!saved) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(saved) as Partial<CompressionSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed, watermark: { ...DEFAULT_SETTINGS.watermark, ...parsed.watermark } };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function loadStoredPresets() {
  if (typeof window === "undefined") return BUILT_IN_PRESETS;
  try {
    const saved = window.localStorage.getItem("piclite.customPresets.v1");
    const custom = saved ? JSON.parse(saved) as SavedPreset[] : [];
    return [...BUILT_IN_PRESETS, ...custom.filter((preset) => preset.custom)];
  } catch {
    return BUILT_IN_PRESETS;
  }
}

const DEFAULT_WATCHER_SETTINGS: WatcherSettings = {
  inputFolder: "",
  inputFolders: [],
  outputFolder: "",
  mode: "lossless",
  quality: 100,
  scale: 100,
  format: "keep",
  resize: false,
  maxWidth: 2560,
  maxHeight: 2560,
  stripMetadata: true,
  preventLarger: true,
  onlyWhenNeeded: false,
  notifyOnComplete: true,
  showFloatingResult: false,
};

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const GALLERY_DB_NAME = "piclite-gallery";
const GALLERY_STORE_NAME = "images";

function openGalleryDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(GALLERY_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(GALLERY_STORE_NAME)) request.result.createObjectStore(GALLERY_STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("图库无法打开"));
  });
}

async function galleryPut(record: GalleryRecord) {
  const database = await openGalleryDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(GALLERY_STORE_NAME, "readwrite");
    transaction.objectStore(GALLERY_STORE_NAME).put(record);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("图库写入失败"));
  });
  database.close();
}

async function galleryList() {
  const database = await openGalleryDb();
  const records = await new Promise<GalleryRecord[]>((resolve, reject) => {
    const request = database.transaction(GALLERY_STORE_NAME, "readonly").objectStore(GALLERY_STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result as GalleryRecord[]);
    request.onerror = () => reject(request.error || new Error("图库读取失败"));
  });
  database.close();
  return records.sort((left, right) => right.createdAt - left.createdAt);
}

async function galleryDelete(id: string) {
  const database = await openGalleryDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(GALLERY_STORE_NAME, "readwrite");
    transaction.objectStore(GALLERY_STORE_NAME).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("图库删除失败"));
  });
  database.close();
}

async function galleryDeleteMany(ids: string[]) {
  if (!ids.length) return;
  const database = await openGalleryDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(GALLERY_STORE_NAME, "readwrite");
    const store = transaction.objectStore(GALLERY_STORE_NAME);
    ids.forEach((id) => store.delete(id));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("图库批量删除失败"));
  });
  database.close();
}

function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; value >= 1024 && index < units.length; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${unit}`;
}

function savedPercent(original = 0, output = 0) {
  if (!original || !output) return 0;
  return Math.round((1 - output / original) * 100);
}

function sizeChangeLabel(original = 0, output = 0) {
  const saved = savedPercent(original, output);
  if (saved > 0) return `−${saved}%`;
  if (saved < 0) return `+${Math.abs(saved)}%`;
  return "0%";
}

function modeFromQuality(quality: number): CompressionMode {
  if (quality >= 100) return "lossless";
  return "manual";
}

function formatScale(scale: number) {
  return `${scale < 1 ? scale.toFixed(1) : Math.round(scale)}%`;
}

function outputExtension(type: string, originalName: string) {
  if (type === "image/jpeg") return "jpg";
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return originalName.split(".").pop()?.toLowerCase() || "png";
}

function mimeFromName(name: string) {
  const extension = name.split(".").pop()?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg" || extension === "jfif") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  if (extension === "avif") return "image/avif";
  if (extension === "gif") return "image/gif";
  return "application/octet-stream";
}

function outputName(item: ImageItem, suffix = "-piclite", template = "{name}{suffix}") {
  const base = item.name.replace(/\.[^.]+$/, "");
  const extension = outputExtension(item.outputType || item.type, item.name);
  const now = new Date();
  const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()].map((value) => String(value).padStart(2, "0")).join("-");
  let value = (template.trim() || "{name}{suffix}")
    .replaceAll("{name}", base)
    .replaceAll("{suffix}", suffix)
    .replaceAll("{date}", date)
    .replaceAll("{time}", time)
    .replaceAll("{datetime}", `${date}_${time}`)
    .replaceAll("{size}", String(item.outputBytes || item.originalBytes))
    .replaceAll("{width}", String(item.outputWidth || item.width))
    .replaceAll("{height}", String(item.outputHeight || item.height))
    .replaceAll("{ext}", extension);
  if (!template.includes("{ext}")) value += `.${extension}`;
  return Array.from(value, (character) => '<>:"/\\|?*'.includes(character) || character.charCodeAt(0) < 32 ? "-" : character).join("");
}

function cleanSuffix(value: string) {
  const forbidden = '<>:"/\\|?*';
  const safe = Array.from(value.trim(), (character) => character.charCodeAt(0) < 32 || forbidden.includes(character) ? "-" : character).join("").replace(/\.+$/g, "");
  if (!safe) return "-piclite";
  return safe.startsWith("-") || safe.startsWith("_") ? safe : `-${safe}`;
}

async function getDimensions(file: File) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

async function stripPngMetadata(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 12 || !signature.every((value, index) => bytes[index] === value)) return file;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Uint8Array[] = [bytes.slice(0, 8)];
  const removable = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset, false);
    const end = offset + 12 + length;
    if (end > bytes.length) return file;
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    if (!removable.has(type)) chunks.push(bytes.slice(offset, end));
    offset = end;
    if (type === "IEND") break;
  }
  return new Blob(chunks.map((chunk) => chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer), { type: "image/png" });
}

async function stripJpegMetadata(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return file;
  const segments: Uint8Array[] = [bytes.slice(0, 2)];
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return file;
    const marker = bytes[offset + 1];
    if (marker === 0xda) {
      segments.push(bytes.slice(offset));
      break;
    }
    if (marker === 0xd9) {
      segments.push(bytes.slice(offset, offset + 2));
      break;
    }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    const end = offset + 2 + length;
    if (length < 2 || end > bytes.length) return file;
    const removable = marker === 0xfe || marker === 0xe1 || marker === 0xed;
    if (!removable) {
      segments.push(bytes.slice(offset, end));
    } else if (marker === 0xe1) {
      const orientation = readExifOrientation(bytes, offset, end);
      if (orientation > 1) segments.push(minimalOrientationSegment(orientation));
    }
    offset = end;
  }
  return new Blob(segments.map((segment) => segment.buffer.slice(segment.byteOffset, segment.byteOffset + segment.byteLength) as ArrayBuffer), { type: "image/jpeg" });
}

function readExifOrientation(bytes: Uint8Array, offset: number, end: number) {
  const payload = offset + 4;
  if (payload + 14 > end || String.fromCharCode(...bytes.slice(payload, payload + 6)) !== "Exif\0\0") return 1;
  const tiff = payload + 6;
  const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
  if (!little && !(bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d)) return 1;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ifd = tiff + view.getUint32(tiff + 4, little);
  if (ifd + 2 > end) return 1;
  const count = view.getUint16(ifd, little);
  for (let index = 0; index < count; index += 1) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > end) break;
    if (view.getUint16(entry, little) === 0x0112) return view.getUint16(entry + 8, little);
  }
  return 1;
}

function minimalOrientationSegment(orientation: number) {
  const segment = new Uint8Array(36);
  segment.set([0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 0);
  const view = new DataView(segment.buffer);
  const tiff = 10;
  view.setUint16(tiff, 0x4d4d, false);
  view.setUint16(tiff + 2, 42, false);
  view.setUint32(tiff + 4, 8, false);
  view.setUint16(tiff + 8, 1, false);
  view.setUint16(tiff + 10, 0x0112, false);
  view.setUint16(tiff + 12, 3, false);
  view.setUint32(tiff + 14, 1, false);
  view.setUint16(tiff + 18, Math.min(8, Math.max(1, orientation)), false);
  view.setUint32(tiff + 22, 0, false);
  return segment;
}

async function optimizeLosslessly(file: File) {
  if (file.type === "image/jpeg") return stripJpegMetadata(file);
  if (file.type === "image/png") return stripPngMetadata(file);
  return file;
}

function getTargetDimensions(item: Pick<ImageItem, "width" | "height">, settings: CompressionSettings) {
  let ratio = Math.min(1, Math.max(0.001, settings.scale / 100));
  if (settings.resize && settings.lockRatio) {
    const maxWidth = Math.max(1, settings.width || item.width);
    const maxHeight = Math.max(1, settings.height || item.height);
    ratio = Math.min(ratio, maxWidth / item.width, maxHeight / item.height);
  }

  if (settings.resize && !settings.lockRatio) {
    return {
      width: Math.max(1, Math.round(Math.min(item.width * ratio, settings.width || item.width))),
      height: Math.max(1, Math.round(Math.min(item.height * ratio, settings.height || item.height))),
    };
  }

  return {
    width: Math.max(1, Math.round(item.width * ratio)),
    height: Math.max(1, Math.round(item.height * ratio)),
  };
}

function createWatermarkLayer(width: number, height: number, watermark: WatermarkSettings) {
  const text = watermark.text.trim();
  if (!watermark.enabled || !text) return null;

  const fontSize = Math.max(8, Math.min(width, height) * (watermark.fontScale / 100));
  const layer = document.createElement("canvas");
  layer.width = width;
  layer.height = height;
  const layerContext = layer.getContext("2d", { alpha: true });
  if (!layerContext) return null;
  layerContext.fillStyle = watermark.color;
  layerContext.font = `${fontSize}px "${watermark.fontFamily.replaceAll('"', "")}", sans-serif`;
  layerContext.textAlign = "center";
  layerContext.textBaseline = "middle";
  if (watermark.shadow) {
    layerContext.shadowColor = watermark.shadowColor;
    layerContext.shadowBlur = watermark.shadowBlur;
    layerContext.shadowOffsetX = Math.max(1, watermark.shadowBlur * 0.2);
    layerContext.shadowOffsetY = Math.max(1, watermark.shadowBlur * 0.2);
  }

  const angle = watermark.rotation * Math.PI / 180;
  if (watermark.layout === "single") {
    layerContext.translate(width * watermark.positionX / 100, height * watermark.positionY / 100);
    layerContext.rotate(angle);
    layerContext.fillText(text, 0, 0);
  } else {
    const diagonal = Math.hypot(width, height);
    const measured = Math.max(fontSize * 2, layerContext.measureText(text).width);
    const density = Math.min(1, Math.max(0, watermark.density / 100));
    // A non-linear curve gives the low end real breathing room: 0% is deliberately
    // sparse enough for one or two marks on ordinary photos, while 100% stays dense.
    const sparse = (1 - density) ** 2;
    const stepX = measured + fontSize * (1.05 + sparse * 18);
    const stepY = fontSize * (1.45 + sparse * 14);
    layerContext.translate(width / 2, height / 2);
    layerContext.rotate(angle);
    let row = 0;
    for (let y = -diagonal; y <= diagonal; y += stepY) {
      const offset = row % 2 ? stepX / 2 : 0;
      for (let x = -diagonal - offset; x <= diagonal; x += stepX) layerContext.fillText(text, x + offset, y);
      row += 1;
    }
  }
  return layer;
}

function applyWatermark(context: CanvasRenderingContext2D, width: number, height: number, watermark: WatermarkSettings, layer = createWatermarkLayer(width, height, watermark)) {
  if (!layer) return;
  // Composite once so the opacity applies equally to the glyph and shadow.
  context.save();
  context.globalAlpha = Math.min(1, Math.max(0.01, watermark.opacity / 100));
  context.drawImage(layer, 0, 0);
  context.restore();
}

type DecodedGifFrame = {
  image: {
    duration?: number | null;
    close: () => void;
  };
};

type GifDecoder = {
  tracks: { ready: Promise<void>; selectedTrack?: { frameCount?: number } | null };
  decode: (options: { frameIndex: number }) => Promise<DecodedGifFrame>;
  close: () => void;
};

type GifDecoderConstructor = new (options: { data: ArrayBuffer; type: string }) => GifDecoder;

async function animatedGifCompress(item: ImageItem, settings: CompressionSettings) {
  const Decoder = (window as unknown as { ImageDecoder?: GifDecoderConstructor }).ImageDecoder;
  if (!Decoder) throw new Error("动态 GIF 实时压缩需要最新版 Chrome、Edge 或桌面客户端");

  const { width, height } = getTargetDimensions(item, settings);
  const decoder = new Decoder({ data: await item.file.arrayBuffer(), type: "image/gif" });
  await decoder.tracks.ready;
  const frameCount = decoder.tracks.selectedTrack?.frameCount || 1;
  const encoder = GIFEncoder();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
  if (!context) {
    decoder.close();
    throw new Error("当前浏览器无法创建 GIF 画布");
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  const colors = Math.max(2, Math.min(256, Math.round(2 + 254 * (settings.quality / 100) ** 1.45)));
  const watermarkLayer = createWatermarkLayer(width, height, settings.watermark);

  try {
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const { image } = await decoder.decode({ frameIndex });
      context.clearRect(0, 0, width, height);
      context.drawImage(image as unknown as CanvasImageSource, 0, 0, width, height);
      applyWatermark(context, width, height, settings.watermark, watermarkLayer);
      const rgba = context.getImageData(0, 0, width, height).data;
      const palette = quantize(rgba, colors, { format: "rgba4444", oneBitAlpha: true });
      const indexed = stochasticDitherToPalette(rgba, palette, width, height, settings.quality);
      const transparentIndex = palette.findIndex((color) => color[3] === 0);
      encoder.writeFrame(indexed, width, height, {
        palette,
        delay: Math.max(20, Math.round((image.duration || 100_000) / 1000)),
        repeat: 0,
        transparent: transparentIndex >= 0,
        transparentIndex: Math.max(0, transparentIndex),
      });
      image.close();
    }
    encoder.finish();
    return { blob: new Blob([new Uint8Array(encoder.bytes())], { type: "image/gif" }), width, height };
  } finally {
    decoder.close();
  }
}

async function canvasCompress(item: ImageItem, settings: CompressionSettings) {
  const bitmap = await createImageBitmap(item.file);
  const { width, height } = getTargetDimensions(item, settings);

  const sameSize = width === item.width && height === item.height;
  if (settings.quality >= 100 && settings.format === "keep" && sameSize && !settings.watermark.enabled) {
    bitmap.close();
    const blob = settings.stripMetadata ? await optimizeLosslessly(item.file) : item.file;
    return { blob, width, height };
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("当前浏览器无法创建图片画布");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  let outputType = settings.format === "keep" ? item.type : settings.format;
  if (!["image/jpeg", "image/png", "image/webp"].includes(outputType)) outputType = "image/png";
  if (outputType === "image/jpeg") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  applyWatermark(context, width, height, settings.watermark);

  const quality = Math.min(1, Math.max(0.01, settings.quality / 100));
  // Canvas ignores the quality argument for PNG. At 100% we deliberately keep
  // true-colour lossless output; below 100% we write an indexed PNG so that the
  // shared quality control has a real, predictable effect while retaining alpha.
  const result = outputType === "image/png" && settings.quality < 100
    ? await encodeIndexedPng(context, width, height, settings.quality)
    : await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, outputType, quality));
  if (!result) throw new Error("当前浏览器不支持所选输出格式");
  if (!isRequestedMimeType(result.type, outputType)) {
    throw new Error(`当前浏览器把 ${outputType} 回退成了 ${result.type || "未知格式"}，已阻止错误格式结果`);
  }
  if (settings.quality >= 100 && settings.format === "keep" && sameSize && !settings.watermark.enabled && result.size >= item.originalBytes) {
    const blob = settings.stripMetadata ? await optimizeLosslessly(item.file) : item.file;
    return { blob, width, height };
  }
  return { blob: result, width, height };
}

function pngPaletteSize(quality: number) {
  const normalized = Math.min(0.99, Math.max(0.01, quality / 100));
  return Math.max(64, Math.min(256, Math.round(64 + 192 * normalized ** 1.35)));
}

function stochasticDitherToPalette(
  rgba: Uint8ClampedArray,
  palette: number[][],
  width: number,
  height: number,
  quality: number,
) {
  const dithered = new Uint8ClampedArray(rgba);
  const strength = Math.max(2, Math.min(12, Math.ceil((100 - Math.max(1, Math.min(99, quality))) / 6)));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelOffset = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        let hash = (Math.imul(x & 63, 374761393) + Math.imul(y & 63, 668265263) + Math.imul(channel, -2048144777)) >>> 0;
        hash = Math.imul(hash ^ (hash >>> 13), 1274126177) >>> 0;
        hash ^= hash >>> 16;
        const triangular = (hash & 255) - ((hash >>> 8) & 255);
        dithered[pixelOffset + channel] = Math.max(0, Math.min(255, rgba[pixelOffset + channel] + triangular * strength / 255));
      }
    }
  }
  return applyPalette(dithered, palette, "rgba4444");
}

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function pngChunk(type: string, data: Uint8Array) {
  const typeBytes = new TextEncoder().encode(type);
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  let crc = 0xffffffff;
  for (let index = 4; index < 8 + data.length; index += 1) crc = PNG_CRC_TABLE[(crc ^ chunk[index]) & 0xff] ^ (crc >>> 8);
  view.setUint32(8 + data.length, (crc ^ 0xffffffff) >>> 0);
  return chunk;
}

async function encodeIndexedPng(context: CanvasRenderingContext2D, width: number, height: number, quality: number) {
  if (typeof CompressionStream === "undefined") {
    return new Promise<Blob | null>((resolve) => context.canvas.toBlob(resolve, "image/png"));
  }
  const rgba = context.getImageData(0, 0, width, height).data;
  const palette = quantize(rgba, pngPaletteSize(quality), { format: "rgba4444", oneBitAlpha: false });
  const indexed = stochasticDitherToPalette(rgba, palette, width, height, quality);
  const scanlines = new Uint8Array((width + 1) * height);
  for (let row = 0; row < height; row += 1) scanlines.set(indexed.subarray(row * width, (row + 1) * width), row * (width + 1) + 1);

  const compressed = new Uint8Array(await new Response(
    new Blob([scanlines.buffer]).stream().pipeThrough(new CompressionStream("deflate")),
  ).arrayBuffer());
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  header.set([8, 3, 0, 0, 0], 8);
  const paletteRgb = new Uint8Array(palette.length * 3);
  const paletteAlpha = new Uint8Array(palette.length);
  palette.forEach((color, index) => {
    paletteRgb.set(color.slice(0, 3), index * 3);
    paletteAlpha[index] = color[3] ?? 255;
  });
  let alphaLength = paletteAlpha.length;
  while (alphaLength > 0 && paletteAlpha[alphaLength - 1] === 255) alphaLength -= 1;
  const chunks = [PNG_SIGNATURE, pngChunk("IHDR", header), pngChunk("PLTE", paletteRgb)];
  if (alphaLength > 0) chunks.push(pngChunk("tRNS", paletteAlpha.subarray(0, alphaLength)));
  chunks.push(pngChunk("IDAT", compressed), pngChunk("IEND", new Uint8Array()));
  return new Blob(chunks.map((chunk) => chunk.buffer as ArrayBuffer), { type: "image/png" });
}

type CompressionResult = { blob: Blob; width: number; height: number; keptOriginal?: boolean; sizeGuardQuality?: number; strategy?: string };

function smartCandidates(item: ImageItem, settings: CompressionSettings) {
  if (settings.mode === "lossless" || settings.mode === "manual" || item.type === "image/gif") return [settings];

  // These are quality guard rails, not just named presets. We try a small set
  // of real encodes and retain the smallest result within the mode's visual
  // budget. PNG is not blindly converted to JPEG because it may be transparent.
  // "Keep original" is a hard output constraint. Previous builds also tested
  // WebP here, so Windows batches could preview a WebP candidate and later
  // export every mixed PNG/JPG input with a .webp extension.
  const formats: OutputFormat[] = smartCandidateOutputFormats(settings.format);
  const qualityStops = settings.mode === "balanced"
    ? [Math.min(settings.quality, 86), Math.min(settings.quality, 81), Math.min(settings.quality, 77)]
    : [Math.min(settings.quality, 68), Math.min(settings.quality, 58), Math.min(settings.quality, 46)];
  const scaleStops = settings.mode === "balanced"
    ? [settings.scale, Math.min(settings.scale, 96), Math.min(settings.scale, 92)]
    : [Math.min(settings.scale, 88), Math.min(settings.scale, 80), Math.min(settings.scale, 72)];
  const candidates: CompressionSettings[] = [];
  formats.forEach((format) => qualityStops.forEach((quality, index) => {
    candidates.push({ ...settings, format, quality: Math.max(1, Math.round(quality)), scale: Math.max(0.1, scaleStops[index]) });
  }));
  return candidates.filter((candidate, index, all) => all.findIndex((other) => (
    other.format === candidate.format && other.quality === candidate.quality && other.scale === candidate.scale
  )) === index);
}

function strategyLabel(settings: CompressionSettings) {
  const format = settings.format === "keep" ? "原格式" : settings.format.split("/")[1].toUpperCase();
  return `${format} · ${Math.round(settings.quality)}% · ${formatScale(settings.scale)} 尺寸`;
}

async function compressImageBase(item: ImageItem, settings: CompressionSettings, nativeBridge?: NativeBridge): Promise<CompressionResult> {
  if (item.type === "image/gif" && nativeBridge && (settings.format === "keep" || settings.format === "image/webp")) {
    const result = await nativeBridge.compressAnimationData(
      new Uint8Array(await item.file.arrayBuffer()),
      item.name,
      {
        mode: settings.mode,
        quality: settings.quality,
        scale: settings.scale,
        format: settings.format,
        stripMetadata: settings.stripMetadata,
        preventLarger: settings.preventLarger,
        exportMode: "same-folder",
        exportSuffix: "-piclite",
      },
    );
    return {
      blob: new Blob([new Uint8Array(result.data)], { type: result.mimeType }),
      width: result.width,
      height: result.height,
      keptOriginal: result.keptOriginal,
      strategy: result.extension === "webp" ? `动态 WebP · ${Math.round(settings.quality)}%` : `GIF · ${Math.round(settings.quality)}%`,
    };
  }
  if (item.type === "image/gif" && settings.format === "image/webp") {
    throw new Error("动态 WebP 转换需要 PicLite 桌面客户端；网页端会保留 GIF 动画");
  }
  if (nativeBridge && item.type !== "image/gif" && !settings.watermark.enabled) {
    const sourceFormat = item.type === "image/jpg" ? "image/jpeg" : item.type;
    const requestedFormat = settings.format === "keep"
      ? (["image/jpeg", "image/png", "image/webp"].includes(sourceFormat) ? sourceFormat as OutputFormat : "image/png")
      : settings.format;
    const result = await nativeBridge.compressImageData(
      new Uint8Array(await item.file.arrayBuffer()),
      item.name,
      {
        mode: settings.mode,
        quality: settings.quality,
        scale: settings.scale,
        format: requestedFormat,
        stripMetadata: settings.stripMetadata,
        preventLarger: settings.preventLarger,
        exportMode: "same-folder",
        exportSuffix: "-piclite",
      },
    );
    return {
      blob: new Blob([new Uint8Array(result.data)], { type: result.mimeType }),
      width: result.width,
      height: result.height,
      keptOriginal: result.keptOriginal,
      strategy: `${result.extension.toUpperCase()} · ${settings.mode === "manual" ? `${Math.round(settings.quality)}%` : settings.mode}`,
    };
  }
  const encodeCandidate = (candidateSettings: CompressionSettings) => item.type === "image/gif" && candidateSettings.format === "keep"
    ? animatedGifCompress(item, candidateSettings)
    : canvasCompress(item, candidateSettings);

  const candidates = smartCandidates(item, settings);
  if (candidates.length > 1) {
    let best: (Awaited<ReturnType<typeof encodeCandidate>> & { settings: CompressionSettings }) | null = null;
    for (const candidateSettings of candidates) {
      const result = await encodeCandidate(candidateSettings);
      if (!best || result.blob.size < best.blob.size) best = { ...result, settings: candidateSettings };
    }
    if (!best) throw new Error("未生成可用的智能优化结果");
    const smartMode = settings.mode === "small" ? "small" : "balanced";
    if (!isSmartCompressionWorthwhile(item.originalBytes, best.blob.size, smartMode)) {
      const minimum = minimumSmartSavingsBytes(item.originalBytes, smartMode);
      return {
        blob: item.file,
        width: item.width,
        height: item.height,
        keptOriginal: true,
        strategy: best.blob.size >= item.originalBytes
          ? "所有高质量候选都更大"
          : `候选仅节省 ${formatBytes(item.originalBytes - best.blob.size)}，低于 ${formatBytes(minimum)} 的保真门槛`,
      };
    }
    return { blob: best.blob, width: best.width, height: best.height, strategy: strategyLabel(best.settings) };
  }

  const candidate = await encodeCandidate(settings);
  const hasVisualTransform = candidate.width !== item.width
    || candidate.height !== item.height
    || settings.format !== "keep"
    || settings.watermark.enabled;

  if ((settings.preventLarger || settings.watermark.enabled) && candidate.blob.size >= item.originalBytes) {
    const mayReduceQuality = settings.mode !== "lossless" && settings.quality < 100;
    if (hasVisualTransform && mayReduceQuality) {
      let smallest = { ...candidate, quality: settings.quality };
      const qualitySteps = Array.from(new Set([
        settings.quality - 4,
        settings.quality - 8,
        settings.quality - 14,
        settings.quality - 22,
        settings.quality - 32,
        settings.quality - 44,
        settings.quality - 58,
        settings.quality - 72,
        1,
      ].map((quality) => Math.max(1, Math.round(quality))))).filter((quality) => quality < settings.quality);

      for (const quality of qualitySteps) {
        const guardedCandidate = await encodeCandidate({ ...settings, quality });
        if (guardedCandidate.blob.size < smallest.blob.size) smallest = { ...guardedCandidate, quality };
        if (guardedCandidate.blob.size < item.originalBytes) {
          return { ...guardedCandidate, sizeGuardQuality: quality };
        }
      }
      // A requested resize/format/watermark is a hard output constraint. Return
      // the smallest valid transformed result instead of silently restoring the
      // original dimensions or format and making the controls appear frozen.
      return { blob: smallest.blob, width: smallest.width, height: smallest.height, sizeGuardQuality: smallest.quality };
    }
    if (hasVisualTransform) return candidate;
    return { blob: item.file, width: item.width, height: item.height, keptOriginal: true };
  }
  return candidate;
}

async function compressImage(item: ImageItem, settings: CompressionSettings, nativeBridge?: NativeBridge): Promise<CompressionResult> {
  if (item.sourceIsThumbnail) {
    if (!nativeBridge || !item.sourcePath) throw new Error("无法读取原始图片");
    const [source] = await nativeBridge.readImagesFromPaths([item.sourcePath]);
    if (!source) throw new Error("原始图片已移动或无法读取");
    const file = new File([new Uint8Array(source.data)], source.name || item.name, { type: source.type || item.type });
    return compressImage({ ...item, file, sourceIsThumbnail: false }, settings, nativeBridge);
  }

  const targetSizeKb = Math.max(0, Math.round(settings.targetSizeKb || 0));
  if (!targetSizeKb) return compressImageBase(item, settings, nativeBridge);

  // Use decimal kilobytes and a small safety margin because many application
  // portals reject a file at exactly their documented limit.
  const targetBytes = Math.max(1000, Math.floor(targetSizeKb * 1000 * .98));
  const hasExplicitTransform = settings.format !== "keep"
    || settings.scale < 100
    || settings.resize
    || settings.watermark.enabled;
  if (item.originalBytes <= targetBytes && !hasExplicitTransform) {
    return {
      blob: item.file,
      width: item.width,
      height: item.height,
      keptOriginal: true,
      strategy: `原图已低于 ${targetSizeKb} KB`,
    };
  }

  let quality = Math.max(1, Math.min(88, Math.round(settings.quality)));
  let scale = Math.max(.1, Math.min(100, settings.scale));
  let best: (CompressionResult & { quality: number; scale: number }) | null = null;

  // A bounded adaptive search avoids running a large fixed candidate ladder
  // for every image in a batch. It first spends quality, then reduces pixels
  // while restoring a sensible quality level. Every pass is measured using
  // the real encoder, so the result is not an estimate.
  for (let pass = 0; pass < 9; pass += 1) {
    const attemptSettings: CompressionSettings = {
      ...settings,
      targetSizeKb: 0,
      mode: "manual",
      quality,
      scale,
      preventLarger: false,
    };
    const result = await compressImageBase(item, attemptSettings, nativeBridge);
    if (!best || result.blob.size < best.blob.size) best = { ...result, quality, scale };
    if (result.blob.size <= targetBytes) {
      return {
        ...result,
        strategy: `≤ ${targetSizeKb} KB · ${quality}% · ${formatScale(scale)} 尺寸`,
      };
    }

    const ratio = targetBytes / Math.max(1, result.blob.size);
    if (pass < 3 && quality > 38) {
      const adaptiveQuality = Math.max(38, Math.floor(quality * Math.max(.58, Math.min(.86, ratio * 1.15))));
      quality = adaptiveQuality < quality ? adaptiveQuality : Math.max(38, quality - 8);
    } else {
      const reduction = Math.max(.42, Math.min(.86, Math.sqrt(ratio) * .96));
      const nextScale = Math.max(.1, Math.round(scale * reduction * 10) / 10);
      scale = nextScale < scale ? nextScale : Math.max(.1, Math.round((scale - .1) * 10) / 10);
      quality = Math.min(70, Math.max(46, quality + 14));
    }
  }

  if (!best) throw new Error("未生成可用的目标体积结果");
  return {
    blob: best.blob,
    width: best.width,
    height: best.height,
    strategy: `最接近 ${targetSizeKb} KB · ${best.quality}% · ${formatScale(best.scale)} 尺寸`,
  };
}

async function createDemoFile() {
  const canvas = document.createElement("canvas");
  canvas.width = 1800;
  canvas.height = 1125;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建演示图片");
  const gradient = context.createLinearGradient(0, 0, 1800, 1125);
  gradient.addColorStop(0, "#16271f");
  gradient.addColorStop(0.48, "#397865");
  gradient.addColorStop(1, "#d7ff72");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 1800, 1125);
  context.globalAlpha = 0.22;
  for (let index = 0; index < 18; index += 1) {
    context.beginPath();
    context.arc(180 + index * 110, 160 + (index % 4) * 230, 96 + (index % 3) * 26, 0, Math.PI * 2);
    context.fillStyle = index % 2 ? "#ffffff" : "#07140f";
    context.fill();
  }
  context.globalAlpha = 1;
  context.fillStyle = "#f5ffe0";
  context.font = "700 138px Arial";
  context.fillText("PicLite", 120, 860);
  context.fillStyle = "#132119";
  context.font = "600 46px Arial";
  context.fillText("清晰，轻一点。", 125, 945);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("无法生成演示图片");
  return new File([blob], "piclite-demo.png", { type: "image/png" });
}

function IconButton({ label, symbol, onClick, disabled }: { label: string; symbol: string; onClick?: () => void; disabled?: boolean }) {
  return <button className="icon-button" type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}><span aria-hidden="true">{symbol}</span></button>;
}

function fileNameFromPath(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

const SUPPORTED_IMAGE_PATH = /\.(?:jpe?g|jfif|png|webp|gif|avif|tiff?)$/i;

function supportedImagePaths(paths: string[]) {
  return [...new Set(paths.filter((path) => SUPPORTED_IMAGE_PATH.test(fileNameFromPath(path))))];
}

type BrowserPlatform = "generic" | "windows" | "macos" | "linux";

function detectBrowserPlatform(): BrowserPlatform {
  const agent = navigator.userAgent.toLowerCase();
  if (agent.includes("windows")) return "windows";
  if (agent.includes("macintosh") || agent.includes("mac os")) return "macos";
  if (agent.includes("linux")) return "linux";
  return "generic";
}

function browserDownloadLabel(language: "zh" | "en", platform: BrowserPlatform) {
  if (platform === "windows") return language === "en" ? "Download for Windows" : "下载 Windows 版";
  if (platform === "macos") return language === "en" ? "Download for macOS" : "下载 macOS 版";
  if (platform === "linux") return language === "en" ? "Download for Linux" : "下载 Linux 版";
  return language === "en" ? "Download desktop app" : "下载桌面版";
}

function TrayDropDock({ bridge }: { bridge: NativeBridge }) {
  const initialSettings = useMemo(loadStoredSettings, []);
  const initialPreferences = useMemo(loadStoredDesktopPreferences, []);
  const [quality, setQuality] = useState(initialSettings.quality);
  const [scale, setScale] = useState(initialSettings.scale);
  const [format, setFormat] = useState<OutputFormat>(initialSettings.format);
  const [dockTheme, setDockTheme] = useState<ThemeMode>(initialPreferences.dockTheme);
  const [colorTheme, setColorTheme] = useState<ColorTheme>(initialPreferences.colorTheme);
  const [dockLayout, setDockLayout] = useState<DockLayout>(initialPreferences.dockLayout);
  const [floatingResultSeconds, setFloatingResultSeconds] = useState(initialPreferences.floatingResultSeconds);
  const [clipboardWatcherEnabled, setClipboardWatcherEnabled] = useState(initialPreferences.clipboardWatcherEnabled);
  const [dockLanguage, setDockLanguage] = useState<"zh" | "en">(initialPreferences.language);
  const [dockToolsOpen, setDockToolsOpen] = useState(false);
  const [dockParametersOpen, setDockParametersOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [results, setResults] = useState<QuickCompressResult[]>([]);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState(initialPreferences.language === "en" ? "Reprocesses from the original every time" : "每次都从原图重算");
  const lastPathsRef = useRef<string[]>([]);
  const historyRef = useRef<Array<{ quality: number; scale: number; format: OutputFormat; results: QuickCompressResult[] }>>([]);
  const resultSettingsRef = useRef({ quality: initialSettings.quality, scale: initialSettings.scale, format: initialSettings.format });
  const autoHideTimerRef = useRef<number | null>(null);
  const previewUrlsRef = useRef<Record<string, string>>({});
  const clipboardBusyRef = useRef(false);
  const compressionRunRef = useRef(0);
  const dt = useCallback((zh: string, en: string) => dockLanguage === "en" ? en : zh, [dockLanguage]);

  useEffect(() => {
    document.documentElement.classList.add("dropzone-root");
    return () => {
      document.documentElement.classList.remove("dropzone-root");
      Object.values(previewUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
      if (autoHideTimerRef.current) window.clearTimeout(autoHideTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    void bridge.loadAppProfile().then((profile) => {
      if (disposed || !profile?.settings) return;
      setQuality(profile.settings.quality);
      setScale(profile.settings.scale);
      setFormat(profile.settings.format);
      if (profile.desktopPreferences) {
        const preferences = { ...DEFAULT_DESKTOP_PREFERENCES, ...profile.desktopPreferences };
        setDockTheme(preferences.dockTheme);
        setColorTheme(preferences.colorTheme);
        setDockLayout(preferences.dockLayout === "full" ? "full" : "compact");
        setFloatingResultSeconds(preferences.floatingResultSeconds);
        setClipboardWatcherEnabled(preferences.clipboardWatcherEnabled);
        setDockLanguage(preferences.language === "en" ? "en" : "zh");
      }
    }).catch(() => undefined);
    return () => { disposed = true; };
  }, [bridge]);

  const saveDockResults = useCallback(async (next: QuickCompressResult[]) => {
    const completed = next.filter((result) => result.output && !result.error);
    if (!completed.length) return;
    try {
      const images = await bridge.readImagesFromPaths(completed.map((result) => result.output!));
      const nextPreviews: Record<string, string> = {};
      for (const image of images) {
        const result = completed.find((candidate) => candidate.output === image.path);
        const blob = new Blob([new Uint8Array(image.data)], { type: image.type || mimeFromName(image.name) });
        if (result) nextPreviews[result.source] = URL.createObjectURL(blob);
        const dimensions = await getDimensions(new File([blob], image.name, { type: blob.type }));
        await galleryPut({
          id: `dock:${result?.source || image.path}`,
          name: image.name,
          createdAt: Date.now(),
          originalBytes: result?.originalBytes || blob.size,
          outputBytes: result?.outputBytes || blob.size,
          width: dimensions.width,
          height: dimensions.height,
          mimeType: blob.type,
          blob,
          sourcePath: result?.source,
          outputPath: image.path,
        });
      }
      Object.values(previewUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
      previewUrlsRef.current = nextPreviews;
      setPreviewUrls(nextPreviews);
    } catch { /* 图库失败不影响快速压缩 */ }
  }, [bridge]);

  const runCompression = useCallback(async (paths: string[], nextQuality = quality, nextScale = scale, nextFormat = format, remember = true) => {
    const imagePaths = supportedImagePaths(paths);
    if (!imagePaths.length) {
      setIsDragging(false);
      setNotice(dt("只支持 JPG、PNG、WebP、GIF、AVIF 和 TIFF 图片", "Only JPG, PNG, WebP, GIF, AVIF and TIFF images are supported"));
      return;
    }
    const runId = ++compressionRunRef.current;
    if (remember && results.length) {
      historyRef.current.push({ ...resultSettingsRef.current, results });
      historyRef.current = historyRef.current.slice(-12);
    }
    lastPathsRef.current = imagePaths;
    setIsProcessing(true);
    setNotice(dt("正在从原图重新计算…", "Reprocessing from the original…"));
    Object.values(previewUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
    previewUrlsRef.current = {};
    setPreviewUrls({});
    setResults(imagePaths.map((source) => ({ source, keptOriginal: false })));
    try {
      let preferences = DEFAULT_DESKTOP_PREFERENCES;
      try {
        const stored = window.localStorage.getItem("piclite.desktopPreferences.v1");
        if (stored) preferences = { ...preferences, ...JSON.parse(stored) };
      } catch { /* 使用安全默认值 */ }
      const next = await bridge.quickCompressPaths(imagePaths, {
        quality: nextQuality,
        scale: nextScale,
        format: nextFormat,
        stripMetadata: initialSettings.stripMetadata,
        preventLarger: preferences.preventLarger,
        exportMode: preferences.exportMode === "overwrite" ? "same-folder" : preferences.exportMode,
        exportSuffix: preferences.exportSuffix,
        renameTemplate: preferences.renameTemplate,
        fixedFolder: preferences.exportFolder || undefined,
      });
      if (runId !== compressionRunRef.current) return;
      setResults(next);
      resultSettingsRef.current = { quality: nextQuality, scale: nextScale, format: nextFormat };
      setNotice(dt(`已按 ${nextQuality}% 画质 · ${formatScale(nextScale)} 尺寸 · ${nextFormat === "keep" ? "原格式" : nextFormat.split("/")[1].toUpperCase()} 生成`, `Generated at ${nextQuality}% quality · ${formatScale(nextScale)} scale · ${nextFormat === "keep" ? "original format" : nextFormat.split("/")[1].toUpperCase()}`));
      void saveDockResults(next);
    } catch (error) {
      if (runId === compressionRunRef.current) setResults(imagePaths.map((source) => ({ source, keptOriginal: false, error: error instanceof Error ? error.message : dt("压缩失败", "Optimisation failed") })));
    } finally {
      if (runId === compressionRunRef.current) setIsProcessing(false);
    }
  }, [bridge, dt, format, initialSettings.stripMetadata, quality, results, saveDockResults, scale]);

  const clearAutoHide = useCallback(() => {
    if (autoHideTimerRef.current) window.clearTimeout(autoHideTimerRef.current);
    autoHideTimerRef.current = null;
  }, []);

  const scheduleAutoHide = useCallback(() => {
    clearAutoHide();
    if (!floatingResultSeconds || isProcessing || !results.some((result) => result.output || result.error)) return;
    autoHideTimerRef.current = window.setTimeout(() => {
      void bridge.hideCurrentWindow();
    }, floatingResultSeconds * 1000);
  }, [bridge, clearAutoHide, floatingResultSeconds, isProcessing, results]);

  useEffect(() => {
    // Keep the result card sized to its real content.  A tall window made the
    // controls appear detached from the result, especially at 125–150% DPI.
    const width = results.length ? (dockLayout === "full" ? 378 : 308) : 290;
    const height = results.length
      ? (dockLayout === "full" ? 326 : 273) + (dockToolsOpen ? 48 : 0) + (dockParametersOpen ? 95 : 0)
      : 202;
    void bridge.configureDropzoneWindow(width, height);
  }, [bridge, dockLayout, dockParametersOpen, dockToolsOpen, results.length]);

  useEffect(() => {
    scheduleAutoHide();
    return clearAutoHide;
  }, [clearAutoHide, scheduleAutoHide]);

  const chooseDockImages = useCallback(async () => {
    clearAutoHide();
    try {
      const images = await bridge.selectImages();
      if (images.length) await runCompression(images.map((image) => image.path));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : dt("选择图片失败", "Could not choose images"));
    }
  }, [bridge, clearAutoHide, dt, runCompression]);

  useEffect(() => bridge.onFileDrop((event) => {
    if (event.type === "error") {
      setResults([{ source: dt("悬浮压缩坞", "Floating result"), keptOriginal: false, error: event.error || dt("文件拖放监听不可用", "File-drop listener is unavailable") }]);
      return;
    }
    setIsDragging(event.type === "over");
    if (event.type === "drop" && event.paths?.length) void runCompression(event.paths);
  }), [bridge, dt, runCompression]);

  useEffect(() => {
    let disposed = false;
    const consumePendingDrop = async () => {
      const paths = await bridge.takePendingCornerDrop().catch(() => [] as string[]);
      if (!disposed && paths.length) await runCompression(paths);
    };
    // Covers a drop that opened this webview before its listener was ready.
    void consumePendingDrop();
    const stop = bridge.onCornerDrop(() => void consumePendingDrop());
    return () => {
      disposed = true;
      stop();
    };
  }, [bridge, runCompression]);

  useEffect(() => bridge.onWatcherEvent((event) => {
    if (event.type !== "success" || !event.output || !event.file) return;
    const next: QuickCompressResult = {
      source: event.file,
      output: event.output,
      originalBytes: event.originalBytes,
      outputBytes: event.outputBytes,
      keptOriginal: event.originalBytes === event.outputBytes,
    };
    lastPathsRef.current = [event.file];
    setResults([next]);
    setNotice(dt("文件夹监控已完成压缩", "Folder-watch optimisation complete"));
    void saveDockResults([next]);
  }), [bridge, dt, saveDockResults]);

  const compressClipboardImage = useCallback(async (data: Uint8Array) => {
    if (clipboardBusyRef.current || isProcessing) return;
    clipboardBusyRef.current = true;
    setIsProcessing(true);
    setNotice(dt("检测到剪贴板图片，正在自动压缩…", "Clipboard image detected; optimising…"));
    try {
      const file = new File([new Uint8Array(data)], `clipboard-${Date.now()}.png`, { type: "image/png" });
      const dimensions = await getDimensions(file);
      const item: ImageItem = {
        id: uid(),
        file,
        name: file.name,
        type: file.type,
        width: dimensions.width,
        height: dimensions.height,
        originalBytes: file.size,
        sourceUrl: "",
        status: "ready",
      };
      const current = loadStoredSettings();
      const preferences = loadStoredDesktopPreferences();
      const compression = await compressImage(item, {
        ...current,
        quality,
        scale,
        format,
        preventLarger: preferences.preventLarger,
      }, bridge);
      const extension = outputExtension(compression.blob.type || file.type, file.name);
      const fileName = `clipboard${cleanSuffix(preferences.exportSuffix)}.${extension}`;
      const output = await bridge.copyCompressedData(new Uint8Array(await compression.blob.arrayBuffer()), fileName);
      const next: QuickCompressResult = {
        source: file.name,
        output,
        originalBytes: file.size,
        outputBytes: compression.blob.size,
        keptOriginal: Boolean(compression.keptOriginal),
      };
      lastPathsRef.current = [];
      setResults([next]);
      resultSettingsRef.current = { quality, scale, format };
      setNotice(dt(`剪贴板图片已自动压缩并复制 · ${formatBytes(file.size)} → ${formatBytes(compression.blob.size)}`, `Clipboard image optimised and copied · ${formatBytes(file.size)} → ${formatBytes(compression.blob.size)}`));
      void saveDockResults([next]);
      await bridge.showDropzoneWindow();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : dt("剪贴板自动压缩失败", "Clipboard optimisation failed"));
    } finally {
      clipboardBusyRef.current = false;
      setIsProcessing(false);
    }
  }, [bridge, dt, format, isProcessing, quality, saveDockResults, scale]);

  useEffect(() => bridge.onClipboardImage((data) => {
    if (clipboardWatcherEnabled) void compressClipboardImage(data);
  }), [bridge, clipboardWatcherEnabled, compressClipboardImage]);

  useEffect(() => bridge.onClipboardPaths((paths) => {
    if (!clipboardWatcherEnabled || !paths.length || clipboardBusyRef.current || isProcessing) return;
    clipboardBusyRef.current = true;
    setNotice(dt(`检测到剪贴板中的 ${paths.length} 张图片，正在自动压缩…`, `${paths.length} clipboard images detected; optimising…`));
    void runCompression(paths).finally(() => {
      clipboardBusyRef.current = false;
      void bridge.showDropzoneWindow();
    });
  }), [bridge, clipboardWatcherEnabled, dt, isProcessing, runCompression]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyDockTheme = () => {
      document.documentElement.dataset.theme = resolveTheme(dockTheme);
      document.documentElement.dataset.palette = colorTheme;
      document.documentElement.style.colorScheme = resolveTheme(dockTheme);
    };
    applyDockTheme();
    document.documentElement.dataset.density = "comfortable";
    media.addEventListener("change", applyDockTheme);
    return () => media.removeEventListener("change", applyDockTheme);
  }, [colorTheme, dockTheme]);

  useEffect(() => {
    const syncPreferences = (event: StorageEvent) => {
      if (event.key === "piclite.desktopPreferences.v1") {
        const preferences = loadStoredDesktopPreferences();
        setDockTheme(preferences.dockTheme);
        setColorTheme(preferences.colorTheme);
        setDockLayout(preferences.dockLayout);
        setFloatingResultSeconds(preferences.floatingResultSeconds);
        setClipboardWatcherEnabled(preferences.clipboardWatcherEnabled);
        setDockLanguage(preferences.language === "en" ? "en" : "zh");
      }
      if (event.key === "piclite.compressionSettings.v2") {
        const current = loadStoredSettings();
        setQuality(current.quality);
        setScale(current.scale);
        setFormat(current.format);
      }
    };
    window.addEventListener("storage", syncPreferences);
    return () => window.removeEventListener("storage", syncPreferences);
  }, []);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("piclite.compressionSettings.v2");
      const current = saved ? JSON.parse(saved) as Partial<CompressionSettings> : {};
      window.localStorage.setItem("piclite.compressionSettings.v2", JSON.stringify({ ...DEFAULT_SETTINGS, ...current, quality, scale, format, watermark: { ...DEFAULT_SETTINGS.watermark, ...current.watermark } }));
    } catch { /* 本次悬浮窗仍可继续使用 */ }
  }, [format, quality, scale]);

  const toggleDockTheme = useCallback(() => {
    const next = resolveTheme(dockTheme) === "dark" ? "light" : "dark";
    setDockTheme(next);
    try {
      const preferences = loadStoredDesktopPreferences();
      window.localStorage.setItem("piclite.desktopPreferences.v1", JSON.stringify({ ...preferences, dockTheme: next }));
    } catch { /* 主题至少对当前窗口立即生效 */ }
  }, [dockTheme]);

  const undoCompression = useCallback(() => {
    const previous = historyRef.current.pop();
    if (!previous) return;
    setQuality(previous.quality);
    setScale(previous.scale);
    setFormat(previous.format);
    setResults(previous.results);
    resultSettingsRef.current = { quality: previous.quality, scale: previous.scale, format: previous.format };
    setNotice(dt("已撤回到上一次结果", "Restored the previous result"));
  }, [dt]);

  const copyLatestResult = useCallback(async () => {
    const result = results.find((candidate) => candidate.output && !candidate.error);
    if (!result?.output) return;
    try {
      await bridge.copyImagePath(result.output);
      setNotice(dt("结果图已复制，可直接粘贴", "Result copied and ready to paste"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : dt("复制失败", "Copy failed"));
    }
  }, [bridge, dt, results]);

  const startDockDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    void bridge.startDragging();
  }, [bridge]);

  const startDockResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    void bridge.startResizeDragging("SouthEast");
  }, [bridge]);

  const latestOutput = results.find((result) => result.output && !result.error)?.output;
  const primaryResult = results[0];
  const reprocessDock = useCallback((nextQuality = quality, nextScale = scale, nextFormat = format) => {
    if (lastPathsRef.current.length) void runCompression(lastPathsRef.current, nextQuality, nextScale, nextFormat);
  }, [format, quality, runCompression, scale]);

  return (
    <main className={`drop-dock clop-dock layout-${dockLayout} ${results.length ? "has-results" : "is-idle"} ${isDragging ? "dragging" : ""}`} onPointerEnter={clearAutoHide} onPointerLeave={scheduleAutoHide}>
      <header onPointerDown={startDockDrag}>
        <span className="dock-brand"><i>✦</i><b>{results.length ? dt("压缩结果", "Result") : "PicLite"}</b></span>
        <span className="dock-actions" onPointerDown={(event) => event.stopPropagation()}>
          <button type="button" title={dt("切换明暗主题", "Toggle appearance")} onClick={toggleDockTheme}>{resolveTheme(dockTheme) === "dark" ? "☀" : "☾"}</button>
          <button type="button" title={dt("打开主窗口", "Open main window")} onClick={() => void bridge.showMainWindow()}>↗</button>
          <button type="button" title={dt("隐藏悬浮结果", "Hide floating result")} onClick={() => void bridge.hideCurrentWindow()}>×</button>
        </span>
      </header>
      <section className="dock-body">
        {!results.length ? (
          <button className="dock-empty clop-drop-zone" type="button" onClick={() => void chooseDockImages()} title={dt("点击选图，也可从系统拖入", "Click to choose, or drop files here")}>
            <strong>{isDragging ? dt("松开即可优化", "Drop to optimise") : dt("拖到这里优化", "Drop to optimise")}</strong>
            <span className="drop-target-glyph"><i /><b>◎</b></span>
            <small>{dt("也可以点击选择图片", "or click to choose images")}</small>
          </button>
        ) : (
          <div className={`dock-result-stack ${dockToolsOpen ? "tools-open" : ""}`}>
            <article className={`dock-result-card ${primaryResult?.error ? "error" : primaryResult?.output ? "done" : "working"}`}>
              {primaryResult && previewUrls[primaryResult.source] ? <img src={previewUrls[primaryResult.source]} alt="" /> : <div className="dock-result-placeholder">{primaryResult?.error ? "!" : "···"}</div>}
              <div className="dock-result-top-actions">
                <button type="button" title={dt("清除此结果", "Dismiss result")} onClick={() => { setResults([]); setDockToolsOpen(false); setDockParametersOpen(false); }}>×</button>
                <button type="button" title={dt("更多操作", "More actions")} onClick={() => setDockToolsOpen((open) => !open)}>•••</button>
              </div>
              {isProcessing && <div className="dock-progress"><span>{dt("正在优化", "Optimising")}</span><i /></div>}
              <div className="dock-result-caption">
                <strong title={primaryResult?.source}>{fileNameFromPath(primaryResult?.source || dt("图片", "Image"))}</strong>
                <span>{primaryResult?.error || (primaryResult?.outputBytes ? <><b>{formatBytes(primaryResult.originalBytes)}</b><i>→</i><em>{formatBytes(primaryResult.outputBytes)}</em></> : dt("正在读取图片…", "Reading image…"))}</span>
                {primaryResult?.originalBytes && primaryResult?.outputBytes ? <small>{sizeChangeLabel(primaryResult.originalBytes, primaryResult.outputBytes)}</small> : null}
              </div>
              <nav className="dock-format-tabs" aria-label={dt("输出格式", "Output format")}>
                {([['keep', 'AUTO'], ['image/jpeg', 'JPEG'], ['image/webp', 'WEBP'], ['image/png', 'PNG']] as const).map(([value, label]) => <button type="button" key={value} className={format === value ? "active" : ""} disabled={isProcessing} onClick={() => { setFormat(value); reprocessDock(quality, scale, value); }}>{label}</button>)}
              </nav>
            </article>
            {results.length > 1 && <div className="dock-result-count">+{results.length - 1} {dt("张图片", "more images")}</div>}
            {dockToolsOpen && <div className="dock-action-panel">
              <button type="button" title={dt("减少尺寸", "Downscale")} onClick={() => { const next = Math.max(.1, scale / 2); setScale(next); reprocessDock(quality, next, format); }}>−</button>
              <button type="button" title={dt("撤销上次重压", "Undo last recompression")} disabled={!historyRef.current.length} onClick={undoCompression}>↶</button>
              <button type="button" className={dockParametersOpen ? "active" : ""} title={dt("调整参数", "Adjust parameters")} onClick={() => setDockParametersOpen((open) => !open)}>☷</button>
              <button type="button" title={dt("复制结果图", "Copy result")} disabled={!latestOutput} onClick={() => void copyLatestResult()}>⧉</button>
              <button type="button" title={dt("在文件夹中显示", "Reveal in folder")} disabled={!latestOutput} onClick={() => latestOutput && void bridge.revealPath(latestOutput)}>⌑</button>
              <button type="button" title={dt("打开图库", "Open library")} onClick={() => void bridge.showGalleryWindow()}>▦</button>
            </div>}
            {dockParametersOpen && <div className="dock-parameter-panel">
              <label><span>{dt("画质", "Quality")}</span><input type="range" min="1" max="100" value={quality} onInput={(event) => setQuality(Number(event.currentTarget.value))} onPointerUp={(event) => reprocessDock(Number(event.currentTarget.value), scale, format)} /><b>{quality}%</b></label>
              <label><span>{dt("尺寸", "Scale")}</span><input type="range" min="0.1" max="100" step="0.1" value={scale} onInput={(event) => setScale(Number(event.currentTarget.value))} onPointerUp={(event) => reprocessDock(quality, Number(event.currentTarget.value), format)} /><b>{formatScale(scale)}</b></label>
              <button type="button" disabled={isProcessing || !lastPathsRef.current.length} onClick={() => void runCompression(lastPathsRef.current, quality, scale, format)}>{dt("按当前参数重新优化", "Re-optimise with these settings")}</button>
            </div>}
          </div>
        )}
      </section>
      <footer onPointerDown={(event) => event.stopPropagation()}>
        <span className="dock-status" title={notice}>{isProcessing ? dt("正在优化…", "Optimising…") : notice}</span>
        <button className="dock-add-more" type="button" title={dt("添加图片", "Add images")} onClick={() => void chooseDockImages()}>＋</button>
      </footer>
      <button className="dock-resize-handle" type="button" aria-label={dt("调整悬浮窗大小", "Resize floating result")} title={dt("拖动调整大小", "Drag to resize")} onPointerDown={startDockResize}><i /><i /><i /></button>
    </main>
  );
}

function CornerDropTarget({ bridge }: { bridge: NativeBridge }) {
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add("dropzone-root");
    return () => document.documentElement.classList.remove("dropzone-root");
  }, []);

  useEffect(() => bridge.onFileDrop((event) => {
    if (event.type === "over") setDragging(true);
    if (event.type === "leave") setDragging(false);
    if (event.type === "drop") {
      setDragging(false);
      if (event.paths?.length) void bridge.submitCornerDrop(event.paths);
    }
  }), [bridge]);

  return <button
    className={`corner-drop-target ${dragging ? "dragging" : ""}`}
    type="button"
    aria-label="Drop images here to optimise / 将图片拖到这里压缩"
    title="Drop images to optimise / 拖入图片即可压缩"
    onClick={() => void bridge.showDropzoneWindow()}
  ><span><b>{dragging ? "◎" : "＋"}</b>{dragging && <em>Drop to optimise</em>}</span></button>;
}

export function PicLiteApp() {
  const bridge = typeof window !== "undefined" ? window.picLite : undefined;
  if (bridge?.windowLabel === "dropzone") return <TrayDropDock bridge={bridge} />;
  if (bridge?.windowLabel === "corner-drop-target") return <CornerDropTarget bridge={bridge} />;
  return <PicLiteWorkbench nativeBridge={bridge} initialView={bridge?.windowLabel === "preferences" ? "preferences" : "workspace"} standalonePreferences={bridge?.windowLabel === "preferences"} />;
}

function PicLiteWorkbench({ nativeBridge, initialView = "workspace", standalonePreferences = false }: { nativeBridge?: NativeBridge; initialView?: ViewName; standalonePreferences?: boolean }) {
  const [view, setView] = useState<ViewName>(initialView);
  const [items, setItems] = useState<ImageItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settings, setSettings] = useState<CompressionSettings>(loadStoredSettings);
  const [presets, setPresets] = useState<SavedPreset[]>(loadStoredPresets);
  const [activePresetId, setActivePresetId] = useState(() => typeof window === "undefined" ? "current" : window.localStorage.getItem("piclite.activePreset.v1") || "current");
  const [presetDialogOpen, setPresetDialogOpen] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [pendingTrayAction, setPendingTrayAction] = useState<string | null>(null);
  const [compare, setCompare] = useState(52);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("compare");
  const [previewZoom, setPreviewZoom] = useState(100);
  const [previewFit, setPreviewFit] = useState(true);
  const [previewPan, setPreviewPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [processingAll, setProcessingAll] = useState(false);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [desktopPreferences, setDesktopPreferences] = useState<DesktopPreferences>(loadStoredDesktopPreferences);
  const autoUpdateCheckStartedRef = useRef(false);
  const [recordingShortcut, setRecordingShortcut] = useState<ShortcutPreferenceKey | null>(null);
  const [preferenceSection, setPreferenceSection] = useState<PreferenceSection>("general");
  const [workspacePlugins, setWorkspacePlugins] = useState<WorkspacePlugin[]>(loadWorkspacePlugins);
  const [pluginName, setPluginName] = useState("");
  const [pluginUrl, setPluginUrl] = useState("https://banner.xmit.dev/");
  const [exportMode, setExportMode] = useState<ExportMode>(() => typeof window !== "undefined" && window.picLite ? loadStoredDesktopPreferences().exportMode : "download");
  const [exportSuffix, setExportSuffix] = useState(() => loadStoredDesktopPreferences().exportSuffix);
  const [exportFolderName, setExportFolderName] = useState(() => loadStoredDesktopPreferences().exportFolder);
  const [localFonts, setLocalFonts] = useState<string[]>(["Microsoft YaHei", "PingFang SC", "Arial", "SimSun"]);
  const [toast, setToast] = useState<string | null>(null);
  const [watcherSettings, setWatcherSettings] = useState<WatcherSettings>(() => {
    if (typeof window === "undefined") return DEFAULT_WATCHER_SETTINGS;
    try {
      const firstProfile = loadDesktopSettings().watchProfiles[0];
      if (firstProfile) return { ...DEFAULT_WATCHER_SETTINGS, ...firstProfile };
      const saved = window.localStorage.getItem("piclite.watcherSettings.v1");
      return saved ? { ...DEFAULT_WATCHER_SETTINGS, ...JSON.parse(saved) } : DEFAULT_WATCHER_SETTINGS;
    } catch {
      return DEFAULT_WATCHER_SETTINGS;
    }
  });
  const [watchProfiles, setWatchProfiles] = useState<WatchProfile[]>(() => typeof window === "undefined" ? [] : loadDesktopSettings().watchProfiles as WatchProfile[]);
  const [selectedWatchProfileId, setSelectedWatchProfileId] = useState<string | null>(() => typeof window === "undefined" ? null : (loadDesktopSettings().watchProfiles[0]?.id || null));
  const [watcherActive, setWatcherActive] = useState(false);
  const [watcherEvents, setWatcherEvents] = useState<WatcherEvent[]>([]);
  const [galleryItems, setGalleryItems] = useState<GalleryViewItem[]>([]);
  const [galleryRevision, setGalleryRevision] = useState(0);
  const [gallerySelectedId, setGallerySelectedId] = useState<string | null>(null);
  const [galleryPreviewId, setGalleryPreviewId] = useState<string | null>(null);
  const [galleryCheckedIds, setGalleryCheckedIds] = useState<string[]>([]);
  const [galleryDeleteScope, setGalleryDeleteScope] = useState<"selected" | "day" | "week" | "month" | "all">("selected");
  const [uploadSettings, setUploadSettings] = useState<UploadSettings>(loadUploadSettings);
  const [uploadSecret, setUploadSecret] = useState("");
  const [uploadProfileSaved, setUploadProfileSaved] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [downloadGuideVisible, setDownloadGuideVisible] = useState(true);
  const [browserPlatform, setBrowserPlatform] = useState<BrowserPlatform>("generic");
  const [nativeProfileReady, setNativeProfileReady] = useState(() => !nativeBridge);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const fontInputRef = useRef<HTMLInputElement>(null);
  const pluginInputRef = useRef<HTMLInputElement>(null);
  const exportDirectoryRef = useRef<DirectoryHandleLike | null>(null);
  const compareRef = useRef<HTMLDivElement>(null);
  const previewDragRef = useRef<{ pointerId: number; x: number; y: number; panX: number; panY: number } | null>(null);
  const itemsRef = useRef<ImageItem[]>([]);
  const settingsReadyRef = useRef(false);
  const desktopPreferencesReadyRef = useRef(false);
  const livePreviewGenerationRef = useRef(0);
  const galleryUrlsRef = useRef<string[]>([]);
  const savedUploadProfileRef = useRef<string | null>(null);
  const loadedSystemFontsRef = useRef<Set<string>>(new Set());
  const systemFontFilesRef = useRef<Map<string, SystemFontInfo>>(new Map());
  const hydratedWatermarkFontRef = useRef<string | null>(null);
  const importedFontsHydratedRef = useRef(false);
  useEffect(() => {
    try { window.localStorage.setItem("piclite.workspacePlugins.v1", JSON.stringify(workspacePlugins)); window.dispatchEvent(new Event("piclite:plugins-changed")); }
    catch (error) { console.warn("Could not persist PicLite plugins", error); }
  }, [workspacePlugins]);
  useEffect(() => {
    const syncPlugins = (event: StorageEvent) => {
      if (event.key === "piclite.workspacePlugins.v1") setWorkspacePlugins(loadWorkspacePlugins());
    };
    window.addEventListener("storage", syncPlugins);
    return () => window.removeEventListener("storage", syncPlugins);
  }, []);
  useEffect(() => {
    const builtin = workspacePlugins.find((plugin) => plugin.id === view);
    if (builtin && !builtin.enabled) setView("workspace");
    if (view.startsWith("plugin:") && !workspacePlugins.some((plugin) => `plugin:${plugin.id}` === view && plugin.enabled)) setView("workspace");
  }, [view, workspacePlugins]);
  const desktopPlatform = nativeBridge
    ? ({ win32: "Windows", darwin: "macOS", linux: "Linux" }[nativeBridge.platform] || "Desktop")
    : "Desktop";
  const t = useCallback((zh: string, en: string) => desktopPreferences.language === "en" ? en : zh, [desktopPreferences.language]);
  const toggleHeaderTheme = useCallback(() => {
    setDesktopPreferences((current) => ({ ...current, theme: resolveTheme(current.theme) === "dark" ? "light" : "dark" }));
  }, []);
  const toggleHeaderLanguage = useCallback(() => {
    setDesktopPreferences((current) => ({ ...current, language: current.language === "zh" ? "en" : "zh" }));
  }, []);

  useEffect(() => {
    document.documentElement.lang = desktopPreferences.language === "en" ? "en" : "zh-CN";
  }, [desktopPreferences.language]);

  useEffect(() => {
    if (!nativeBridge) return;
    document.documentElement.classList.add("desktop-root");
    return () => document.documentElement.classList.remove("desktop-root");
  }, [nativeBridge]);

  useEffect(() => {
    if (!nativeBridge && window.localStorage.getItem("piclite.desktopDownloadGuide.dismissed") === "1") {
      setDownloadGuideVisible(false);
    }
  }, [nativeBridge]);

  useEffect(() => {
    if (!nativeBridge) setBrowserPlatform(detectBrowserPlatform());
  }, [nativeBridge]);

  useEffect(() => {
    if (!nativeBridge) return;
    let disposed = false;
    setNativeProfileReady(false);
    void nativeBridge.loadAppProfile()
      .then((profile) => {
        if (disposed || !profile) return;
        const nextSettings = profile.settings && typeof profile.settings === "object"
          ? { ...DEFAULT_SETTINGS, ...profile.settings, watermark: { ...DEFAULT_SETTINGS.watermark, ...profile.settings.watermark } }
          : null;
        if (nextSettings) setSettings(nextSettings);
        if (Array.isArray(profile.customPresets)) setPresets([...BUILT_IN_PRESETS, ...profile.customPresets.filter((preset) => preset?.custom && preset.settings)]);
        if (typeof profile.activePresetId === "string") setActivePresetId(profile.activePresetId);
        if (Array.isArray(profile.localFonts)) setLocalFonts((current) => Array.from(new Set([...current, ...profile.localFonts.filter((font) => typeof font === "string" && font.trim())])));
        if (profile.desktopPreferences && typeof profile.desktopPreferences === "object") setDesktopPreferences({ ...DEFAULT_DESKTOP_PREFERENCES, ...profile.desktopPreferences, dockLayout: profile.desktopPreferences.dockLayout === "full" ? "full" : "compact", language: profile.desktopPreferences.language === "en" ? "en" : "zh" });
      })
      .catch(() => undefined)
      .finally(() => { if (!disposed) setNativeProfileReady(true); });
    return () => { disposed = true; };
  }, [nativeBridge]);

  useEffect(() => {
    if (!nativeBridge) return;
    const syncDesktopPreferences = (event: StorageEvent) => {
      if (event.key === "piclite.desktopPreferences.v1") setDesktopPreferences(loadStoredDesktopPreferences());
    };
    window.addEventListener("storage", syncDesktopPreferences);
    return () => window.removeEventListener("storage", syncDesktopPreferences);
  }, [nativeBridge]);

  const selected = useMemo(() => items.find((item) => item.id === selectedId) || items[0] || null, [items, selectedId]);
  const selectedTarget = useMemo(() => selected ? getTargetDimensions(selected, settings) : null, [selected, settings]);
  const galleryPreview = useMemo(() => galleryItems.find((item) => item.id === galleryPreviewId) || null, [galleryItems, galleryPreviewId]);
  const totals = useMemo(() => {
    const original = items.reduce((sum, item) => sum + item.originalBytes, 0);
    const output = items.reduce((sum, item) => sum + (item.outputBytes ?? item.originalBytes), 0);
    return { original, output, saved: savedPercent(original, output) };
  }, [items]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  const checkForUpdates = useCallback(async (manual = false) => {
    if (!nativeBridge) return;
    setCheckingUpdate(true);
    try {
      const next = await nativeBridge.checkForUpdates();
      window.localStorage.setItem(LAST_UPDATE_CHECK_KEY, String(Date.now()));
      setUpdateInfo(next);
      if (next.available) showToast(t(`发现 PicLite ${next.latestVersion}，可以更新了`, `PicLite ${next.latestVersion} is available`));
      else if (manual) showToast(t(`当前 ${APP_VERSION} 已是最新版`, `PicLite ${APP_VERSION} is up to date`));
    } catch (error) {
      if (manual) showToast(error instanceof Error ? error.message : t("暂时无法检查更新", "Could not check for updates"));
    } finally {
      setCheckingUpdate(false);
    }
  }, [nativeBridge, showToast, t]);

  const openReleasePage = useCallback((url = updateInfo?.releaseUrl || GITHUB_RELEASES_URL) => {
    if (nativeBridge) void nativeBridge.openExternal(url).catch(() => showToast(t("无法打开下载页面", "Could not open the download page")));
    else window.open(url, "_blank", "noopener,noreferrer");
  }, [nativeBridge, showToast, t, updateInfo?.releaseUrl]);

  const dismissDownloadGuide = useCallback(() => {
    setDownloadGuideVisible(false);
    window.localStorage.setItem("piclite.desktopDownloadGuide.dismissed", "1");
  }, []);

  useEffect(() => {
    if (!nativeBridge || autoUpdateCheckStartedRef.current) return;
    const frequency = desktopPreferences.updateCheckFrequency;
    if (frequency === "never") return;
    const lastChecked = Number(window.localStorage.getItem(LAST_UPDATE_CHECK_KEY) || 0);
    const elapsed = Date.now() - lastChecked;
    const due = frequency === "startup"
      || (frequency === "daily" && elapsed >= 24 * 60 * 60 * 1000)
      || (frequency === "weekly" && elapsed >= 7 * 24 * 60 * 60 * 1000);
    if (!due) return;
    autoUpdateCheckStartedRef.current = true;
    const timer = window.setTimeout(() => void checkForUpdates(false), 1400);
    return () => window.clearTimeout(timer);
  }, [checkForUpdates, desktopPreferences.updateCheckFrequency, nativeBridge]);

  const refreshGallery = useCallback(async () => {
    try {
      const records = await galleryList();
      galleryUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      const next = records.map((record) => ({ ...record, previewUrl: URL.createObjectURL(record.blob) }));
      galleryUrlsRef.current = next.map((record) => record.previewUrl);
      setGalleryItems(next);
    } catch {
      showToast(t("图库读取失败", "Could not open the library"));
    }
  }, [showToast, t]);

  useEffect(() => {
    if (view === "gallery") void refreshGallery();
  }, [galleryRevision, refreshGallery, view]);

  useEffect(() => {
    if (!galleryItems.length) {
      setGallerySelectedId(null);
      setGalleryPreviewId(null);
      setGalleryCheckedIds([]);
      return;
    }
    setGalleryCheckedIds((current) => current.filter((id) => galleryItems.some((item) => item.id === id)));
    if (!gallerySelectedId || !galleryItems.some((item) => item.id === gallerySelectedId)) setGallerySelectedId(galleryItems[0].id);
    if (galleryPreviewId && !galleryItems.some((item) => item.id === galleryPreviewId)) setGalleryPreviewId(null);
  }, [galleryItems, galleryPreviewId, gallerySelectedId]);

  useEffect(() => {
    const onGalleryShortcut = (event: globalThis.KeyboardEvent) => {
      if (view !== "gallery") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      const index = galleryItems.findIndex((item) => item.id === (galleryPreviewId || gallerySelectedId));
      if (event.key === " ") {
        if (!galleryPreviewId && gallerySelectedId) {
          event.preventDefault();
          setGalleryPreviewId(gallerySelectedId);
        }
        return;
      }
      if (event.key === "Escape" && galleryPreviewId) {
        event.preventDefault();
        setGalleryPreviewId(null);
        return;
      }
      if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && galleryItems.length) {
        event.preventDefault();
        const offset = event.key === "ArrowLeft" ? -1 : 1;
        const next = galleryItems[(Math.max(0, index) + offset + galleryItems.length) % galleryItems.length];
        setGallerySelectedId(next.id);
        if (galleryPreviewId) setGalleryPreviewId(next.id);
      }
    };
    window.addEventListener("keydown", onGalleryShortcut);
    return () => window.removeEventListener("keydown", onGalleryShortcut);
  }, [galleryItems, galleryPreviewId, gallerySelectedId, view]);

  useEffect(() => () => galleryUrlsRef.current.forEach((url) => URL.revokeObjectURL(url)), []);

  useEffect(() => {
    try {
      window.localStorage.setItem("piclite.uploadSettings.v1", JSON.stringify(uploadSettings));
    } catch { /* 非敏感上传配置仅用于本机偏好 */ }
  }, [uploadSettings]);

  useEffect(() => {
    if (!nativeBridge) return;
    void nativeBridge.loadUploadProfile()
      .then((profile) => {
        if (!profile) return;
        const { secret, ...storedSettings } = profile;
        savedUploadProfileRef.current = JSON.stringify({ ...DEFAULT_UPLOAD_SETTINGS, ...storedSettings, secret });
        setUploadSettings({ ...DEFAULT_UPLOAD_SETTINGS, ...storedSettings });
        setUploadSecret(secret);
        setUploadProfileSaved(true);
      })
      .catch(() => showToast(t("本机上传配置读取失败", "Could not load local hosting settings")));
  }, [nativeBridge, showToast, t]);

  useEffect(() => {
    if (!savedUploadProfileRef.current) return;
    setUploadProfileSaved(savedUploadProfileRef.current === JSON.stringify({ ...uploadSettings, secret: uploadSecret }));
  }, [uploadSecret, uploadSettings]);

  const saveItemToGallery = useCallback(async (item: ImageItem, blob: Blob, outputPath?: string, remoteUrl?: string) => {
    await galleryPut({
      id: item.id,
      name: outputName(item, cleanSuffix(exportSuffix), desktopPreferences.renameTemplate),
      createdAt: Date.now(),
      originalBytes: item.originalBytes,
      outputBytes: blob.size,
      width: item.outputWidth || item.width,
      height: item.outputHeight || item.height,
      mimeType: blob.type || item.type,
      blob,
      sourcePath: item.sourcePath,
      outputPath,
      remoteUrl,
    });
    setGalleryRevision((current) => current + 1);
  }, [desktopPreferences.renameTemplate, exportSuffix]);

  const addSources = useCallback(async (sources: ImageSourceInput[], onProgress?: (current: number, total: number) => void) => {
    const imageSources = sources.filter(({ file }) => file.type.startsWith("image/") || /\.(?:jpe?g|jfif|png|webp|avif|gif)$/i.test(file.name));
    if (!imageSources.length) {
      showToast(t("没有找到可处理的图片", "No supported images were found"));
      return;
    }
    onProgress?.(0, imageSources.length);
    const nextItems: Array<ImageItem | null> = new Array(imageSources.length).fill(null);
    let cursor = 0;
    let completed = 0;
    const workers = Array.from({ length: Math.min(3, imageSources.length) }, async () => {
      while (cursor < imageSources.length) {
        const index = cursor++;
        const { file: sourceFile, fileHandle, sourcePath } = imageSources[index];
        const file = /\.jfif$/i.test(sourceFile.name) ? new File([sourceFile], sourceFile.name, { type: "image/jpeg", lastModified: sourceFile.lastModified }) : sourceFile;
        try {
          const dimensions = await getDimensions(file);
          nextItems[index] = { id: uid(), file, name: file.name || `clipboard-${Date.now()}.png`, type: file.type || mimeFromName(file.name), width: dimensions.width, height: dimensions.height, originalBytes: file.size, sourceUrl: URL.createObjectURL(file), status: "ready", fileHandle, sourcePath };
        } catch {
          nextItems[index] = null;
        } finally {
          completed += 1;
          onProgress?.(completed, imageSources.length);
        }
      }
    });
    await Promise.all(workers);
    const validItems = nextItems.filter((item): item is ImageItem => Boolean(item));
    setItems((current) => [...current, ...validItems]);
    if (!selectedId && validItems[0]) setSelectedId(validItems[0].id);
    showToast(t(`已加入 ${validItems.length} 张图片`, `Added ${validItems.length} images`));
  }, [selectedId, showToast, t]);

  const addNativeEntries = useCallback((entries: NativeImageEntry[]) => {
    const validEntries = entries.filter((entry) => entry.type.startsWith("image/") || /\.(?:jpe?g|jfif|png|webp|avif|gif)$/i.test(entry.name));
    if (!validEntries.length) {
      showToast(t("没有找到可处理的图片", "No supported images were found"));
      return;
    }
    const nextItems = validEntries.map((entry): ImageItem => {
      const previewBytes = entry.thumbnailData.length
        ? new Uint8Array(entry.thumbnailData)
        : new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240"><rect width="100%" height="100%" fill="#e7ece8"/><path d="M125 155l38-44 29 32 20-22 34 34z" fill="#91a99b"/><circle cx="220" cy="84" r="14" fill="#c8ff5a"/></svg>`);
      const previewType = entry.thumbnailData.length ? entry.thumbnailType || "image/webp" : "image/svg+xml";
      const previewFile = new File([previewBytes], entry.name, { type: previewType });
      return {
        id: uid(),
        file: previewFile,
        name: entry.name,
        type: entry.type || mimeFromName(entry.name),
        width: entry.width,
        height: entry.height,
        originalBytes: entry.originalBytes,
        sourceUrl: URL.createObjectURL(previewFile),
        sourcePath: entry.path,
        sourceIsThumbnail: true,
        status: "ready",
      };
    });
    setItems((current) => [...current, ...nextItems]);
    if (!selectedId && nextItems[0]) setSelectedId(nextItems[0].id);
    showToast(t(`已加入 ${nextItems.length} 张图片`, `Added ${nextItems.length} images`));
  }, [selectedId, showToast, t]);

  const addFiles = useCallback((files: File[], onProgress?: (current: number, total: number) => void) => addSources(files.map((file) => ({ file })), onProgress), [addSources]);

  const runImport = useCallback(async (operation: (onProgress: (current: number, total: number) => void) => Promise<void>) => {
    setImportProgress({ current: 0, total: 0 });
    try {
      await operation((current, total) => setImportProgress({ current, total }));
    } finally {
      setImportProgress(null);
    }
  }, []);

  useEffect(() => nativeBridge?.onImageImportProgress(setImportProgress), [nativeBridge]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    if (!nativeBridge) return;
    setExportMode(desktopPreferences.exportMode);
    setExportSuffix(desktopPreferences.exportSuffix);
    setExportFolderName(desktopPreferences.exportFolder);
    setSettings((current) => ({ ...current, preventLarger: desktopPreferences.preventLarger }));
    desktopPreferencesReadyRef.current = true;
    // 桌面偏好已经通过 useState 同步初始化，这里只建立原生窗口状态。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nativeBridge]);

  useEffect(() => {
    if (!nativeBridge) return;
    void isAutostartEnabled()
      .then((enabled) => setDesktopPreferences((current) => current.launchAtStartup === enabled ? current : { ...current, launchAtStartup: enabled }))
      .catch(() => showToast(t("无法读取系统开机启动状态", "Could not read the launch-at-login setting")));
  }, [nativeBridge, showToast, t]);

  useEffect(() => {
    if (!nativeBridge || !desktopPreferencesReadyRef.current) return;
    window.localStorage.setItem("piclite.desktopPreferences.v1", JSON.stringify(desktopPreferences));
    setExportMode(desktopPreferences.exportMode);
    setExportSuffix(desktopPreferences.exportSuffix);
    setExportFolderName(desktopPreferences.exportFolder);
    setSettings((current) => current.preventLarger === desktopPreferences.preventLarger ? current : { ...current, preventLarger: desktopPreferences.preventLarger });
  }, [desktopPreferences, nativeBridge]);

  useEffect(() => {
    if (!nativeBridge || !desktopPreferencesReadyRef.current) return;
    void nativeBridge.updateDesktopPreferences({
      minimizeToTray: desktopPreferences.minimizeToTray,
      showInTaskbarDock: desktopPreferences.showInTaskbarDock,
      clipboardWatcherEnabled: desktopPreferences.clipboardWatcherEnabled,
    });
  }, [desktopPreferences.clipboardWatcherEnabled, desktopPreferences.minimizeToTray, desktopPreferences.showInTaskbarDock, nativeBridge]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyAppearance = () => {
      const resolvedTheme = desktopPreferences.theme === "system"
        ? (media.matches ? "dark" : "light")
        : desktopPreferences.theme;
      const resolvedDensity = desktopPreferences.density === "auto"
        ? (window.innerWidth <= 860 || window.innerHeight <= 540 ? "compact" : "comfortable")
        : desktopPreferences.density;
      document.documentElement.dataset.theme = resolvedTheme;
      document.documentElement.dataset.palette = desktopPreferences.colorTheme;
      document.documentElement.dataset.density = resolvedDensity;
      document.documentElement.style.colorScheme = resolvedTheme;
      if (nativeBridge) void nativeBridge.setWindowTheme(desktopPreferences.theme).catch(() => showToast(t("系统主题同步失败，已保留应用内主题", "Could not sync the system appearance; the in-app theme is still active")));
    };
    applyAppearance();
    media.addEventListener("change", applyAppearance);
    window.addEventListener("resize", applyAppearance);
    return () => {
      media.removeEventListener("change", applyAppearance);
      window.removeEventListener("resize", applyAppearance);
    };
  }, [desktopPreferences.colorTheme, desktopPreferences.density, desktopPreferences.theme, nativeBridge, showToast, t]);

  useEffect(() => {
    window.localStorage.setItem("piclite.customPresets.v1", JSON.stringify(presets.filter((preset) => preset.custom)));
  }, [presets]);

  useEffect(() => {
    if (!nativeBridge || !nativeProfileReady) return;
    void nativeBridge.saveAppProfile({
      settings,
      customPresets: presets.filter((preset) => preset.custom),
      activePresetId,
      localFonts,
      desktopPreferences,
    }).catch(() => showToast(t("本机应用配置保存失败", "Could not save the local app profile")));
  }, [activePresetId, desktopPreferences, localFonts, nativeBridge, nativeProfileReady, presets, settings, showToast, t]);

  useEffect(() => {
    const active = presets.find((preset) => preset.id === activePresetId);
    if (!active || JSON.stringify(active.settings) !== JSON.stringify(settings)) {
      if (activePresetId !== "current") setActivePresetId("current");
    }
    window.localStorage.setItem("piclite.activePreset.v1", activePresetId);
  }, [activePresetId, presets, settings]);

  useEffect(() => {
    window.localStorage.setItem("piclite.watcherSettings.v1", JSON.stringify(watcherSettings));
  }, [watcherSettings]);

  useEffect(() => {
    setPreviewPan({ x: 0, y: 0 });
    setPreviewZoom(100);
    setPreviewFit(true);
  }, [selectedId, previewMode]);

  useEffect(() => () => {
    itemsRef.current.forEach((item) => {
      URL.revokeObjectURL(item.sourceUrl);
      if (item.outputUrl) URL.revokeObjectURL(item.outputUrl);
    });
  }, []);

  useEffect(() => {
    if (!settingsReadyRef.current) {
      settingsReadyRef.current = true;
      window.localStorage.setItem("piclite.compressionSettings.v2", JSON.stringify(settings));
      return;
    }
    window.localStorage.setItem("piclite.compressionSettings.v2", JSON.stringify(settings));
    setItems((current) => current.map((item) => {
      if (item.outputUrl) URL.revokeObjectURL(item.outputUrl);
      return { ...item, outputUrl: undefined, outputBlob: undefined, outputBytes: undefined, outputType: undefined, outputWidth: undefined, outputHeight: undefined, keptOriginal: undefined, sizeGuardQuality: undefined, strategy: undefined, status: "ready", error: undefined };
    }));
  }, [settings]);

  useEffect(() => {
    if (!nativeBridge) return;
    return nativeBridge.onFileDrop((event) => {
      if (event.type === "error") {
        showToast(event.error || t("系统文件拖放监听不可用", "The system file-drop listener is unavailable"));
        return;
      }
      setDragging(event.type === "over");
      if (event.type !== "drop" || !event.paths?.length) return;
      void nativeBridge.readImageEntriesFromPaths(event.paths).then(addNativeEntries);
    });
  }, [addNativeEntries, nativeBridge, showToast, t]);

  useEffect(() => nativeBridge?.onTrayAction(setPendingTrayAction), [nativeBridge]);

  useEffect(() => {
    const id = selectedId || itemsRef.current[0]?.id;
    if (!id) return;
    const generation = ++livePreviewGenerationRef.current;
    const timer = window.setTimeout(async () => {
      const item = itemsRef.current.find((candidate) => candidate.id === id);
      if (!item) return;
      setItems((current) => current.map((candidate) => candidate.id === id ? { ...candidate, status: "processing", error: undefined } : candidate));
      try {
        const result = await compressImage(item, settings, nativeBridge);
        if (generation !== livePreviewGenerationRef.current) return;
        const outputUrl = URL.createObjectURL(result.blob);
        setItems((current) => current.map((candidate) => {
          if (candidate.id !== id) return candidate;
          if (candidate.outputUrl) URL.revokeObjectURL(candidate.outputUrl);
          return {
            ...candidate,
            outputBlob: result.blob,
            outputUrl,
            outputBytes: result.blob.size,
            outputType: result.blob.type || candidate.type,
            outputWidth: result.width,
            outputHeight: result.height,
            keptOriginal: result.keptOriginal,
            sizeGuardQuality: result.sizeGuardQuality,
            strategy: result.strategy,
            status: "done",
          };
        }));
      } catch (error) {
        if (generation !== livePreviewGenerationRef.current) return;
        setItems((current) => current.map((candidate) => candidate.id === id ? { ...candidate, status: "error", error: error instanceof Error ? error.message : t("预览失败", "Preview failed") } : candidate));
      }
    }, itemsRef.current.find((item) => item.id === id)?.type === "image/gif" ? 420 : 220);

    return () => {
      window.clearTimeout(timer);
      if (livePreviewGenerationRef.current === generation) livePreviewGenerationRef.current += 1;
    };
  }, [nativeBridge, selectedId, settings, t]);

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files || []);
      if (files.some((file) => file.type.startsWith("image/"))) {
        event.preventDefault();
        void addFiles(files);
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [addFiles]);

  useEffect(() => {
    if (!nativeBridge) return;
    void nativeBridge.getWatcherState().then((state) => {
      setWatcherActive(state.active);
    });
    return nativeBridge.onWatcherEvent((event) => {
      setWatcherEvents((current) => [event, ...current].slice(0, 30));
      if (event.type === "started") setWatcherActive(true);
      if (event.type === "stopped") setWatcherActive(false);
      if (event.type === "success" && event.output) {
        void nativeBridge.readImagesFromPaths([event.output]).then(async ([image]) => {
          if (!image) return;
          const blob = new Blob([new Uint8Array(image.data)], { type: image.type || mimeFromName(image.name) });
          const dimensions = await getDimensions(new File([blob], image.name, { type: blob.type }));
          await galleryPut({
            id: `watcher:${event.output}`,
            name: image.name,
            createdAt: event.time,
            originalBytes: event.originalBytes || blob.size,
            outputBytes: event.outputBytes || blob.size,
            width: dimensions.width,
            height: dimensions.height,
            mimeType: blob.type,
            blob,
            outputPath: event.output,
          });
          setGalleryRevision((current) => current + 1);
        }).catch(() => undefined);
      }
    });
  }, [nativeBridge]);

  const processOne = useCallback(async (id: string) => {
    const item = itemsRef.current.find((candidate) => candidate.id === id);
    if (!item) return;
    setItems((current) => current.map((candidate) => candidate.id === id ? { ...candidate, status: "processing", error: undefined } : candidate));
    try {
      const result = await compressImage(item, settings, nativeBridge);
      const outputUrl = URL.createObjectURL(result.blob);
      const completed: ImageItem = { ...item, outputBlob: result.blob, outputUrl, outputBytes: result.blob.size, outputType: result.blob.type || item.type, outputWidth: result.width, outputHeight: result.height, keptOriginal: result.keptOriginal, sizeGuardQuality: result.sizeGuardQuality, strategy: result.strategy, status: "done" };
      setItems((current) => current.map((candidate) => {
        if (candidate.id !== id) return candidate;
        if (candidate.outputUrl) URL.revokeObjectURL(candidate.outputUrl);
        return { ...completed, fileHandle: candidate.fileHandle, sourcePath: candidate.sourcePath };
      }));
      await saveItemToGallery(completed, result.blob);
    } catch (error) {
      setItems((current) => current.map((candidate) => candidate.id === id ? { ...candidate, status: "error", error: error instanceof Error ? error.message : t("压缩失败", "Optimisation failed") } : candidate));
    }
  }, [nativeBridge, saveItemToGallery, settings, t]);

  const processAll = useCallback(async () => {
    if (!items.length) return;
    livePreviewGenerationRef.current += 1;
    setProcessingAll(true);
    for (const item of items) await processOne(item.id);
    setProcessingAll(false);
    showToast(t("全部图片已处理完成", "All images have been processed"));
  }, [items, processOne, showToast, t]);

  const downloadItem = useCallback((item: ImageItem, blob = item.outputBlob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = outputName(item, cleanSuffix(exportSuffix), desktopPreferences.renameTemplate);
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 3000);
  }, [desktopPreferences.renameTemplate, exportSuffix]);

  const copyBlobToClipboard = useCallback(async (blob: Blob, fileName: string) => {
    if (nativeBridge) {
      await nativeBridge.copyCompressedData(new Uint8Array(await blob.arrayBuffer()), fileName);
      return;
    }
    const clipboardItem = ClipboardItem as unknown as { new(items: Record<string, Blob>): ClipboardItem; supports?: (type: string) => boolean };
    if (clipboardItem.supports?.(blob.type)) {
      await navigator.clipboard.write([new clipboardItem({ [blob.type]: blob })]);
      return;
    }
    const clipboardBlob = blob.type === "image/png" ? blob : await (async () => {
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("无法创建剪贴板图片");
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!png) throw new Error("无法转换剪贴板图片");
      return png;
    })();
    await navigator.clipboard.write([new ClipboardItem({ "image/png": clipboardBlob })]);
  }, [nativeBridge]);

  const copySelectedResult = useCallback(async () => {
    if (!selected) return;
    try {
      const blob = selected.outputBlob || selected.file;
      await copyBlobToClipboard(blob, outputName(selected, cleanSuffix(exportSuffix), desktopPreferences.renameTemplate));
      await saveItemToGallery(selected, blob);
      showToast(nativeBridge ? t(`已复制压缩文件 · ${formatBytes(blob.size)}`, `Optimised file copied · ${formatBytes(blob.size)}`) : t("结果图已复制，可直接粘贴到其他软件", "Result copied and ready to paste"));
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("复制结果图失败", "Could not copy the result"));
    }
  }, [copyBlobToClipboard, desktopPreferences.renameTemplate, exportSuffix, nativeBridge, saveItemToGallery, selected, showToast, t]);

  const copyGalleryResult = useCallback(async (record: GalleryRecord) => {
    try {
      await copyBlobToClipboard(record.blob, record.name);
      showToast(nativeBridge ? t(`已复制压缩文件 · ${formatBytes(record.blob.size)}`, `Optimised file copied · ${formatBytes(record.blob.size)}`) : t("图库图片已复制", "Library image copied"));
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("复制失败", "Copy failed"));
    }
  }, [copyBlobToClipboard, nativeBridge, showToast, t]);

  const downloadGalleryResult = useCallback((record: GalleryRecord) => {
    const url = URL.createObjectURL(record.blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = record.name;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 3000);
  }, []);

  const uploadGalleryResult = useCallback(async (record: GalleryRecord) => {
    if (!nativeBridge) {
      showToast(t("云端上传只在桌面客户端提供", "Cloud upload is available in the desktop app"));
      return;
    }
    if (!uploadSettings.endpoint.trim()) {
      showToast(t("请先在应用设置中填写上传服务地址", "Enter an upload endpoint in Preferences first"));
      void nativeBridge.showPreferencesWindow();
      return;
    }
    setUploadingId(record.id);
    try {
      const result = await nativeBridge.uploadImage({
        ...uploadSettings,
        secret: uploadSecret,
        fileName: record.name,
        mimeType: record.mimeType,
        data: new Uint8Array(await record.blob.arrayBuffer()),
      });
      await galleryPut({ ...record, remoteUrl: result.url });
      setGalleryRevision((current) => current + 1);
      await navigator.clipboard.writeText(result.url).catch(() => undefined);
      showToast(t("上传完成，图片链接已复制", "Upload complete; image URL copied"));
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("上传失败", "Upload failed"));
    } finally {
      setUploadingId(null);
    }
  }, [nativeBridge, showToast, t, uploadSecret, uploadSettings]);

  const saveUploadProfile = useCallback(async () => {
    if (!nativeBridge) {
      showToast(t("图床上传配置只在桌面客户端保存", "Hosting settings are saved by the desktop app"));
      return;
    }
    if (!uploadSettings.endpoint.trim()) {
      showToast(t("请先填写服务地址", "Enter the provider endpoint first"));
      return;
    }
    try {
      await nativeBridge.saveUploadProfile({ ...uploadSettings, secret: uploadSecret });
      savedUploadProfileRef.current = JSON.stringify({ ...uploadSettings, secret: uploadSecret });
      setUploadProfileSaved(true);
      showToast(t("图床配置与凭证已保存到本机", "Hosting settings and credentials were saved locally"));
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("图床配置保存失败", "Could not save hosting settings"));
    }
  }, [nativeBridge, showToast, t, uploadSecret, uploadSettings]);

  const uploadSelectedResult = useCallback(async () => {
    if (!selected?.outputBlob) return;
    const record: GalleryRecord = {
      id: selected.id,
      name: outputName(selected, cleanSuffix(exportSuffix), desktopPreferences.renameTemplate),
      createdAt: Date.now(),
      originalBytes: selected.originalBytes,
      outputBytes: selected.outputBlob.size,
      width: selected.outputWidth || selected.width,
      height: selected.outputHeight || selected.height,
      mimeType: selected.outputBlob.type || selected.type,
      blob: selected.outputBlob,
      sourcePath: selected.sourcePath,
    };
    await galleryPut(record);
    setGalleryRevision((current) => current + 1);
    await uploadGalleryResult(record);
  }, [desktopPreferences.renameTemplate, exportSuffix, selected, uploadGalleryResult]);

  const copyRemoteUrl = useCallback(async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      showToast(t("图片链接已复制", "Image URL copied"));
    } catch {
      showToast(t("链接复制失败，请手动复制", "Could not copy the URL; copy it manually"));
    }
  }, [showToast, t]);

  const deleteGalleryResult = useCallback(async (id: string) => {
    await galleryDelete(id);
    setGalleryRevision((current) => current + 1);
    showToast(t("已从图库记录中移除，不会删除本地文件", "Removed from the library; the local file was not deleted"));
  }, [showToast, t]);

  const deleteGalleryBatch = useCallback(async () => {
    const cutoff = galleryDeleteScope === "day" ? Date.now() - 86_400_000
      : galleryDeleteScope === "week" ? Date.now() - 7 * 86_400_000
        : galleryDeleteScope === "month" ? Date.now() - 30 * 86_400_000
          : null;
    const ids = galleryDeleteScope === "selected" ? galleryCheckedIds
      : galleryDeleteScope === "all" ? galleryItems.map((item) => item.id)
        : galleryItems.filter((item) => cutoff != null && item.createdAt <= cutoff).map((item) => item.id);
    if (!ids.length) {
      showToast(t("没有符合条件的图库记录", "No library entries match this filter"));
      return;
    }
    await galleryDeleteMany(ids);
    setGalleryCheckedIds((current) => current.filter((id) => !ids.includes(id)));
    setGalleryRevision((current) => current + 1);
    showToast(t(`已移除 ${ids.length} 条图库记录，本地文件不受影响`, `Removed ${ids.length} library entries; local files were not changed`));
  }, [galleryCheckedIds, galleryDeleteScope, galleryItems, showToast, t]);

  const prepareItemsForExport = useCallback(async (sourceItems: ImageItem[]) => {
    const prepared: Array<{ item: ImageItem; blob: Blob }> = [];
    for (const item of sourceItems) {
      // Re-encode stale results produced by older builds when the explicit
      // "Keep original" choice was ignored by Smart Balance. This export-time
      // guard also makes batch behaviour deterministic across Windows/macOS.
      const cachedFormatMatches = settings.format !== "keep"
        || outputExtension(item.outputBlob?.type || item.outputType || item.type, item.name) === outputExtension(item.type, item.name);
      if (item.outputBlob && cachedFormatMatches) {
        prepared.push({ item, blob: item.outputBlob });
        continue;
      }
      setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status: "processing", error: undefined } : candidate));
      const result = await compressImage(item, settings, nativeBridge);
      const outputUrl = URL.createObjectURL(result.blob);
      const completed = { ...item, outputBlob: result.blob, outputUrl, outputBytes: result.blob.size, outputType: result.blob.type || item.type, outputWidth: result.width, outputHeight: result.height, keptOriginal: result.keptOriginal, sizeGuardQuality: result.sizeGuardQuality, strategy: result.strategy, status: "done" as const };
      setItems((current) => current.map((candidate) => {
        if (candidate.id !== item.id) return candidate;
        if (candidate.outputUrl) URL.revokeObjectURL(candidate.outputUrl);
        return completed;
      }));
      prepared.push({ item: completed, blob: result.blob });
    }
    return prepared;
  }, [nativeBridge, settings]);

  const chooseExportFolder = useCallback(async () => {
    try {
      if (nativeBridge) {
        const folder = await nativeBridge.selectFolder("export");
        if (!folder) return false;
        setExportFolderName(folder);
        setDesktopPreferences((current) => ({ ...current, exportFolder: folder }));
        return true;
      }
      if (!window.showDirectoryPicker) {
        showToast(t("当前浏览器不支持文件夹写入，请使用 Chrome、Edge 或下载模式", "This browser cannot write to folders. Use Chrome, Edge, or download mode."));
        return false;
      }
      const handle = await window.showDirectoryPicker({ mode: "readwrite" });
      exportDirectoryRef.current = handle;
      setExportFolderName(handle.name);
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return false;
      showToast(t("没有获得文件夹写入权限", "Folder write permission was not granted"));
      return false;
    }
  }, [nativeBridge, showToast, t]);

  const exportItems = useCallback(async (requestedItems: ImageItem[]) => {
    if (!requestedItems.length || exporting) return;
    let effectiveExportMode = exportMode;
    if (effectiveExportMode === "overwrite" && settings.format !== "keep") {
      showToast(t("覆盖源文件时请将输出格式设为“保持原格式”", "Select Keep original format before replacing source files"));
      return;
    }
    if (effectiveExportMode === "overwrite" && (!nativeBridge || desktopPreferences.confirmOverwrite) && !window.confirm(t("确认覆盖源图片？该操作无法在 PicLite 中撤销。", "Replace the source images? PicLite cannot undo this action."))) return;

    setExporting(true);
    try {
      if (!nativeBridge && effectiveExportMode === "overwrite") {
        const handles = requestedItems.map((item) => item.fileHandle);
        if (handles.some((handle) => !handle)) throw new Error(t("覆盖需要通过“添加图片”重新选择源文件并授权写入", "To replace originals, import them again with Add images and grant write access"));
        for (const handle of handles) {
          if (handle?.requestPermission && await handle.requestPermission({ mode: "readwrite" }) !== "granted") throw new Error(t("没有获得源文件写入权限", "Source-file write permission was not granted"));
        }
      }
      // Clipboard and browser-imported images have no source folder. They are
      // still valid export targets: quietly switch this batch to the user’s
      // fixed folder instead of refusing the entire export.
      if (nativeBridge && (effectiveExportMode === "overwrite" || effectiveExportMode === "same-folder") && requestedItems.some((item) => !item.sourcePath)) {
        effectiveExportMode = "fixed-folder";
        showToast(t("部分图片没有源路径，已改为固定文件夹导出", "Some images have no source path; exporting them to the fixed folder instead"));
      }
      if (!nativeBridge && (effectiveExportMode === "same-folder" || effectiveExportMode === "fixed-folder") && !exportDirectoryRef.current && !(await chooseExportFolder())) return;
      if (nativeBridge && effectiveExportMode === "fixed-folder" && !exportFolderName && !(await chooseExportFolder())) return;

      const prepared = await prepareItemsForExport(requestedItems);
      const suffix = cleanSuffix(exportSuffix);
      if (effectiveExportMode === "download") {
        prepared.forEach(({ item, blob }, index) => window.setTimeout(() => downloadItem(item, blob), index * 160));
        showToast(t(`正在下载 ${prepared.length} 张图片`, `Downloading ${prepared.length} images`));
        return;
      }

      if (nativeBridge) {
        if ((effectiveExportMode === "overwrite" || effectiveExportMode === "same-folder") && prepared.some(({ item }) => !item.sourcePath)) {
          throw new Error(t("有图片不是通过“添加图片”导入，无法定位源文件夹", "Some images have no source folder because they were not imported with Add images"));
        }
        const payloadItems: NativeExportItem[] = [];
        for (const { item, blob } of prepared) {
          payloadItems.push({ sourcePath: item.sourcePath, outputName: outputName(item, suffix, desktopPreferences.renameTemplate), data: new Uint8Array(await blob.arrayBuffer()) });
        }
        const result = await nativeBridge.exportImages({ mode: effectiveExportMode, suffix, fixedFolder: exportFolderName || undefined, items: payloadItems });
        if (!result.ok) throw new Error(result.error || t("导出失败", "Export failed"));
        for (let index = 0; index < prepared.length; index += 1) {
          const { item, blob } = prepared[index];
          await saveItemToGallery(item, blob, result.paths?.[index]);
        }
        showToast(t(`已写入 ${result.paths?.length || prepared.length} 个文件`, `Wrote ${result.paths?.length || prepared.length} files`));
        return;
      }

      if (effectiveExportMode === "overwrite") {
        if (prepared.some(({ item }) => !item.fileHandle)) throw new Error(t("覆盖需要通过“添加图片”重新选择源文件并授权写入", "To replace originals, import them again with Add images and grant write access"));
        for (const { item, blob } of prepared) {
          const writable = await item.fileHandle!.createWritable();
          await writable.write(blob);
          await writable.close();
        }
      } else {
        const directory = exportDirectoryRef.current;
        if (!directory) throw new Error(t("请选择输出文件夹", "Choose an output folder"));
        for (const { item, blob } of prepared) {
          const handle = await directory.getFileHandle(outputName(item, suffix), { create: true });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
        }
      }
      showToast(t(`已写入 ${prepared.length} 个文件`, `Wrote ${prepared.length} files`));
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("导出失败", "Export failed"));
    } finally {
      setExporting(false);
    }
  }, [chooseExportFolder, desktopPreferences.confirmOverwrite, desktopPreferences.renameTemplate, downloadItem, exportFolderName, exportMode, exportSuffix, exporting, nativeBridge, prepareItemsForExport, saveItemToGallery, settings.format, showToast, t]);

  const exportAll = useCallback(() => void exportItems(itemsRef.current), [exportItems]);
  const exportSelected = useCallback(() => {
    if (selected) void exportItems([selected]);
  }, [exportItems, selected]);

  const removeItem = useCallback((id: string) => {
    const item = items.find((candidate) => candidate.id === id);
    if (item) {
      URL.revokeObjectURL(item.sourceUrl);
      if (item.outputUrl) URL.revokeObjectURL(item.outputUrl);
    }
    const remaining = items.filter((candidate) => candidate.id !== id);
    setItems(remaining);
    if (selectedId === id) setSelectedId(remaining[0]?.id || null);
  }, [items, selectedId]);

  const clearAll = useCallback(() => {
    items.forEach((item) => {
      URL.revokeObjectURL(item.sourceUrl);
      if (item.outputUrl) URL.revokeObjectURL(item.outputUrl);
    });
    setItems([]);
    setSelectedId(null);
  }, [items]);

  const importFromClipboard = useCallback(async () => {
    try {
      if (nativeBridge) {
        const nativeImage = await nativeBridge.readClipboardImage();
        if (nativeImage) {
          await addFiles([new File([new Uint8Array(nativeImage.data)], `clipboard-${Date.now()}.png`, { type: "image/png" })]);
          return;
        }
      }
      const clipboardItems = await navigator.clipboard.read();
      const files: File[] = [];
      for (const clipboardItem of clipboardItems) {
        const type = clipboardItem.types.find((candidate) => candidate.startsWith("image/"));
        if (!type) continue;
        const blob = await clipboardItem.getType(type);
        files.push(new File([blob], `clipboard-${Date.now()}.${type.split("/")[1]}`, { type }));
      }
      await addFiles(files);
    } catch {
      showToast(t("请直接按 Ctrl + V 粘贴剪贴板图片", "Press Ctrl + V to paste the clipboard image"));
    }
  }, [addFiles, nativeBridge, showToast, t]);

  const toggleAutostart = useCallback(async () => {
    if (!nativeBridge) return;
    const next = !desktopPreferences.launchAtStartup;
    try {
      if (next) await enableAutostart();
      else await disableAutostart();
      setDesktopPreferences((current) => ({ ...current, launchAtStartup: next }));
      showToast(next ? t("已开启开机自启动，将静默进入系统托盘", "Launch at login enabled; PicLite will start quietly in the tray") : t("已关闭开机自启动", "Launch at login disabled"));
    } catch {
      showToast(t("开机自启动设置失败，请检查系统权限", "Could not change launch-at-login settings; check system permissions"));
    }
  }, [desktopPreferences.launchAtStartup, nativeBridge, showToast, t]);

  const captureShortcut = useCallback((event: ShortcutKeyEvent & { preventDefault: () => void; stopPropagation: () => void }, preference: ShortcutPreferenceKey) => {
    event.preventDefault();
    event.stopPropagation();
    const shortcut = shortcutFromKeyboardEvent(event);
    if (shortcut === null) return;
    if (shortcut === "escape") {
      setRecordingShortcut(null);
      return;
    }
    setDesktopPreferences((current) => ({ ...current, [preference]: shortcut }));
    setRecordingShortcut(null);
    showToast(shortcut ? t("快捷键已更新", "Shortcut updated") : t("快捷键已清除", "Shortcut cleared"));
  }, [showToast, t]);

  useEffect(() => {
    if (!recordingShortcut) return;
    const capture = (event: globalThis.KeyboardEvent) => captureShortcut(event, recordingShortcut);
    window.addEventListener("keydown", capture, true);
    return () => window.removeEventListener("keydown", capture, true);
  }, [captureShortcut, recordingShortcut]);

  useEffect(() => {
    if (!nativeBridge) return;
    void nativeBridge.configureGlobalShortcuts({
      enabled: desktopPreferences.shortcutsEnabled && !recordingShortcut,
      toggleDropzone: desktopPreferences.shortcutDock,
      optimiseClipboard: desktopPreferences.shortcutPaste,
      showMain: desktopPreferences.shortcutShow,
      showGallery: desktopPreferences.shortcutGallery,
      uploadCurrent: desktopPreferences.shortcutUpload,
    }).catch(() => showToast(t("部分全局快捷键被其他软件占用，请重新设置", "Some global shortcuts are already used by another app")));
  }, [desktopPreferences.shortcutDock, desktopPreferences.shortcutGallery, desktopPreferences.shortcutPaste, desktopPreferences.shortcutShow, desktopPreferences.shortcutUpload, desktopPreferences.shortcutsEnabled, nativeBridge, recordingShortcut, showToast, t]);

  const importImages = useCallback(async () => {
    try {
      if (nativeBridge) {
        await runImport(async () => {
          const nativeImages = await nativeBridge.selectImageEntries();
          addNativeEntries(nativeImages);
        });
        return;
      }
      if (window.showOpenFilePicker) {
        const handles = await window.showOpenFilePicker({
          multiple: true,
          types: [{ description: "图片", accept: { "image/*": [".jpg", ".jpeg", ".jfif", ".png", ".webp", ".gif", ".avif"] } }],
        });
        await runImport(async (onProgress) => {
          onProgress(0, handles.length);
          const sources = await Promise.all(handles.map(async (fileHandle) => ({ file: await fileHandle.getFile(), fileHandle })));
          await addSources(sources, onProgress);
        });
        return;
      }
      fileInputRef.current?.click();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      fileInputRef.current?.click();
    }
  }, [addNativeEntries, addSources, nativeBridge, runImport]);

  const importImageFolder = useCallback(async () => {
    try {
      if (nativeBridge) {
        await runImport(async () => {
          const nativeImages = await nativeBridge.selectImageFolderEntries();
          addNativeEntries(nativeImages);
        });
        return;
      }
      folderInputRef.current?.click();
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
    }
  }, [addNativeEntries, nativeBridge, runImport, showToast]);

  const loadSystemFonts = useCallback(async (silent = false) => {
    try {
      let families: string[] = [];
      if (nativeBridge) {
        const fonts = await nativeBridge.listSystemFonts();
        systemFontFilesRef.current = new Map(fonts.map((font) => [font.family, font]));
        families = fonts.map((font) => font.family);
      } else if (window.queryLocalFonts) {
        families = Array.from(new Set((await window.queryLocalFonts()).map((font) => font.family).filter(Boolean))).sort((left, right) => left.localeCompare(right));
      }
      if (!families.length) {
        if (!silent) showToast(nativeBridge ? t("没有在系统字体目录中找到可用字体", "No usable fonts were found in the system font folders") : t("当前浏览器不支持读取系统字体，可直接导入字体文件", "This browser cannot read system fonts; import a font file instead"));
        return;
      }
      setLocalFonts((current) => Array.from(new Set([...current, ...families])));
      if (!silent) showToast(t(`已读取 ${families.length} 个本地字体`, `Loaded ${families.length} local fonts`));
    } catch {
      if (!silent) showToast(t("没有获得本地字体读取权限", "Permission to read local fonts was not granted"));
    }
  }, [nativeBridge, showToast, t]);

  const selectSystemFont = useCallback(async (family: string, silent = false) => {
    try {
      if (!loadedSystemFontsRef.current.has(family)) {
        const systemFont = systemFontFilesRef.current.get(family);
        const localName = family.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
        const source = nativeBridge && systemFont
          ? (await nativeBridge.readSystemFont(systemFont.path, systemFont.faceIndex)).data.slice().buffer as ArrayBuffer
          : `local("${localName}")`;
        const face = new FontFace(family, source);
        await face.load();
        document.fonts.add(face);
        await document.fonts.load(`16px "${localName}"`, "PicLite 图轻 123");
        await document.fonts.ready;
        loadedSystemFontsRef.current.add(family);
      }
      setSettings((current) => ({ ...current, watermark: { ...current.watermark, fontFamily: family } }));
      if (!silent) showToast(t(`水印字体已切换为：${family}`, `Watermark font changed to ${family}`));
    } catch {
      setSettings((current) => ({ ...current, watermark: { ...current.watermark, fontFamily: family } }));
      if (!silent) showToast(t(`系统字体 ${family} 无法载入，请尝试导入对应字体文件`, `Could not load the system font ${family}; try importing its font file`));
    }
  }, [nativeBridge, showToast, t]);

  const onFontSelected = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const family = `PicLite ${file.name.replace(/\.[^.]+$/, "")}`;
      const data = new Uint8Array(await file.arrayBuffer());
      const font = new FontFace(family, data.slice().buffer as ArrayBuffer);
      await font.load();
      document.fonts.add(font);
      loadedSystemFontsRef.current.add(family);
      if (nativeBridge) await nativeBridge.saveImportedFont(family, data);
      setLocalFonts((current) => Array.from(new Set([...current, family])));
      setSettings((current) => ({ ...current, watermark: { ...current.watermark, fontFamily: family } }));
      showToast(nativeBridge ? t(`已载入并保存字体：${file.name}`, `Font imported and saved: ${file.name}`) : t(`已载入字体：${file.name}`, `Font imported: ${file.name}`));
    } catch {
      showToast(t("字体文件无法读取，请使用 TTF、OTF、WOFF 或 WOFF2", "Could not read the font. Use a TTF, OTF, WOFF, or WOFF2 file."));
    }
  }, [nativeBridge, showToast, t]);

  useEffect(() => {
    if (!nativeBridge || !nativeProfileReady || importedFontsHydratedRef.current) return;
    importedFontsHydratedRef.current = true;
    void nativeBridge.loadImportedFonts().then(async (fonts) => {
      const restored: string[] = [];
      for (const { family, data } of fonts) {
        try {
          const font = new FontFace(family, data.slice().buffer as ArrayBuffer);
          await font.load();
          document.fonts.add(font);
          loadedSystemFontsRef.current.add(family);
          restored.push(family);
        } catch { /* Keep a corrupt or removed cached font from blocking startup. */ }
      }
      if (restored.length) setLocalFonts((current) => Array.from(new Set([...current, ...restored])));
    }).catch(() => undefined);
  }, [nativeBridge, nativeProfileReady]);

  useEffect(() => {
    if (!nativeBridge || !nativeProfileReady) return;
    const family = settings.watermark.fontFamily;
    if (!family || hydratedWatermarkFontRef.current === family) return;
    hydratedWatermarkFontRef.current = family;
    void (async () => {
      await loadSystemFonts(true);
      if (systemFontFilesRef.current.has(family)) await selectSystemFont(family, true);
    })();
  }, [loadSystemFonts, nativeBridge, nativeProfileReady, selectSystemFont, settings.watermark.fontFamily]);

  const handleComparePointer = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const layer = event.currentTarget.closest(".preview-pan-layer") as HTMLElement | null;
    const box = layer?.getBoundingClientRect() || compareRef.current?.getBoundingClientRect();
    if (!box) return;
    setCompare(Math.max(0, Math.min(100, ((event.clientX - box.left) / box.width) * 100)));
  }, []);

  const setZoom = useCallback((next: number) => {
    setPreviewFit(false);
    setPreviewZoom(Math.max(10, Math.min(800, Math.round(next))));
  }, []);

  const startPreviewPan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (!selected || target.closest("button, input, select, a, .compare-handle")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    previewDragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX: previewPan.x, panY: previewPan.y };
  }, [previewPan, selected]);

  const movePreviewPan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = previewDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPreviewPan({ x: drag.panX + event.clientX - drag.x, y: drag.panY + event.clientY - drag.y });
  }, []);

  const stopPreviewPan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (previewDragRef.current?.pointerId === event.pointerId) previewDragRef.current = null;
  }, []);

  const zoomPreviewWithWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if (!selected) return;
    event.preventDefault();
    setZoom(previewZoom * (event.deltaY > 0 ? 0.9 : 1.1));
  }, [previewZoom, selected, setZoom]);

  const chooseFolder = useCallback(async (kind: "input" | "output") => {
    if (!nativeBridge) return;
    const folder = await nativeBridge.selectFolder(kind);
    if (!folder) return;
    setWatcherSettings((current) => ({ ...current, [kind === "input" ? "inputFolder" : "outputFolder"]: folder }));
  }, [nativeBridge]);

  const useSuggestedScreenshotFolder = useCallback(async () => {
    if (!nativeBridge) return;
    try {
      const folder = await nativeBridge.suggestScreenshotFolder();
      if (!folder) {
        showToast(t("未找到系统截图目录，请手动选择文件夹", "The screenshot folder was not found; choose it manually"));
        return;
      }
      setWatcherSettings((current) => ({ ...current, inputFolder: folder }));
      showToast(t("已选择系统截图目录，可直接开始监测", "Screenshot folder selected; folder watching is ready"));
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("无法读取系统截图目录", "Could not read the screenshot folder"));
    }
  }, [nativeBridge, showToast, t]);

  const applyPreset = useCallback((preset: SavedPreset) => {
    setSettings({ ...preset.settings, watermark: { ...preset.settings.watermark } });
    setActivePresetId(preset.id);
    showToast(t(`已应用预设：${preset.name}`, `Preset applied: ${preset.name}`));
  }, [showToast, t]);

  const saveCustomPreset = useCallback(() => {
    const name = presetName.trim();
    if (!name) return;
    const preset: SavedPreset = {
      id: `custom-${uid()}`,
      name,
      custom: true,
      settings: { ...settings, watermark: { ...settings.watermark } },
    };
    setPresets((current) => [...current, preset]);
    setActivePresetId(preset.id);
    setPresetName("");
    setPresetDialogOpen(false);
    showToast(t(`已保存预设：${name}`, `Preset saved: ${name}`));
  }, [presetName, settings, showToast, t]);

  const deleteActivePreset = useCallback(() => {
    const preset = presets.find((candidate) => candidate.id === activePresetId);
    if (!preset?.custom) return;
    setPresets((current) => current.filter((candidate) => candidate.id !== preset.id));
    setActivePresetId("lossless");
    showToast(t(`已删除预设：${preset.name}`, `Preset deleted: ${preset.name}`));
  }, [activePresetId, presets, showToast, t]);

  const persistWatchProfiles = useCallback((profiles: WatchProfile[]) => {
    const current = loadDesktopSettings();
    saveDesktopSettings({ ...current, watchProfiles: profiles, watchFolders: profiles.map((profile) => profile.inputFolder) });
    setWatchProfiles(profiles);
  }, []);

  const saveWatchProfile = useCallback(async () => {
    if (!nativeBridge) return;
    if (!watcherSettings.inputFolder) {
      showToast(t("请先选择要监测的文件夹", "Choose a folder to watch first"));
      return;
    }
    const id = selectedWatchProfileId || `watch-${uid()}`;
    const current = watchProfiles.find((profile) => profile.id === id);
    const profile: WatchProfile = {
      ...watcherSettings,
      id,
      name: current?.name || watcherSettings.inputFolder.split(/[\\/]/).filter(Boolean).pop() || t("监控任务", "Watch task"),
      enabled: current?.enabled ?? true,
      inputFolders: [],
    };
    const next = [...watchProfiles.filter((item) => item.id !== id), profile];
    const active = next.filter((item) => item.enabled);
    const validation = await nativeBridge.validateWatcher({ ...profile, profiles: active.length ? active : [profile] });
    if (!validation.ok) { showToast(validation.error || t("监控规则无效", "Invalid watch rules")); return; }
    persistWatchProfiles(next);
    setSelectedWatchProfileId(id);
    if (active.length) {
      const result = await nativeBridge.startWatcher({ ...active[0], profiles: active });
      if (!result.ok) { showToast(result.error || t("无法启动文件夹监测", "Could not start folder watching")); return; }
    }
    showToast(t("监控任务已保存并启用", "Watch task saved and enabled"));
  }, [nativeBridge, persistWatchProfiles, selectedWatchProfileId, showToast, t, watchProfiles, watcherSettings]);

  const selectWatchProfile = useCallback((profile: WatchProfile) => {
    setSelectedWatchProfileId(profile.id);
    setWatcherSettings({ ...DEFAULT_WATCHER_SETTINGS, ...profile });
  }, []);

  const createWatchProfile = useCallback(() => {
    setSelectedWatchProfileId(null);
    setWatcherSettings({ ...DEFAULT_WATCHER_SETTINGS });
  }, []);

  const toggleWatchProfile = useCallback(async (profile: WatchProfile) => {
    if (!nativeBridge) return;
    const next = watchProfiles.map((item) => item.id === profile.id ? { ...item, enabled: !item.enabled } : item);
    const active = next.filter((item) => item.enabled);
    if (active.length) {
      const validation = await nativeBridge.validateWatcher({ ...active[0], profiles: active });
      if (!validation.ok) { showToast(validation.error || t("监控规则无效", "Invalid watch rules")); return; }
    }
    persistWatchProfiles(next);
    if (active.length) await nativeBridge.startWatcher({ ...active[0], profiles: active });
    else await nativeBridge.stopWatcher();
  }, [nativeBridge, persistWatchProfiles, showToast, t, watchProfiles]);

  const removeWatchProfile = useCallback(async (profile: WatchProfile) => {
    if (!nativeBridge) return;
    const next = watchProfiles.filter((item) => item.id !== profile.id);
    persistWatchProfiles(next);
    const active = next.filter((item) => item.enabled);
    if (active.length) await nativeBridge.startWatcher({ ...active[0], profiles: active });
    else await nativeBridge.stopWatcher();
    if (selectedWatchProfileId === profile.id) createWatchProfile();
  }, [createWatchProfile, nativeBridge, persistWatchProfiles, selectedWatchProfileId, watchProfiles]);

  useEffect(() => {
    if (!pendingTrayAction) return;
    const action = pendingTrayAction;
    setPendingTrayAction(null);
    if (action === "check_updates") {
      void checkForUpdates(true);
      return;
    }
    if (action === "preferences") {
      void nativeBridge?.showPreferencesWindow();
      return;
    }
    if (action === "watcher_settings") {
      setView("watcher");
      return;
    }
    if (action === "gallery") {
      setView("gallery");
      return;
    }
    if (action.startsWith("theme_")) {
      const theme = action.replace("theme_", "") as ThemeMode;
      setDesktopPreferences((current) => ({ ...current, theme }));
      return;
    }
    if (action.startsWith("density_")) {
      const density = action.replace("density_", "") as UiDensity;
      setDesktopPreferences((current) => ({ ...current, density }));
      return;
    }
    if (action === "toggle_minimize_to_tray") {
      setDesktopPreferences((current) => ({ ...current, minimizeToTray: !current.minimizeToTray }));
      return;
    }
    const presetId = action.startsWith("preset_") ? action.replace("preset_", "") : "";
    if (presetId === "last") {
      showToast(t("已保留上次使用的压缩参数", "Restored the last-used compression settings"));
      return;
    }
    const preset = presets.find((candidate) => candidate.id === presetId);
    if (preset) applyPreset(preset);
  }, [applyPreset, checkForUpdates, nativeBridge, pendingTrayAction, presets, showToast, t]);

  const onDrop = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length) void runImport((onProgress) => addFiles(files, onProgress));
  }, [addFiles, runImport]);

  const onFilesSelected = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (files.length) void runImport((onProgress) => addFiles(files, onProgress));
  }, [addFiles, runImport]);

  const onFolderFilesSelected = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (files.length) void runImport((onProgress) => addFiles(files, onProgress));
  }, [addFiles, runImport]);

  const importPlugin = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const raw = await file.text();
      let name = file.name.replace(/\.(html?|js|json)$/i, "");
      let source = raw;
      if (file.name.toLowerCase().endsWith(".js")) source = jsPluginDocument(raw);
      if (file.name.toLowerCase().endsWith(".json")) {
        const manifest = JSON.parse(raw) as { name?: string; nameZh?: string; nameEn?: string; html?: string; script?: string; url?: string };
        name = manifest.name || manifest.nameZh || name;
        const plugin: WorkspacePlugin = { id: `custom-${Date.now()}`, nameZh: manifest.nameZh || name, nameEn: manifest.nameEn || manifest.name || name, kind: manifest.url ? "url" : "html", enabled: true, source: manifest.html || (manifest.script ? jsPluginDocument(manifest.script) : undefined), url: manifest.url };
        setWorkspacePlugins((current) => [...current, plugin]); setView(`plugin:${plugin.id}`); return;
      }
      const plugin: WorkspacePlugin = { id: `custom-${Date.now()}`, nameZh: name, nameEn: name, kind: "html", enabled: true, source };
      setWorkspacePlugins((current) => [...current, plugin]); setView(`plugin:${plugin.id}`);
    } catch (error) { showToast(error instanceof Error ? error.message : String(error)); }
  }, [showToast]);

  const addUrlPlugin = useCallback(async () => {
    try {
      const url = new URL(pluginUrl);
      if (!/^https?:$/.test(url.protocol)) throw new Error(t("只支持 HTTP(S) 插件地址", "Only HTTP(S) plugin URLs are supported"));
      const source = await loadPluginText(url.toString(), nativeBridge);
      const documentTitle = new DOMParser().parseFromString(source, "text/html").title.trim();
      const name = pluginName.trim() || documentTitle || url.hostname;
      const id = `url-${Date.now()}`;
      const plugin: WorkspacePlugin = { id, nameZh: name, nameEn: name, kind: "url", enabled: true, source, url: url.toString() };
      setWorkspacePlugins((current) => [...current, plugin]); setView(`plugin:${id}`);
      setPluginName("");
    } catch (error) { showToast(error instanceof Error ? error.message : String(error)); }
  }, [nativeBridge, pluginName, pluginUrl, showToast, t]);

  const addDemo = useCallback(async () => addFiles([await createDemoFile()]), [addFiles]);

  return (
    <main
      className={`app-shell ${nativeBridge ? "desktop-app" : "web-app"} ${standalonePreferences ? "preferences-window" : ""}`}
      onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={onDrop}
    >
      <input ref={fileInputRef} className="visually-hidden" type="file" accept="image/*,.jfif" multiple onChange={onFilesSelected} />
      <input ref={(node) => { folderInputRef.current = node; node?.setAttribute("webkitdirectory", ""); }} className="visually-hidden" type="file" accept="image/*,.jfif" multiple onChange={onFolderFilesSelected} />
      <input ref={fontInputRef} className="visually-hidden" type="file" accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2" onChange={onFontSelected} />
      <input ref={pluginInputRef} className="visually-hidden" type="file" accept=".html,.htm,.js,.json,text/html,text/javascript,application/json" onChange={importPlugin} />

      <header className="topbar">
        <div className="brand">
          <button className="brand-home" type="button" onClick={() => standalonePreferences ? void nativeBridge?.hideCurrentWindow() : setView("workspace")}>
            <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>
            <span><strong>PicLite</strong><small>{desktopPreferences.language === "zh" ? "图轻" : "Image Optimiser"}</small></span>
          </button>
          {nativeBridge && <button className="brand-version" type="button" title={t("检查更新并显示结果", "Check for updates and show the result")} aria-label={t(`当前版本 ${APP_VERSION}，检查更新`, `Version ${APP_VERSION}; check for updates`)} disabled={checkingUpdate} onClick={() => void checkForUpdates(true)}>v{APP_VERSION}</button>}
        </div>
        {standalonePreferences ? <div className="standalone-window-title"><span className="eyebrow">PREFERENCES</span><strong>{t("应用设置", "Preferences")}</strong></div> : <nav className="main-nav" aria-label={t("主要功能", "Main navigation")}>
          <button className={view === "workspace" ? "active" : ""} type="button" onClick={() => setView("workspace")}>{t(nativeBridge ? "工作台" : "压缩工作台", "Workspace")}</button>
          {workspacePlugins.find((plugin) => plugin.id === "watcher")?.enabled && <button className={view === "watcher" ? "active" : ""} type="button" onClick={() => setView("watcher")}>{t("文件夹监测", "Folder watch")}{watcherActive && <span className="live-dot" aria-label={t("监测中", "Watching")} />}</button>}
          {workspacePlugins.find((plugin) => plugin.id === "gallery")?.enabled && <button className={view === "gallery" ? "active" : ""} type="button" onClick={() => setView("gallery")}>{t("图库", "Library")}</button>}
          {nativeBridge && workspacePlugins.find((plugin) => plugin.id === "rename")?.enabled && <button className={view === "rename" ? "active" : ""} type="button" onClick={() => setView("rename")}>{t("批量重命名", "Batch rename")}</button>}
          {workspacePlugins.filter((plugin) => plugin.kind !== "builtin" && plugin.enabled).map((plugin) => <button key={plugin.id} className={view === `plugin:${plugin.id}` ? "active" : ""} type="button" onClick={() => setView(`plugin:${plugin.id}`)}>{desktopPreferences.language === "zh" ? plugin.nameZh : plugin.nameEn}</button>)}
        </nav>}
        <div className="topbar-actions">
          {standalonePreferences ? <IconButton label={t("关闭设置窗口", "Close preferences")} symbol="×" onClick={() => void nativeBridge?.hideCurrentWindow()} /> : <>{!nativeBridge && <span className="privacy-badge"><i /> {t("本地处理，图片不上传", "Local processing")}</span>}<span className="topbar-quick-controls">{nativeBridge && <button type="button" className="settings-entry-button" title={t("打开设置", "Open settings")} aria-label={t("打开设置", "Open settings")} onClick={() => void nativeBridge.showPreferencesWindow("general")}><span aria-hidden="true">⚙</span></button>}{nativeBridge && <button type="button" className="floating-entry-button" title={t("打开悬浮压缩窗", "Open floating optimiser")} aria-label={t("打开悬浮压缩窗", "Open floating optimiser")} onClick={() => void nativeBridge.showDropzoneWindow()}><span aria-hidden="true">▣</span></button>}<button type="button" title={t("切换浅色 / 深色主题", "Toggle light / dark theme")} aria-label={t("切换主题", "Toggle theme")} onClick={toggleHeaderTheme}>{resolveTheme(desktopPreferences.theme) === "dark" ? "☀" : "☾"}</button><button type="button" title={t("切换中文 / English", "Switch Chinese / English")} aria-label={t("切换语言", "Switch language")} onClick={toggleHeaderLanguage}>{desktopPreferences.language === "zh" ? "EN" : "中"}</button></span></>}
        </div>
      </header>

      {!nativeBridge && downloadGuideVisible && <aside className="desktop-download-guide" aria-label={t("PicLite 桌面端下载引导", "Download PicLite for desktop")}>
        <span className="download-mark brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>
        <span><strong>{t("桌面端可以监测文件夹和剪贴板", "Watch folders and the clipboard on desktop")}</strong><small>{t("已识别当前系统，可在本机后台自动压缩图片。", "PicLite can optimise images automatically in the background on this device.")}</small></span>
        <button className="download-guide-primary" type="button" onClick={() => openReleasePage()}>{browserDownloadLabel(desktopPreferences.language, browserPlatform)}</button>
        <button className="download-guide-close" type="button" aria-label={t("关闭桌面端下载引导", "Dismiss desktop download guide")} onClick={dismissDownloadGuide}>×</button>
      </aside>}

      {nativeBridge && updateInfo?.available && <aside className="update-notice" role="status">
        <span>↑</span><p><strong>{t(`PicLite ${updateInfo.latestVersion} 已发布`, `PicLite ${updateInfo.latestVersion} is available`)}</strong><small>{t(`当前版本 ${APP_VERSION}，建议更新后继续使用。`, `You are using ${APP_VERSION}. Update to get the latest fixes.`)}</small></p>
        <button type="button" onClick={() => openReleasePage(updateInfo.releaseUrl)}>{t("查看更新", "View update")}</button>
        <button className="update-notice-close" type="button" aria-label={t("暂时关闭更新提醒", "Dismiss update notice")} onClick={() => setUpdateInfo(null)}>×</button>
      </aside>}

      {view === "workspace" ? (
        <section className="workspace" aria-label={t("图片压缩工作台", "Image compression workspace")}>
          <aside className="queue-panel">
            <div className="panel-heading">
              <div><span className="eyebrow">{t("任务队列", "QUEUE")}</span><strong>{importProgress ? (importProgress.total ? t(`正在导入 ${importProgress.current} / ${importProgress.total}`, `Importing ${importProgress.current} / ${importProgress.total}`) : t("正在扫描图片…", "Scanning images…")) : items.length ? t(`${items.length} 张图片`, `${items.length} images`) : t("等待导入", "Ready to import")}</strong></div>
              {items.length > 0 && <button className="text-button" type="button" onClick={clearAll}>{t("清空", "Clear")}</button>}
            </div>

            <div className="import-actions">
              <button className="import-button" type="button" disabled={Boolean(importProgress)} onClick={importImages}><span aria-hidden="true">＋</span> {t("添加图片", "Add images")}</button>
              <button className="folder-import-button" type="button" disabled={Boolean(importProgress)} onClick={importImageFolder}><span aria-hidden="true">▱</span> {t("导入文件夹", "Import folder")}</button>
            </div>

            <div className="queue-list">
              {items.length === 0 ? (
                <div className="queue-empty">
                  <div className="empty-stack" aria-hidden="true"><i /><i /><i /></div>
                  <strong>{t("队列还是空的", "Your queue is empty")}</strong>
                  <p>{t("拖入图片、导入文件夹，或从剪贴板粘贴", "Drop images, import a folder, or paste from the clipboard")}</p>
                  <button type="button" onClick={addDemo}>{t("载入演示图片", "Load a sample image")}</button>
                </div>
              ) : items.map((item) => (
                <button className={`queue-item ${selected?.id === item.id ? "selected" : ""}`} type="button" key={item.id} onClick={() => setSelectedId(item.id)}>
                  <img src={item.sourceUrl} alt="" />
                  <span className="queue-copy">
                    <strong>{item.name}</strong>
                    <small>{item.width} × {item.height} · {formatBytes(item.originalBytes)}</small>
                    <span className={`item-status ${item.status}`}>
                      {item.status === "processing" && t("正在实时试压…", "Testing…")}
                      {item.status === "ready" && t("等待实时试压", "Waiting")}
                      {item.status === "error" && (item.error || t("处理失败", "Failed"))}
                      {item.status === "done" && <><b className={savedPercent(item.originalBytes, item.outputBytes) < 0 ? "larger" : ""}>{sizeChangeLabel(item.originalBytes, item.outputBytes)}</b> {item.keptOriginal ? t("已保留原图", "Original kept") : formatBytes(item.outputBytes)}</>}
                    </span>
                  </span>
                  <span className="remove-item" role="button" aria-label={`移除 ${item.name}`} onClick={(event) => { event.stopPropagation(); removeItem(item.id); }}>×</span>
                </button>
              ))}
            </div>

            <div className="queue-footer">
              <button className="paste-button" type="button" onClick={importFromClipboard}><span>⌘</span> {t("从剪贴板粘贴", "Paste from clipboard")}</button>
              <small>{t("也可随时按 Ctrl + V", "You can also press Ctrl + V")}</small>
            </div>
          </aside>

          <section className="preview-panel">
            <div className="preview-toolbar">
              <div><span className="eyebrow">{t("画质对比", "VISUAL COMPARISON")}</span><strong>{selected?.name || t("导入一张图片开始", "Import an image to start")}</strong></div>
              {selected && <>
                <div className="preview-mode-tabs" aria-label={t("预览方式", "Preview mode")}>
                  <button className={previewMode === "compare" ? "active" : ""} type="button" onClick={() => setPreviewMode("compare")}>{t("对比", "Compare")}</button>
                  <button className={previewMode === "original" ? "active" : ""} type="button" onClick={() => setPreviewMode("original")}>{t("原图", "Original")}</button>
                  <button className={previewMode === "result" ? "active" : ""} type="button" onClick={() => setPreviewMode("result")}>{t("结果", "Result")}</button>
                </div>
                <div className="preview-tools">
                  <button type="button" aria-label={t("缩小预览", "Zoom out")} onClick={() => setZoom(previewZoom / 1.25)}>−</button>
                  <button className="zoom-readout" type="button" aria-label={t("切换 1:1 实际像素", "View at actual pixels")} title={t("按实际像素查看", "View actual pixels")} onClick={() => { setPreviewFit(false); setPreviewZoom(100); setPreviewPan({ x: 0, y: 0 }); }}>{previewFit ? t("适应", "Fit") : `${previewZoom}%`}</button>
                  <button type="button" aria-label={t("放大预览", "Zoom in")} onClick={() => setZoom(previewZoom * 1.25)}>＋</button>
                  <button className="fit-button" type="button" onClick={() => { setPreviewFit(true); setPreviewZoom(100); setPreviewPan({ x: 0, y: 0 }); }}>{t("适应", "Fit")}</button>
                  <button className="copy-result-button" type="button" disabled={!selected.outputBlob} title={t("复制结果图", "Copy result")} aria-label={t("复制结果图", "Copy result")} onClick={() => void copySelectedResult()}>⧉</button>
                  {nativeBridge && <button className="copy-result-button" type="button" disabled={!selected.outputBlob || uploadingId === selected.id} title={t("上传并复制图片链接", "Upload and copy image URL")} aria-label={t("上传并复制图片链接", "Upload and copy image URL")} onClick={() => void uploadSelectedResult()}>{uploadingId === selected.id ? "···" : "⇧"}</button>}
                </div>
              </>}
            </div>

            <div
              className={`preview-stage ${previewDragRef.current ? "is-panning" : ""}`}
              onPointerDown={startPreviewPan}
              onPointerMove={movePreviewPan}
              onPointerUp={stopPreviewPan}
              onPointerCancel={stopPreviewPan}
              onWheel={zoomPreviewWithWheel}
            >
              {selected ? (
                previewMode === "compare" ? (
                    <div ref={compareRef} className="compare-canvas" aria-label={t("拖动中线查看压缩前后对比", "Drag the divider to compare before and after")}>
                      <div className={`preview-pan-layer ${previewFit ? "fit" : "actual"}`} style={{ transform: `translate3d(${previewPan.x}px, ${previewPan.y}px, 0) scale(${previewZoom / 100})` }}>
                        <img className="compare-after" src={selected.outputUrl || selected.sourceUrl} alt={t("优化后预览", "Optimised preview")} />
                        <div className="compare-before" style={{ clipPath: `inset(0 ${100 - compare}% 0 0)` }}><img src={selected.sourceUrl} alt={t("原图预览", "Original preview")} /></div>
                        <div
                          className="compare-handle"
                          style={{ left: `${compare}%` }}
                          onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); handleComparePointer(event); }}
                          onPointerMove={(event) => { event.stopPropagation(); if (event.currentTarget.hasPointerCapture(event.pointerId)) handleComparePointer(event); }}
                        ><span>‹ ›</span></div>
                      </div>
                      <span className="compare-label before-label">{t("原图", "Original")} · {formatBytes(selected.originalBytes)}</span>
                      <span className="compare-label after-label">{t("实时结果", "Live result")} · {selected.outputBytes ? formatBytes(selected.outputBytes) : t("计算中", "Calculating")}</span>
                    {selected.outputWidth && (selected.outputWidth !== selected.width || selected.outputHeight !== selected.height) && <div className="preview-scale-note">{t("对比模式会对齐显示尺寸；切到“结果”查看缩小后的真实比例", "Compare aligns both images; switch to Result to inspect the true scaled size")}</div>}
                    {selected.status === "processing" && <div className="processing-overlay"><i /><strong>{t("正在计算真实输出体积", "Calculating actual output size")}</strong></div>}
                  </div>
                ) : (
                  <div className="image-inspector" aria-label={previewMode === "original" ? t("原图预览", "Original preview") : t("结果预览", "Result preview")}>
                    <div className={`actual-image-layer ${previewFit ? "fit" : "actual"}`} style={{ transform: `translate3d(${previewPan.x}px, ${previewPan.y}px, 0) scale(${previewZoom / 100})` }}>
                      <img
                        src={previewMode === "original" ? selected.sourceUrl : selected.outputUrl || selected.sourceUrl}
                        alt={previewMode === "original" ? t("原图预览", "Original preview") : t("优化结果预览", "Optimised result preview")}
                        style={previewFit ? undefined : {
                          width: `${previewMode === "original" ? selected.width : selected.outputWidth || selected.width}px`,
                          height: `${previewMode === "original" ? selected.height : selected.outputHeight || selected.height}px`,
                        }}
                      />
                    </div>
                    <span className="actual-size-badge">{previewMode === "original" ? t("原图", "Original") : t("结果", "Result")} · {previewMode === "original" ? `${selected.width} × ${selected.height}` : `${selected.outputWidth || selected.width} × ${selected.outputHeight || selected.height}`} px</span>
                    {!previewFit && previewZoom === 100 && <span className="pixel-badge">{t("1:1 · 一个图像像素对应一个屏幕像素", "1:1 · one image pixel per screen pixel")}</span>}
                    {selected.status === "processing" && <div className="processing-overlay"><i /><strong>{t("正在计算真实输出体积", "Calculating actual output size")}</strong></div>}
                  </div>
                )
              ) : (
                <button className="hero-dropzone" type="button" onClick={importImages}>
                  <span className="drop-visual" aria-hidden="true"><i className="drop-card one" /><i className="drop-card two" /><i className="drop-card three" /><b>＋</b></span>
                  <span className="hero-copy"><span className="hero-kicker">DROP · PASTE · COMPRESS</span><strong>{t("把图片放轻一点", "Make images lighter")}</strong><p>{t("拖入图片，或从左侧选择图片或文件夹", "Drop images, or choose images or a folder on the left")}</p></span>
                  <span className="supported-formats">JPG&nbsp;&nbsp; PNG&nbsp;&nbsp; WebP&nbsp;&nbsp; GIF</span>
                </button>
              )}
            </div>

            <div className="result-strip">
              <div><span>{t("原始体积", "Original")}</span><strong>{formatBytes(totals.original)}</strong></div>
              <span className="result-arrow">→</span>
              <div><span>{t("当前实时结果", "Result")}</span><strong>{items.some((item) => item.outputBytes) ? formatBytes(totals.output) : "—"}</strong></div>
              <div className={`savings-pill ${totals.saved < 0 ? "larger" : ""}`}><span>{totals.saved < 0 ? t("体积增加", "Larger") : t("共节省", "Saved")}</span><strong>{sizeChangeLabel(totals.original, totals.output)}</strong></div>
              <IconButton label={t("仅导出当前图片", "Export selected image")} symbol="↓" disabled={!selected || exporting} onClick={exportSelected} />
              <button className="export-button" type="button" disabled={!items.length || exporting} onClick={exportAll}><span>↓</span> {exporting ? t("正在导出", "Exporting") : t("导出全部", "Export all")}</button>
            </div>
          </section>

          <aside className="settings-panel">
            <div className="panel-heading"><div><span className="eyebrow">{t("实时试压", "LIVE TEST")}</span><strong>{t("滑动即预览体积", "Preview output size as you slide")}</strong></div><button className="reset-button" type="button" onClick={() => setSettings(DEFAULT_SETTINGS)}>{t("重置", "Reset")}</button></div>

            <div className="preset-toolbar">
              <div className="select-wrap"><select aria-label={t("压缩预设", "Compression preset")} value={activePresetId} onChange={(event) => {
                const preset = presets.find((candidate) => candidate.id === event.target.value);
                if (preset) applyPreset(preset);
              }}><option value="current">{t("当前参数（自动保存）", "Current settings (saved automatically)")}</option>{presets.map((preset) => <option value={preset.id} key={preset.id}>{preset.custom ? `${t("自定义", "Custom")} · ${preset.name}` : ({ lossless: t("无损优先", "Lossless"), balanced: t("智能平衡", "Smart balance"), small: t("更小体积", "Smaller files") }[preset.id] || preset.name)}</option>)}</select></div>
              <button type="button" title={t("保存当前参数为预设", "Save current settings as a preset")} onClick={() => setPresetDialogOpen(true)}>＋ {t("保存", "Save")}</button>
              {presets.find((preset) => preset.id === activePresetId)?.custom && <button className="preset-delete" type="button" title={t("删除当前预设", "Delete current preset")} onClick={deleteActivePreset}>{t("删除", "Delete")}</button>}
            </div>

            <div className="setting-section">
              <label className="setting-label">{t("快速方案", "Quick modes")}</label>
              <div className="mode-grid">
                {([
                  ["lossless", 100, t("无损优先", "Lossless"), "100%", "◌"],
                  ["balanced", 82, t("智能平衡", "Smart balance"), t("实测候选", "Measured candidates"), "◐"],
                  ["small", 45, t("更小体积", "Smaller files"), t("多档试压", "Multi-pass test"), "●"],
                ] as const).map(([value, quality, label, note, icon]) => (
                  <button className={settings.mode === value ? "active" : ""} type="button" key={value} onClick={() => {
                    const preset = BUILT_IN_PRESETS.find((candidate) => candidate.id === value);
                    if (preset) applyPreset({
                      ...preset,
                      settings: {
                        ...settings,
                        mode: value,
                        quality,
                        scale: preset.settings.scale,
                        format: preset.settings.format,
                        resize: preset.settings.resize,
                        watermark: { ...settings.watermark },
                      },
                    });
                  }}>
                    <span>{icon}</span><strong>{label}</strong><small>{note}</small>
                  </button>
                ))}
              </div>
            </div>

            <div className="setting-section slider-section">
              <div className="slider-heading"><label className="setting-label" htmlFor="quality-range">{t("画质 / 编码质量", "Quality / encoding")}</label><output htmlFor="quality-range">{settings.quality}%</output></div>
              <input
                id="quality-range"
                className="compression-range"
                type="range"
                min="1"
                max="100"
                step="1"
                value={settings.quality}
                style={{ "--range-progress": `${settings.quality}%` } as CSSProperties}
                onChange={(event) => {
                  const quality = Number(event.target.value);
                  setSettings((current) => ({ ...current, quality, mode: modeFromQuality(quality) }));
                }}
              />
              <div className="range-labels"><span>{t("更小文件", "Smaller file")}</span><span>{t("更多细节", "More detail")}</span></div>
              <div className={`live-size-card ${selected?.status === "processing" ? "calculating" : ""}`}>
                <span><i /> {t("实时试压结果", "Live result")}</span>
                <strong>{selected?.status === "processing" ? t("计算中…", "Calculating…") : selected?.outputBytes ? formatBytes(selected.outputBytes) : t("导入图片后显示", "Shown after import")}</strong>
                <small>{selected?.outputBytes ? selected.keptOriginal ? selected.strategy || t("所有候选都更大，已保留原图", "Every candidate was larger; original kept") : selected.strategy ? `${formatBytes(selected.originalBytes)} → ${formatBytes(selected.outputBytes)} · ${t("智能选择", "Smart choice")} ${selected.strategy}` : selected.sizeGuardQuality ? `${formatBytes(selected.originalBytes)} → ${formatBytes(selected.outputBytes)} · ${t("已自动调整编码质量至", "Quality adjusted to")} ${selected.sizeGuardQuality}%` : `${formatBytes(selected.originalBytes)} → ${formatBytes(selected.outputBytes)} · ${savedPercent(selected.originalBytes, selected.outputBytes) >= 0 ? t("节省", "Saved") : t("增加", "Larger")} ${Math.abs(savedPercent(selected.originalBytes, selected.outputBytes))}%` : t("显示的是本机实际编码后的文件大小", "Actual local encoding result")}</small>
              </div>
              <p className="setting-hint"><i /> {t("智能平衡会实测多档画质/尺寸并选择较小结果。PNG 在 100% 时保持真彩无损，低于 100% 时通过调色板减色压缩；JPG / WebP 调整编码质量，GIF 调整每帧色板。", "Smart balance measures several quality/scale candidates and chooses a smaller result. PNG is true-colour lossless at 100%; below 100% it uses palette reduction. JPG/WebP use encoding quality and GIF adjusts its frame palette.")}</p>
            </div>

            <div className="setting-section target-size-section">
              <div className="slider-heading"><label className="setting-label" htmlFor="target-size-input">{t("目标文件大小", "Target file size")}</label><output htmlFor="target-size-input">{settings.targetSizeKb > 0 ? `≤ ${settings.targetSizeKb} KB` : t("不限", "Unlimited")}</output></div>
              <div className="target-size-presets" aria-label={t("目标文件大小预设", "Target size presets")}>
                {[0, 200, 100, 50].map((size) => <button className={settings.targetSizeKb === size ? "active" : ""} type="button" key={size} onClick={() => setSettings((current) => ({ ...current, targetSizeKb: size }))}>{size ? `${size} KB` : t("不限", "Unlimited")}</button>)}
              </div>
              <label className="target-size-custom" htmlFor="target-size-input"><span>{t("自定义上限", "Custom limit")}</span><input id="target-size-input" type="number" inputMode="numeric" min="1" max="102400" step="1" value={settings.targetSizeKb || ""} placeholder={t("输入大小", "Enter size")} onChange={(event) => setSettings((current) => ({ ...current, targetSizeKb: event.target.value ? Math.max(1, Math.min(102400, Math.round(Number(event.target.value)))) : 0 }))} /><b>KB</b></label>
              <p className="setting-hint"><i /> {t("会按真实编码结果逐步调整画质；仍超出上限时再等比例缩小尺寸。原图已符合上限且没有其他改动时会直接保留。", "PicLite measures real encoded output and adjusts quality first, then scales dimensions only if needed. An already-compliant original is kept when no other changes are requested.")}</p>
            </div>

            <div className="setting-section slider-section">
              <div className="slider-heading"><label className="setting-label" htmlFor="scale-range">{t("等比例尺寸", "Scale")}</label><output htmlFor="scale-range">{formatScale(settings.scale)}</output></div>
              <input
                id="scale-range"
                className="compression-range scale-range"
                type="range"
                min="0.1"
                max="100"
                step="0.1"
                value={settings.scale}
                style={{ "--range-progress": `${settings.scale}%` } as CSSProperties}
                onChange={(event) => setSettings((current) => ({ ...current, scale: Number(event.target.value) }))}
              />
              <div className="range-labels"><span>{t("0.1% · 极小", "0.1% · tiny")}</span><span>{t("100% · 原尺寸", "100% · original")}</span></div>
              <div className="scale-presets">
                {[100, 50, 25, 10].map((scale) => <button className={settings.scale === scale ? "active" : ""} type="button" key={scale} onClick={() => setSettings((current) => ({ ...current, scale }))}>{scale}%</button>)}
                <button type="button" onClick={() => setSettings((current) => ({ ...current, scale: Math.max(0.1, Math.round(current.scale * 5) / 10) }))}>{t("继续减半", "Halve again")}</button>
              </div>
              <div className="dimension-preview"><span>{t("预计像素", "Estimated pixels")}</span><strong>{selectedTarget ? `${selectedTarget.width} × ${selectedTarget.height} px` : t("导入图片后显示", "Shown after import")}</strong></div>
              <p className="setting-hint">{t("可反复继续减半，始终从原图生成；最小会收敛到 1 × 1 像素。", "You can keep halving from the original; the minimum converges at 1 × 1 px.")}</p>
            </div>

            <div className="setting-section">
              <label className="setting-label" htmlFor="output-format">{t("输出格式", "Output format")}</label>
              <div className="select-wrap">
                <select id="output-format" value={settings.format} onChange={(event) => setSettings((current) => ({ ...current, format: event.target.value as OutputFormat }))}>
                  <option value="keep">{t("保持原格式", "Keep original")}</option>
                  <option value="image/jpeg">{t("JPG · 适合照片", "JPG · photos")}</option>
                  <option value="image/png">{t("PNG · 透明 / 100% 无损", "PNG · alpha / lossless at 100%")}</option>
                  <option value="image/webp">{t("WebP · 适合网页", "WebP · web")}</option>
                </select>
              </div>
            </div>

            <div className="setting-section">
              <div className="label-row"><label className="setting-label" htmlFor="resize-toggle">{t("最大像素边界（可选）", "Maximum pixels (optional)")}</label><button id="resize-toggle" className={`switch ${settings.resize ? "on" : ""}`} type="button" role="switch" aria-checked={settings.resize} onClick={() => setSettings((current) => ({ ...current, resize: !current.resize }))}><i /></button></div>
              <div className={`dimension-grid ${settings.resize ? "" : "disabled"}`}>
                <label>{t("最大宽度", "Max width")} <span><input type="number" min="1" value={settings.width} disabled={!settings.resize} onChange={(event) => setSettings((current) => ({ ...current, width: Number(event.target.value) }))} /> px</span></label>
                <button className={settings.lockRatio ? "locked" : ""} type="button" disabled={!settings.resize} aria-label={t("锁定宽高比", "Lock aspect ratio")} onClick={() => setSettings((current) => ({ ...current, lockRatio: !current.lockRatio }))}>↕</button>
                <label>{t("最大高度", "Max height")} <span><input type="number" min="1" value={settings.height} disabled={!settings.resize} onChange={(event) => setSettings((current) => ({ ...current, height: Number(event.target.value) }))} /> px</span></label>
              </div>
              <p className="setting-hint">{t("会与上方比例同时生效，且不会放大小图；开启 ↕ 时保持原始宽高比。", "Works with scale above and never enlarges small images. ↕ keeps the original aspect ratio.")}</p>
            </div>

            <div className="setting-section watermark-section">
              <div className="label-row"><label className="setting-label" htmlFor="watermark-toggle">{t("文字水印", "Text watermark")}</label><button id="watermark-toggle" className={`switch ${settings.watermark.enabled ? "on" : ""}`} type="button" role="switch" aria-checked={settings.watermark.enabled} onClick={() => setSettings((current) => ({ ...current, watermark: { ...current.watermark, enabled: !current.watermark.enabled } }))}><i /></button></div>
              {settings.watermark.enabled && <div className="watermark-controls">
                <input className="watermark-text-input" aria-label={t("水印文字", "Watermark text")} value={settings.watermark.text} placeholder={t("输入水印文字", "Enter watermark text")} onChange={(event) => setSettings((current) => ({ ...current, watermark: { ...current.watermark, text: event.target.value } }))} />
                <div className="segmented-control" aria-label={t("水印铺设方式", "Watermark layout")}>
                  <button className={settings.watermark.layout === "tile" ? "active" : ""} type="button" onClick={() => setSettings((current) => ({ ...current, watermark: { ...current.watermark, layout: "tile" } }))}>{t("全屏重复", "Tile")}</button>
                  <button className={settings.watermark.layout === "single" ? "active" : ""} type="button" onClick={() => setSettings((current) => ({ ...current, watermark: { ...current.watermark, layout: "single" } }))}>{t("单点定位", "Position")}</button>
                </div>
                <div className="font-picker-row">
                  <div className="select-wrap"><select aria-label={t("水印字体", "Watermark font")} value={settings.watermark.fontFamily} onChange={(event) => void selectSystemFont(event.target.value)}>{localFonts.map((font) => <option value={font} key={font} style={{ fontFamily: `"${font.replaceAll('"', "")}"` }}>{font}</option>)}</select></div>
                  <button type="button" onClick={() => void loadSystemFonts()}>{t("系统字体", "System fonts")}</button>
                  <button type="button" onClick={() => fontInputRef.current?.click()}>{t("导入字体", "Import font")}</button>
                </div>
                <label className="mini-range"><span>{t("字号", "Font size")} <b>{settings.watermark.fontScale.toFixed(1)}%</b></span><input type="range" min="1" max="20" step="0.5" value={settings.watermark.fontScale} onChange={(event) => setSettings((current) => ({ ...current, watermark: { ...current.watermark, fontScale: Number(event.target.value) } }))} /></label>
                <label className="mini-range"><span>{t("方向", "Angle")} <b>{settings.watermark.rotation}°</b></span><input type="range" min="-180" max="180" step="1" value={settings.watermark.rotation} onChange={(event) => setSettings((current) => ({ ...current, watermark: { ...current.watermark, rotation: Number(event.target.value) } }))} /></label>
                {settings.watermark.layout === "tile" ? <label className="mini-range"><span>{t("铺设密度（越低越稀疏）", "Tile density (lower is sparser)")} <b>{settings.watermark.density}%</b></span><input type="range" min="0" max="100" step="1" value={settings.watermark.density} onChange={(event) => setSettings((current) => ({ ...current, watermark: { ...current.watermark, density: Number(event.target.value) } }))} /></label> : <>
                  <label className="mini-range"><span>{t("水平位置", "Horizontal position")} <b>{settings.watermark.positionX}%</b></span><input type="range" min="0" max="100" step="1" value={settings.watermark.positionX} onChange={(event) => setSettings((current) => ({ ...current, watermark: { ...current.watermark, positionX: Number(event.target.value) } }))} /></label>
                  <label className="mini-range"><span>{t("垂直位置", "Vertical position")} <b>{settings.watermark.positionY}%</b></span><input type="range" min="0" max="100" step="1" value={settings.watermark.positionY} onChange={(event) => setSettings((current) => ({ ...current, watermark: { ...current.watermark, positionY: Number(event.target.value) } }))} /></label>
                </>}
                <div className="watermark-color-row"><label>{t("文字色", "Text color")} <input type="color" value={settings.watermark.color} onChange={(event) => setSettings((current) => ({ ...current, watermark: { ...current.watermark, color: event.target.value } }))} /></label><label className="mini-range"><span>{t("透明度", "Opacity")} <b>{settings.watermark.opacity}%</b></span><input type="range" min="1" max="100" step="1" value={settings.watermark.opacity} onChange={(event) => setSettings((current) => ({ ...current, watermark: { ...current.watermark, opacity: Number(event.target.value) } }))} /></label></div>
                <div className="shadow-row"><label><input type="checkbox" checked={settings.watermark.shadow} onChange={(event) => setSettings((current) => ({ ...current, watermark: { ...current.watermark, shadow: event.target.checked } }))} /> {t("阴影", "Shadow")}</label>{settings.watermark.shadow && <><input aria-label={t("阴影颜色", "Shadow color")} type="color" value={settings.watermark.shadowColor} onChange={(event) => setSettings((current) => ({ ...current, watermark: { ...current.watermark, shadowColor: event.target.value } }))} /><label className="mini-range"><span>{t("模糊", "Blur")} <b>{settings.watermark.shadowBlur}px</b></span><input type="range" min="0" max="40" step="1" value={settings.watermark.shadowBlur} onChange={(event) => setSettings((current) => ({ ...current, watermark: { ...current.watermark, shadowBlur: Number(event.target.value) } }))} /></label></> }</div>
              </div>}
            </div>

            <div className="setting-section compact">
              <label className="check-row"><input type="checkbox" checked={settings.stripMetadata} onChange={(event) => setSettings((current) => ({ ...current, stripMetadata: event.target.checked }))} /><span><strong>{t("移除隐私元数据", "Strip private metadata")}</strong><small>{t("删除位置、相机与拍摄信息", "Remove location, camera and capture details")}</small></span></label>
              {!nativeBridge && <label className="check-row secondary-check"><input type="checkbox" checked={settings.preventLarger} onChange={(event) => setSettings((current) => ({ ...current, preventLarger: event.target.checked }))} /><span><strong>{t("避免无意义地变大", "Avoid unnecessary size increases")}</strong><small>{t("普通优化会保留更小的原图；明确改格式、尺寸或水印时始终按设置输出", "Keep the smaller original for ordinary optimisation; explicit format, resize, or watermark changes are always honoured")}</small></span></label>}
            </div>

            <div className={`setting-section export-settings ${nativeBridge ? "desktop-hidden-setting" : ""}`}>
              <label className="setting-label" htmlFor="export-mode">{t("导出位置", "Export location")}</label>
              <div className="select-wrap"><select id="export-mode" value={exportMode} onChange={(event) => setExportMode(event.target.value as ExportMode)}><option value="download">{t("浏览器下载", "Browser download")}</option><option value="overwrite">{t("覆盖源文件", "Replace original")}</option><option value="same-folder">{t("原文件夹重命名", "Rename in original folder")}</option><option value="fixed-folder">{t("固定文件夹", "Fixed folder")}</option></select></div>
              {exportMode !== "overwrite" && <label className="suffix-input">{t("文件名后缀", "Filename suffix")}<input value={exportSuffix} onChange={(event) => setExportSuffix(event.target.value)} placeholder="-piclite" /></label>}
              {(exportMode === "fixed-folder" || (!nativeBridge && exportMode === "same-folder")) && <button className="folder-picker-button" type="button" onClick={chooseExportFolder}><span>⌑</span><strong>{exportFolderName || (exportMode === "same-folder" ? t("授权原文件夹", "Authorise original folder") : t("选择固定文件夹", "Choose fixed folder"))}</strong><b>{t("选择", "Choose")}</b></button>}
              <p className={`setting-hint ${exportMode === "overwrite" ? "warning" : ""}`}>{exportMode === "download" && t("使用浏览器下载，不需要文件夹权限。", "Downloads through the browser and requires no folder permission.")}{exportMode === "overwrite" && t("会直接替换原图且无法撤销；仅支持保持原格式，并要求从“添加图片”导入。", "Replaces originals and cannot be undone. This requires keeping the original format and importing with Add images.")}{exportMode === "same-folder" && (nativeBridge ? t("桌面端会在每张源图旁输出重命名文件。", "The desktop app saves a renamed result next to each source image.") : t("网页无法自动获知父文件夹，需要手动授权一次目标文件夹。", "The web app needs one-time permission for the destination folder."))}{exportMode === "fixed-folder" && t("所有处理结果写入指定文件夹。", "All results are written to the selected folder.")}</p>
            </div>

            <div className="settings-spacer" />
            <div className="action-summary"><div><span>{t("当前选中", "Selected")}</span><strong>{selected?.outputBytes ? formatBytes(selected.outputBytes) : "—"}</strong></div><div><span>{t("输出参数", "Output settings")}</span><strong>{settings.quality}% · {formatScale(settings.scale)}{settings.targetSizeKb > 0 ? ` · ≤ ${settings.targetSizeKb} KB` : ""}</strong></div></div>
            <button className="compress-button" type="button" disabled={!items.length || processingAll} onClick={processAll}><span>{processingAll ? "···" : "✦"}</span>{processingAll ? t("正在应用到全部", "Applying to all…") : t(`按此参数应用到全部${items.length ? ` · ${items.length} 张` : ""}`, `Apply these settings to all${items.length ? ` · ${items.length}` : ""}`)}</button>
          </aside>
        </section>
      ) : view === "rename" ? (
        <BatchRenamePage bridge={nativeBridge} language={desktopPreferences.language} />
      ) : view === "watcher" ? (
        <section className="watcher-page">
          <div className="watcher-intro">
            <span className="section-index">02 / AUTO FLOW</span>
            <h1>{t("放进文件夹，", "Drop into a folder,")}<br />{t("自动", "automatically ")}<span>{t("变轻。", "optimised.")}</span></h1>
            <p>{t("PicLite 会静默监测新图片，优化后写入指定位置，源文件默认保持不变。", "PicLite quietly watches for new images, optimises them and writes results to the chosen location. Originals stay untouched by default.")}</p>
            <div className="watcher-platform"><span className={nativeBridge ? "available" : ""}>{nativeBridge ? t(`● ${desktopPlatform} 客户端已连接`, `● ${desktopPlatform} app connected`) : t("◫ 需要桌面客户端", "◫ Desktop app required")}</span><small>{t("网页端受浏览器安全限制，无法持续读取本地文件夹", "Browsers cannot continuously watch local folders due to security restrictions")}</small></div>
          </div>

          <div className={`watcher-console ${!nativeBridge ? "locked" : ""}`}>
            {!nativeBridge && (
              <div className="console-lock"><span>▣</span><strong>{t("在桌面客户端中启用", "Available in the desktop app")}</strong><p>{t("网页压缩工作台仍可完整使用；文件夹监测需要桌面版。", "The web workbench remains available; folder watching requires the desktop app.")}</p></div>
            )}
            <div className="console-header"><div><i className={watcherActive ? "active" : ""} /><span>{watcherActive ? "MONITORING" : "READY"}</span></div><small>{t("本地自动化", "Local automation")}</small></div>
            <div className="watcher-taskbar">
              <div className="watcher-task-tabs">{watchProfiles.map((profile) => <button className={selectedWatchProfileId === profile.id ? "active" : ""} type="button" key={profile.id} onClick={() => selectWatchProfile(profile)}><i className={profile.enabled ? "on" : ""} />{profile.name}</button>)}<button className={!selectedWatchProfileId ? "active add" : "add"} type="button" onClick={createWatchProfile}>＋ {t("新任务", "New task")}</button></div>
              {selectedWatchProfileId && <div className="watcher-task-actions"><button type="button" onClick={() => { const profile = watchProfiles.find((item) => item.id === selectedWatchProfileId); if (profile) void toggleWatchProfile(profile); }}>{watchProfiles.find((item) => item.id === selectedWatchProfileId)?.enabled ? t("暂停此任务", "Pause task") : t("启用此任务", "Enable task")}</button><button className="danger" type="button" onClick={() => { const profile = watchProfiles.find((item) => item.id === selectedWatchProfileId); if (profile) void removeWatchProfile(profile); }}>{t("移除", "Remove")}</button></div>}
            </div>
            <div className="watcher-quick-action"><button type="button" disabled={!nativeBridge} onClick={useSuggestedScreenshotFolder}>⌁ {t("使用系统截图文件夹", "Use screenshot folder")}</button><small>{t("每个任务可以使用不同目录和处理规则", "Each task can use its own folder and processing rules")}</small></div>
            <div className="folder-route">
              <button type="button" onClick={() => chooseFolder("input")} disabled={!nativeBridge}>
                <span className="folder-icon">⌑</span><small>{t("监测文件夹", "Watch folder")}</small><strong>{watcherSettings.inputFolder || t("选择来源文件夹", "Choose source folder")}</strong><b>{t("选择", "Choose")}</b>
              </button>
              <div className="route-line"><i /><i /><i /><span>{t("自动优化", "Auto optimise")}</span></div>
              <button type="button" onClick={() => chooseFolder("output")} disabled={!nativeBridge}>
                <span className="folder-icon output">⌑</span><small>{t("输出文件夹", "Output folder")}</small><strong>{watcherSettings.outputFolder || t("默认：来源/PicLite", "Default: Source/PicLite")}</strong><b>{t("选择", "Choose")}</b>
              </button>
            </div>

            <div className="watcher-options">
              <label><span>{t("压缩方案", "Optimisation mode")}</span><select value={watcherSettings.mode} disabled={!nativeBridge} onChange={(event) => {
                const mode = event.target.value as CompressionMode;
                const quality = mode === "lossless" ? 100 : mode === "balanced" ? 82 : 45;
                setWatcherSettings((current) => ({ ...current, mode, quality }));
              }}><option value="lossless">{t("无损优先", "Lossless")}</option><option value="balanced">{t("智能平衡", "Smart balance")}</option><option value="small">{t("更小体积", "Smaller files")}</option></select></label>
              <label><span>{t("输出格式", "Output format")}</span><select value={watcherSettings.format} disabled={!nativeBridge} onChange={(event) => setWatcherSettings((current) => ({ ...current, format: event.target.value as OutputFormat }))}><option value="keep">{t("保持原格式", "Keep original")}</option><option value="image/jpeg">JPG / JFIF</option><option value="image/png">PNG</option><option value="image/webp">WebP</option></select></label>
              <label className="watcher-range"><span>{t("画质", "Quality")} <b>{watcherSettings.quality}%</b></span><input type="range" min="1" max="100" step="1" value={watcherSettings.quality} disabled={!nativeBridge} onChange={(event) => {
                const quality = Number(event.target.value);
                setWatcherSettings((current) => ({ ...current, quality, mode: modeFromQuality(quality) }));
              }} /></label>
              <label className="watcher-range"><span>{t("等比例尺寸", "Scale")} <b>{formatScale(watcherSettings.scale)}</b></span><input type="range" min="0.1" max="100" step="0.1" value={watcherSettings.scale} disabled={!nativeBridge} onChange={(event) => setWatcherSettings((current) => ({ ...current, scale: Number(event.target.value) }))} /></label>
              <label className="watcher-check"><input type="checkbox" checked={watcherSettings.stripMetadata} disabled={!nativeBridge} onChange={(event) => setWatcherSettings((current) => ({ ...current, stripMetadata: event.target.checked }))} /><span>{t("移除隐私元数据", "Strip private metadata")}</span></label>
              <label className="watcher-check"><input type="checkbox" checked={watcherSettings.preventLarger} disabled={!nativeBridge} onChange={(event) => setWatcherSettings((current) => ({ ...current, preventLarger: event.target.checked }))} /><span>{t("候选更大时保留原图", "Keep original when candidates are larger")}</span></label>
              <label className="watcher-check"><input type="checkbox" checked={watcherSettings.resize} disabled={!nativeBridge} onChange={(event) => setWatcherSettings((current) => ({ ...current, resize: event.target.checked }))} /><span>{t("限制最大像素尺寸", "Limit maximum pixel dimensions")}</span></label>
              {watcherSettings.resize && <div className="watcher-dimensions"><label>{t("宽", "Width")} <input type="number" min="1" value={watcherSettings.maxWidth} disabled={!nativeBridge} onChange={(event) => setWatcherSettings((current) => ({ ...current, maxWidth: Number(event.target.value) }))} /></label><span>×</span><label>{t("高", "Height")} <input type="number" min="1" value={watcherSettings.maxHeight} disabled={!nativeBridge} onChange={(event) => setWatcherSettings((current) => ({ ...current, maxHeight: Number(event.target.value) }))} /></label><small>px</small></div>}
              <label className="watcher-check"><input type="checkbox" checked={watcherSettings.onlyWhenNeeded ?? false} disabled={!nativeBridge} onChange={(event) => setWatcherSettings((current) => ({ ...current, onlyWhenNeeded: event.target.checked }))} /><span>{t("仅格式或尺寸不符合时处理", "Only process format or size mismatches")}</span></label>
              <label className="watcher-check"><input type="checkbox" checked={watcherSettings.notifyOnComplete ?? true} disabled={!nativeBridge} onChange={(event) => setWatcherSettings((current) => ({ ...current, notifyOnComplete: event.target.checked }))} /><span>{t("处理完成后系统通知", "System notification on completion")}</span></label>
              <label className="watcher-check"><input type="checkbox" checked={watcherSettings.showFloatingResult ?? false} disabled={!nativeBridge} onChange={(event) => setWatcherSettings((current) => ({ ...current, showFloatingResult: event.target.checked }))} /><span>{t("处理完成后弹出悬浮窗", "Show floating result after processing")}</span></label>
              <label className="watcher-check watcher-rename-toggle"><input type="checkbox" checked={Boolean(watcherSettings.folderRename)} disabled={!nativeBridge} onChange={(event) => setWatcherSettings((current) => ({
                ...current,
                folderRename: event.target.checked ? {
                  rootFolder: current.inputFolder,
                  folderPattern: String.raw`[【\[]\s*(\d+)\s*-\s*(\d+)\s*[】\]]`,
                  renameTemplate: "{code}_{name}",
                  firstPadding: 2,
                  secondPadding: 2,
                } : undefined,
              }))} /><span>{t("按父文件夹内容命名输出图片", "Name outputs from parent-folder content")}</span></label>
              {watcherSettings.folderRename && <div className="watcher-rename-options">
                <label><span>{t("父目录匹配规则（正则）", "Parent-folder pattern (regex)")}</span><input value={watcherSettings.folderRename.folderPattern} disabled={!nativeBridge} onChange={(event) => setWatcherSettings((current) => current.folderRename ? ({ ...current, folderRename: { ...current.folderRename, folderPattern: event.target.value } }) : current)} /></label>
                <label><span>{t("输出文件名模板", "Output filename template")}</span><input value={watcherSettings.folderRename.renameTemplate} disabled={!nativeBridge} onChange={(event) => setWatcherSettings((current) => current.folderRename ? ({ ...current, folderRename: { ...current.folderRename, renameTemplate: event.target.value } }) : current)} /><small>{"{code} {name} {folder} {match} {1} {2} {1:initials}"}</small></label>
                <label className="watcher-padding"><span>{t("数字补齐", "Numeric padding")}</span><div><input aria-label={t("第一组补齐位数", "First capture padding")} type="number" min="1" max="12" value={watcherSettings.folderRename.firstPadding} disabled={!nativeBridge} onChange={(event) => setWatcherSettings((current) => current.folderRename ? ({ ...current, folderRename: { ...current.folderRename, firstPadding: Math.max(1, Math.min(12, Number(event.target.value) || 1)) } }) : current)} /><b>+</b><input aria-label={t("第二组补齐位数", "Second capture padding")} type="number" min="1" max="12" value={watcherSettings.folderRename.secondPadding} disabled={!nativeBridge} onChange={(event) => setWatcherSettings((current) => current.folderRename ? ({ ...current, folderRename: { ...current.folderRename, secondPadding: Math.max(1, Math.min(12, Number(event.target.value) || 1)) } }) : current)} /></div></label>
                <small>{t("会向上递归到监控根目录，使用第一个匹配的父文件夹。", "Searches upward to the watch root and uses the first matching parent.")}</small>
              </div>}
            </div>

            <button className="watcher-toggle" type="button" disabled={!nativeBridge || !watcherSettings.inputFolder} onClick={() => void saveWatchProfile()}><span>✓</span>{selectedWatchProfileId ? t("保存并更新监控", "Save and update task") : t("保存并启用任务", "Save and enable task")}</button>
          </div>

          <div className="watcher-log">
            <div className="watcher-log-heading"><span>{t("最近活动", "Recent activity")}</span><small>{watcherEvents.length ? t(`${watcherEvents.length} 条记录`, `${watcherEvents.length} records`) : t("等待新图片", "Waiting for new images")}</small></div>
            {watcherEvents.length ? watcherEvents.map((event) => (
              <div className="log-row" key={event.id}>
                <span className={`log-icon ${event.type}`}>{event.type === "success" ? "✓" : event.type === "error" ? "!" : "•"}</span>
                <span><strong>{event.file || event.message || (event.type === "started" ? t("文件夹监测已启动", "Folder watch started") : t("文件夹监测已停止", "Folder watch stopped"))}</strong><small>{new Date(event.time).toLocaleTimeString(desktopPreferences.language === "en" ? "en-US" : "zh-CN", { hour: "2-digit", minute: "2-digit" })}{event.originalBytes && event.outputBytes ? ` · ${formatBytes(event.originalBytes)} → ${formatBytes(event.outputBytes)}` : ""}</small></span>
                {event.originalBytes && event.outputBytes ? <b className={savedPercent(event.originalBytes, event.outputBytes) < 0 ? "larger" : ""}>{sizeChangeLabel(event.originalBytes, event.outputBytes)}</b> : null}
              </div>
            )) : <div className="log-empty"><span>⌁</span><p>{t("启动监测后，处理记录会出现在这里", "Processing history will appear here after folder watching starts")}</p></div>}
          </div>
        </section>
      ) : view === "gallery" ? (
        <section className="gallery-page" aria-label={t("压缩结果图库", "Optimised image library")}>
          <header className="gallery-hero">
            <div>
              <span className="section-index">03 / RESULT LIBRARY</span>
              <h1>{t("压过的图，", "Your results,")}<br />{t("随手就能", "ready to ")}<span>{t("再用。", "reuse.")}</span></h1>
              <p>{t("优化结果保存在本机图库中；可直接复制图片、定位文件或复制图床链接。", "Optimised results stay in the local library, ready to copy, reveal or upload.")}</p>
            </div>
            <div className="gallery-summary"><strong>{galleryItems.length}</strong><span>{t("张结果图", "results")}</span><button type="button" onClick={() => void refreshGallery()}>↻ {t("刷新", "Refresh")}</button></div>
          </header>

          {galleryItems.length ? (
            <>
            <div className="gallery-bulk-toolbar">
              <button type="button" onClick={() => setGalleryCheckedIds((current) => current.length === galleryItems.length ? [] : galleryItems.map((item) => item.id))}>{galleryCheckedIds.length === galleryItems.length ? t("取消全选", "Clear selection") : t("全选", "Select all")}</button>
              <span>{t(`已选择 ${galleryCheckedIds.length} 张`, `${galleryCheckedIds.length} selected`)}</span>
              <select aria-label={t("批量删除范围", "Bulk delete range")} value={galleryDeleteScope} onChange={(event) => setGalleryDeleteScope(event.target.value as typeof galleryDeleteScope)}>
                <option value="selected">{t("删除勾选项", "Selected entries")}</option>
                <option value="day">{t("删除 24 小时以前", "Older than 24 hours")}</option>
                <option value="week">{t("删除 7 天以前", "Older than 7 days")}</option>
                <option value="month">{t("删除 30 天以前", "Older than 30 days")}</option>
                <option value="all">{t("删除全部记录", "All entries")}</option>
              </select>
              <button className="danger" type="button" onClick={() => void deleteGalleryBatch()}>{t("批量移除", "Remove batch")}</button>
              <small>{t("只删除图库记录，不删除本地图片", "Library records only; local images are kept")}</small>
            </div>
            <div className="gallery-grid">
              {galleryItems.map((record) => (
                <article className={`gallery-card ${gallerySelectedId === record.id ? "selected" : ""} ${galleryCheckedIds.includes(record.id) ? "checked" : ""}`} key={record.id} tabIndex={0} onClick={() => setGallerySelectedId(record.id)} onDoubleClick={() => { setGallerySelectedId(record.id); setGalleryPreviewId(record.id); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setGallerySelectedId(record.id); setGalleryPreviewId(record.id); } }}>
                  <label className="gallery-check" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={galleryCheckedIds.includes(record.id)} onChange={(event) => setGalleryCheckedIds((current) => event.target.checked ? [...new Set([...current, record.id])] : current.filter((id) => id !== record.id))} /><span>{t("选择", "Select")}</span></label>
                  <button className="gallery-preview" type="button" tabIndex={-1} onClick={() => setGallerySelectedId(record.id)} onDoubleClick={() => setGalleryPreviewId(record.id)} aria-label={t(`预览 ${record.name}`, `Preview ${record.name}`)}><img src={record.previewUrl} alt={record.name} /><span>{record.width} × {record.height}</span><em>{t("双击预览", "Double-click to preview")}</em></button>
                  <div className="gallery-card-body">
                    <strong title={record.name}>{record.name}</strong>
                    <small>{new Date(record.createdAt).toLocaleString(desktopPreferences.language === "en" ? "en-US" : "zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} · {formatBytes(record.outputBytes)} · {sizeChangeLabel(record.originalBytes, record.outputBytes)}</small>
                    {record.remoteUrl && <button className="gallery-link" type="button" title={record.remoteUrl} onClick={() => void copyRemoteUrl(record.remoteUrl!)}><span>↗</span><b>{record.remoteUrl}</b><em>{t("复制链接", "Copy URL")}</em></button>}
                    <div className="gallery-actions">
                      <button type="button" onClick={() => void copyGalleryResult(record)}>⧉ {t("复制图片", "Copy image")}</button>
                      <button type="button" onClick={() => downloadGalleryResult(record)}>↓ {t("保存文件", "Save file")}</button>
                      {nativeBridge && <button type="button" disabled={uploadingId === record.id} onClick={() => void uploadGalleryResult(record)}>{uploadingId === record.id ? t("上传中…", "Uploading…") : record.remoteUrl ? t("重新上传", "Upload again") : t("⇧ 上传图床", "⇧ Upload")}</button>}
                      {nativeBridge && (record.outputPath || record.sourcePath) && <button type="button" onClick={() => void nativeBridge.revealPath(record.outputPath || record.sourcePath!)}>⌑ {t("定位文件", "Reveal file")}</button>}
                      <button className="danger" type="button" title={t("只删除图库记录，不删除本地文件", "Remove only the library entry, not the local file")} onClick={() => void deleteGalleryResult(record.id)}>{t("移除", "Remove")}</button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
            </>
          ) : (
            <div className="gallery-empty"><span>◫</span><strong>{t("图库还是空的", "The library is empty")}</strong><p>{t("工作台、导出或悬浮结果生成的图片会出现在这里。", "Images created by the workbench, exports or floating results will appear here.")}</p><button type="button" onClick={() => setView("workspace")}>{t("去压缩图片", "Optimise images")}</button></div>
          )}
        </section>
      ) : view.startsWith("plugin:") ? (
        <section className="plugin-workspace" aria-label={t("插件工作台", "Plugin workbench")}>
          {(() => { const plugin = workspacePlugins.find((item) => `plugin:${item.id}` === view); if (!plugin) return null; return <><header><div><span className="section-index">PLUGIN / TRUSTED RUNTIME</span><h1>{desktopPreferences.language === "zh" ? plugin.nameZh : plugin.nameEn}</h1></div><button type="button" onClick={() => { if (nativeBridge) void nativeBridge.showPreferencesWindow("plugins"); else { setPreferenceSection("plugins"); setView("preferences"); } }}>{t("管理插件", "Manage plugins")}</button></header><PluginRuntime plugin={plugin} bridge={nativeBridge} language={desktopPreferences.language} theme={resolveTheme(desktopPreferences.theme)} /></>; })()}
        </section>
      ) : (
        <section className="preferences-page clop-preferences" aria-label={t("PicLite 应用设置", "PicLite preferences")}>
          <aside className="preferences-sidebar">
            <div className="preferences-sidebar-title"><span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span><strong>{t("设置", "Settings")}</strong></div>
            <nav aria-label={t("设置分类", "Preference categories")}>
              {([
                ["general", "⚙", t("通用", "General")],
                ["clipboard", "▣", t("剪贴板", "Clipboard")],
                ["files", "▱", t("文件处理", "File handling")],
                ["images", "▧", t("图片", "Images")],
                ["dropzone", "◫", t("拖放区域", "Drop Zone")],
                ["floating", "▤", t("悬浮结果", "Floating Results")],
                ["hosting", "⇧", t("图床上传", "Image Hosting")],
                ["plugins", "◇", t("插件", "Plugins")],
                ["shortcuts", "⌘", t("快捷键", "Keyboard Shortcuts")],
                ["about", "ⓘ", t("关于", "About")],
              ] as const).map(([value, icon, label]) => <button type="button" key={value} className={preferenceSection === value ? "active" : ""} onClick={() => setPreferenceSection(value)}><span>{icon}</span>{label}</button>)}
            </nav>
            <small>PicLite {APP_VERSION}<br />Tauri 2 · Rust</small>
          </aside>

          <div className="preferences-content clop-preferences-content">
            {preferenceSection === "files" && <section className="preference-card">
              <div className="preference-card-heading"><span>{t("图片文件处理", "Image file handling")}</span><small>{t("默认保存规则", "Default placement")}</small></div>
              <div className="preference-row column">
                <div><strong>{t("优化后文件位置", "Optimised file placement")}</strong><small>{t("工作台、拖放区和监测任务统一使用", "Used by the workbench, drop zone and folder watch")}</small></div>
                <div className="preference-segments">
                  <button className={desktopPreferences.exportMode === "same-folder" ? "active" : ""} type="button" onClick={() => setDesktopPreferences((current) => ({ ...current, exportMode: "same-folder" }))}>{t("源文件旁重命名", "Rename beside original")}</button>
                  <button className={desktopPreferences.exportMode === "fixed-folder" ? "active" : ""} type="button" onClick={() => setDesktopPreferences((current) => ({ ...current, exportMode: "fixed-folder" }))}>{t("固定文件夹", "Fixed folder")}</button>
                  <button className={desktopPreferences.exportMode === "overwrite" ? "danger active" : "danger"} type="button" onClick={() => setDesktopPreferences((current) => ({ ...current, exportMode: "overwrite" }))}>{t("覆盖源文件", "Replace original")}</button>
                </div>
              </div>
              {desktopPreferences.exportMode !== "overwrite" && <div className="preference-row">
                <div><strong>{t("文件名后缀", "Filename suffix")}</strong><small>{t("例如 photo-piclite.jpg", "For example photo-piclite.jpg")}</small></div>
                <input className="preference-input" value={desktopPreferences.exportSuffix} onChange={(event) => setDesktopPreferences((current) => ({ ...current, exportSuffix: event.target.value }))} />
              </div>}
              {desktopPreferences.exportMode !== "overwrite" && <div className="preference-row">
                <div><strong>{t("重命名模板", "Rename template")}</strong><small>{t("支持 {name} {suffix} {date} {time} {datetime} {size} {width} {height} {ext}", "Supports {name} {suffix} {date} {time} {datetime} {size} {width} {height} {ext}")}</small></div>
                <input className="preference-input" value={desktopPreferences.renameTemplate} onChange={(event) => setDesktopPreferences((current) => ({ ...current, renameTemplate: event.target.value }))} placeholder="{name}{suffix}" />
              </div>}
              {desktopPreferences.exportMode === "fixed-folder" && <div className="preference-row">
                <div><strong>{t("固定输出文件夹", "Fixed output folder")}</strong><small>{desktopPreferences.exportFolder || t("尚未选择", "Not selected")}</small></div>
                <button className="preference-action" type="button" onClick={chooseExportFolder}>{t("选择文件夹", "Choose folder")}</button>
              </div>}
              {desktopPreferences.exportMode === "overwrite" && <label className="preference-row clickable"><div><strong>{t("覆盖前再次确认", "Confirm before replacing")}</strong><small>{t("覆盖操作无法撤销", "Replacing a file cannot be undone")}</small></div><button className={`switch ${desktopPreferences.confirmOverwrite ? "on" : ""}`} type="button" role="switch" aria-checked={desktopPreferences.confirmOverwrite} onClick={() => setDesktopPreferences((current) => ({ ...current, confirmOverwrite: !current.confirmOverwrite }))}><i /></button></label>}
            </section>}

            {(preferenceSection === "clipboard" || preferenceSection === "images") && <section className="preference-card">
              <div className="preference-card-heading"><span>{preferenceSection === "clipboard" ? t("剪贴板优化", "Clipboard optimiser") : t("图片优化", "Image optimisation")}</span><small>{t("全局保护策略", "Global safeguards")}</small></div>
              <label className="preference-row clickable">
                <div><strong>{t("避免无意义地变大", "Avoid unnecessary size increases")}</strong><small>{t("普通优化会保留更小的原图；明确改格式、尺寸或水印时始终按设置输出", "Keep the smaller original for ordinary optimisation; explicit format, resize, or watermark changes are always honoured")}</small></div>
                <button className={`switch ${desktopPreferences.preventLarger ? "on" : ""}`} type="button" role="switch" aria-checked={desktopPreferences.preventLarger} onClick={() => setDesktopPreferences((current) => ({ ...current, preventLarger: !current.preventLarger }))}><i /></button>
              </label>
              <label className="preference-row clickable">
                <div><strong>{t("监听剪贴板图片", "Enable clipboard optimiser")}</strong><small>{t("复制新图片后按当前参数自动优化，并把结果放回剪贴板", "Optimise newly copied images with the current settings and copy the result back")}</small></div>
                <button className={`switch ${desktopPreferences.clipboardWatcherEnabled ? "on" : ""}`} type="button" role="switch" aria-checked={desktopPreferences.clipboardWatcherEnabled} onClick={() => setDesktopPreferences((current) => ({ ...current, clipboardWatcherEnabled: !current.clipboardWatcherEnabled }))}><i /></button>
              </label>
            </section>}

            {(preferenceSection === "general" || preferenceSection === "floating") && <section className="preference-card">
              <div className="preference-card-heading"><span>{preferenceSection === "floating" ? t("悬浮结果", "Floating Results") : t("外观与通用", "Appearance and general")}</span><small>{preferenceSection === "floating" ? t("外观与交互", "Appearance and behaviour") : t("窗口、系统与界面偏好", "Window, system and appearance preferences")}</small></div>
              {preferenceSection === "general" && <>
                <label className="preference-row clickable"><div><strong>{t("在任务栏 / Dock 显示", "Show in taskbar / Dock")}</strong><small>{desktopPreferences.showInTaskbarDock ? t("开启后主窗口失焦不隐藏，可从任务栏或 Dock 随时切换回来", "Keep the main window visible after focus changes and return from the taskbar or Dock") : t("关闭后不占用任务栏或 Dock，主窗口失焦时隐藏到托盘 / 菜单栏", "Hide the main window to the tray or menu bar when it loses focus")}</small></div><button className={`switch ${desktopPreferences.showInTaskbarDock ? "on" : ""}`} type="button" role="switch" aria-checked={desktopPreferences.showInTaskbarDock} onClick={() => setDesktopPreferences((current) => ({ ...current, showInTaskbarDock: !current.showInTaskbarDock }))}><i /></button></label>
                <div className="preference-row"><div><strong>{t("自动检查更新", "Automatic update checks")}</strong><small>{t("按设定频率检查 GitHub Releases；手动检查始终显示结果", "Check GitHub Releases at the selected interval; manual checks always show a result")}</small></div><select value={desktopPreferences.updateCheckFrequency} onChange={(event) => { const updateCheckFrequency = event.target.value as UpdateCheckFrequency; setDesktopPreferences((current) => ({ ...current, updateCheckFrequency, autoCheckUpdates: updateCheckFrequency !== "never" })); }}><option value="startup">{t("打开软件时", "When PicLite opens")}</option><option value="daily">{t("每天", "Daily")}</option><option value="weekly">{t("每周", "Weekly")}</option><option value="never">{t("不自动检查", "Never")}</option></select></div>
              </>}
              <div className="preference-row column">
                <div><strong>{t("主题", "Appearance")}</strong><small>{t("可跟随 Windows / macOS 系统外观", "Can follow the Windows or macOS appearance")}</small></div>
                <div className="preference-segments">
                  {([['system', t('跟随系统', 'System')], ['light', t('浅色', 'Light')], ['dark', t('深色', 'Dark')]] as const).map(([value, label]) => <button className={desktopPreferences.theme === value ? "active" : ""} type="button" key={value} onClick={() => setDesktopPreferences((current) => ({ ...current, theme: value }))}>{label}</button>)}
                </div>
              </div>
              <div className="preference-row column">
                <div><strong>{t("界面配色", "Colour theme")}</strong><small>{t("石墨蓝更清爽，也可以随时切回经典绿色", "Graphite is cleaner, and the classic green remains available")}</small></div>
                <div className="palette-picker">
                  {([
                    ['graphite', t('石墨蓝', 'Graphite'), t('克制 · 清晰', 'Neutral · crisp')],
                    ['mist', t('雾蓝', 'Mist blue'), t('轻盈 · 通透', 'Light · airy')],
                    ['violet', t('紫晶', 'Violet'), t('柔和 · 现代', 'Soft · modern')],
                    ['green', t('经典绿', 'Classic green'), t('原有品牌色', 'Original palette')],
                  ] as const).map(([value, label, note]) => <button className={`palette-choice ${value} ${desktopPreferences.colorTheme === value ? "active" : ""}`} type="button" key={value} aria-pressed={desktopPreferences.colorTheme === value} onClick={() => setDesktopPreferences((current) => ({ ...current, colorTheme: value }))}><span className="palette-swatch" aria-hidden="true"><i /><i /><i /></span><span><strong>{label}</strong><small>{note}</small></span></button>)}
                </div>
              </div>
              <div className="preference-row column">
                <div><strong>{t("语言 / Language", "Language / 语言")}</strong><small>{t("切换全部界面和常用操作的显示语言", "Switch the language used throughout PicLite")}</small></div>
                <div className="preference-segments">
                  <button className={desktopPreferences.language === "zh" ? "active" : ""} type="button" onClick={() => setDesktopPreferences((current) => ({ ...current, language: "zh" }))}>中文</button>
                  <button className={desktopPreferences.language === "en" ? "active" : ""} type="button" onClick={() => setDesktopPreferences((current) => ({ ...current, language: "en" }))}>English</button>
                </div>
              </div>
              <div className="preference-row column">
                <div><strong>{t("界面密度", "Interface density")}</strong><small>{t("自动模式优先保证字号清晰", "Auto keeps text readable and tightens only when necessary")}</small></div>
                <div className="preference-segments">
                  {([['auto', t('自动', 'Auto')], ['comfortable', t('标准', 'Comfortable')], ['compact', t('紧凑', 'Compact')]] as const).map(([value, label]) => <button className={desktopPreferences.density === value ? "active" : ""} type="button" key={value} onClick={() => setDesktopPreferences((current) => ({ ...current, density: value }))}>{label}</button>)}
                </div>
              </div>
              <div className="preference-row column">
                <div><strong>{t("悬浮结果主题", "Floating result appearance")}</strong><small>{t("可以独立于主窗口选择主题", "Can use a different appearance from the main window")}</small></div>
                <div className="preference-segments">
                  {([['system', t('跟随系统', 'System')], ['light', t('浅色', 'Light')], ['dark', t('深色', 'Dark')]] as const).map(([value, label]) => <button className={desktopPreferences.dockTheme === value ? "active" : ""} type="button" key={value} onClick={() => setDesktopPreferences((current) => ({ ...current, dockTheme: value }))}>{label}</button>)}
                </div>
              </div>
              {preferenceSection === "floating" && <label className="preference-row clickable"><div><strong>{t("允许截图 / 录屏捕获", "Allow screenshot / recording capture")}</strong><small>{desktopPreferences.allowFloatingCapture ? t("悬浮窗会出现在系统截图和录屏中", "The floating window can appear in screenshots and recordings") : t("系统截图和录屏会隐藏悬浮窗；部分第三方工具可能不遵守", "OS screenshots and recordings hide the floating window; some third-party tools may ignore this")}</small></div><button className={`switch ${desktopPreferences.allowFloatingCapture ? "on" : ""}`} type="button" role="switch" aria-checked={desktopPreferences.allowFloatingCapture} onClick={() => setDesktopPreferences((current) => ({ ...current, allowFloatingCapture: !current.allowFloatingCapture }))}><i /></button></label>}
              <div className="preference-row column">
                <div><strong>{t("悬浮结果布局", "Floating result layout")}</strong><small>{t("选择紧凑或完整图片卡片", "Choose compact or full image cards")}</small></div>
                <div className="preference-segments">
                  {([['compact', t('紧凑', 'Compact')], ['full', t('完整', 'Full')]] as const).map(([value, label]) => <button className={desktopPreferences.dockLayout === value ? "active" : ""} type="button" key={value} onClick={() => setDesktopPreferences((current) => ({ ...current, dockLayout: value }))}>{label}</button>)}
                </div>
              </div>
              <label className="preference-row"><div><strong>{t("结果自动收起", "Dismiss result after")}</strong><small>{t("设为 0 秒则不自动收起", "Set to 0 to keep results visible")}</small></div><span className="preference-number"><input type="number" min="0" max="120" step="1" value={desktopPreferences.floatingResultSeconds} onChange={(event) => setDesktopPreferences((current) => ({ ...current, floatingResultSeconds: Math.max(0, Math.min(120, Number(event.target.value) || 0)) }))} /> {t("秒", "sec")}</span></label>
            </section>}

            {preferenceSection === "hosting" && <section className="preference-card upload-preference-card">
              <div className="preference-card-heading"><span>{t("图床上传", "Image hosting")}</span><small>WebDAV · S3 · R2 · OSS · FTP · SFTP</small></div>
              <div className="preference-row column">
                <div><strong>{t("服务类型", "Provider")}</strong><small>{t("从工作台或图库直接上传并复制链接", "Upload from the workbench or library and copy the URL")}</small></div>
                <div className="preference-segments upload-provider-segments">
                  {([['webdav', 'WebDAV'], ['s3', 'S3 / MinIO'], ['r2', 'Cloudflare R2'], ['oss', '阿里云 OSS'], ['ftp', 'FTP'], ['sftp', 'SFTP']] as const).map(([value, label]) => <button className={uploadSettings.provider === value ? "active" : ""} type="button" key={value} onClick={() => setUploadSettings((current) => ({ ...current, provider: value, region: value === "r2" ? "auto" : value === "s3" && current.region === "auto" ? "us-east-1" : current.region, port: value === "ftp" ? 21 : value === "sftp" ? 22 : current.port }))}>{label}</button>)}
                </div>
              </div>
              <div className="upload-grid">
                <label className="upload-field wide"><span>{t("服务地址", "Endpoint")}</span><input type="text" value={uploadSettings.endpoint} placeholder={uploadSettings.provider === "webdav" ? "https://dav.example.com/remote.php/dav/files/user" : uploadSettings.provider === "r2" ? "https://ACCOUNT_ID.r2.cloudflarestorage.com" : uploadSettings.provider === "s3" ? "https://s3.amazonaws.com / https://minio.example.com" : uploadSettings.provider === "oss" ? "https://oss-cn-hangzhou.aliyuncs.com" : "server.example.com"} onChange={(event) => setUploadSettings((current) => ({ ...current, endpoint: event.target.value }))} /></label>
                {(uploadSettings.provider === "s3" || uploadSettings.provider === "r2" || uploadSettings.provider === "oss") && <label className="upload-field"><span>Bucket</span><input type="text" value={uploadSettings.bucket} placeholder="images" onChange={(event) => setUploadSettings((current) => ({ ...current, bucket: event.target.value }))} /></label>}
                {(uploadSettings.provider === "s3" || uploadSettings.provider === "r2") && <label className="upload-field"><span>Region</span><input type="text" value={uploadSettings.region} placeholder={uploadSettings.provider === "r2" ? "auto" : "us-east-1"} onChange={(event) => setUploadSettings((current) => ({ ...current, region: event.target.value }))} /></label>}
                {(uploadSettings.provider === "s3" || uploadSettings.provider === "r2" || uploadSettings.provider === "oss") && <label className="upload-field"><span>Access Key ID</span><input type="text" value={uploadSettings.accessKey} autoComplete="off" onChange={(event) => setUploadSettings((current) => ({ ...current, accessKey: event.target.value }))} /></label>}
                {(uploadSettings.provider === "webdav" || uploadSettings.provider === "ftp" || uploadSettings.provider === "sftp") && <label className="upload-field"><span>{t("用户名", "Username")}</span><input type="text" value={uploadSettings.username} autoComplete="username" onChange={(event) => setUploadSettings((current) => ({ ...current, username: event.target.value }))} /></label>}
                {(uploadSettings.provider === "ftp" || uploadSettings.provider === "sftp") && <label className="upload-field"><span>{t("端口", "Port")}</span><input type="number" min="1" max="65535" value={uploadSettings.port} onChange={(event) => setUploadSettings((current) => ({ ...current, port: Number(event.target.value) }))} /></label>}
                {uploadSettings.provider === "sftp" && <label className="upload-field wide"><span>{t("SSH 私钥路径（可选）", "SSH private key path (optional)")}</span><input type="text" value={uploadSettings.keyPath} placeholder={t("留空时使用密码", "Leave blank to use a password")} onChange={(event) => setUploadSettings((current) => ({ ...current, keyPath: event.target.value }))} /></label>}
                <label className="upload-field"><span>{uploadSettings.provider === "s3" || uploadSettings.provider === "r2" || uploadSettings.provider === "oss" ? "Secret Access Key" : t("密码", "Password")}</span><input type="password" value={uploadSecret} autoComplete="new-password" placeholder={t("保存后下次自动读取", "Saved securely for next launch")} onChange={(event) => setUploadSecret(event.target.value)} /></label>
                {uploadSettings.provider === "s3" && <label className="upload-field upload-check"><input type="checkbox" checked={uploadSettings.pathStyle} onChange={(event) => setUploadSettings((current) => ({ ...current, pathStyle: event.target.checked }))} /><span>{t("使用 Path-style（MinIO / 自建 S3 常用）", "Use path-style URLs (common for MinIO/self-hosted S3)")}</span></label>}
                <label className="upload-field"><span>{t("远端目录", "Remote folder")}</span><input type="text" value={uploadSettings.remotePath} placeholder="piclite" onChange={(event) => setUploadSettings((current) => ({ ...current, remotePath: event.target.value }))} /></label>
                <label className="upload-field wide"><span>{t("公开访问地址（可选）", "Public base URL (optional)")}</span><input type="text" value={uploadSettings.publicBaseUrl} placeholder="https://img.example.com" onChange={(event) => setUploadSettings((current) => ({ ...current, publicBaseUrl: event.target.value }))} /><small>{t("用于生成最终图片链接；留空则返回服务地址。", "Used to build the final image URL; leave blank to use the provider URL.")}</small></label>
              </div>
              <div className="upload-save-row"><p className="upload-security-note"><span>◉</span> {t("配置和凭证保存在当前系统用户的 PicLite 配置目录，不会同步到云端。", "Configuration and credentials stay in the current user's PicLite config directory and are never synced.")}</p><button className="preference-action" type="button" disabled={!nativeBridge} onClick={() => void saveUploadProfile()}>{uploadProfileSaved ? t("✓ 已保存 · 再次保存", "✓ Saved · Save again") : t("保存到本机", "Save locally")}</button></div>
            </section>}

            {(preferenceSection === "general" || preferenceSection === "dropzone") && <section className="preference-card">
              <div className="preference-card-heading"><span>{preferenceSection === "dropzone" ? t("拖放区域", "Drop Zone") : t("系统托盘", "System tray")}</span><small>{t("后台常驻行为", "Background behaviour")}</small></div>
              <label className="preference-row clickable"><div><strong>{t("开机自启动", "Launch at login")}</strong><small>{t("登录系统后静默进入托盘", "Start quietly in the tray after login")}</small></div><button className={`switch ${desktopPreferences.launchAtStartup ? "on" : ""}`} type="button" role="switch" aria-checked={desktopPreferences.launchAtStartup} onClick={() => void toggleAutostart()}><i /></button></label>
              <div className="preference-row"><div><strong>{t("全局拖放区与悬浮结果", "Global drop zone and floating results")}</strong><small>{t("把图片拖到右下角热区，优化结果会继续显示可调操作", "Drop images on the bottom-right target and continue editing the result")}</small></div><button className="preference-action" type="button" onClick={() => void nativeBridge?.showDropzoneWindow()}>{t("立即打开", "Open now")}</button></div>
            </section>}

            {preferenceSection === "plugins" && <section className="preference-card plugin-preference-card">
              <div className="preference-card-heading"><span>{t("工作台插件", "Workbench plugins")}</span><small>{t("HTML / JavaScript 直接在可信插件容器中运行，不再使用 iframe", "HTML / JavaScript runs directly in a trusted plugin container, without iframes")}</small></div>
              {workspacePlugins.map((plugin) => <div className="preference-row plugin-row" key={plugin.id}><div>{plugin.kind === "builtin" ? <strong>{desktopPreferences.language === "zh" ? plugin.nameZh : plugin.nameEn}</strong> : <input className="plugin-name-input" aria-label={t("插件名称", "Plugin name")} value={desktopPreferences.language === "zh" ? plugin.nameZh : plugin.nameEn} onChange={(event) => { const name = event.target.value; setWorkspacePlugins((current) => current.map((item) => item.id === plugin.id ? { ...item, nameZh: name, nameEn: name } : item)); }} />}<small>{plugin.kind === "builtin" ? t("内置插件", "Built-in plugin") : plugin.kind === "url" ? plugin.url : t("本地可信插件", "Local trusted plugin")}</small></div><div className="plugin-row-actions"><button className={`switch ${plugin.enabled ? "on" : ""}`} type="button" role="switch" aria-checked={plugin.enabled} onClick={() => setWorkspacePlugins((current) => current.map((item) => item.id === plugin.id ? { ...item, enabled: !item.enabled } : item))}><i /></button>{plugin.kind !== "builtin" && <button className="preference-action danger" type="button" onClick={() => setWorkspacePlugins((current) => current.filter((item) => item.id !== plugin.id))}>{t("移除", "Remove")}</button>}</div></div>)}
              <div className="plugin-import-panel"><button className="preference-action" type="button" onClick={() => pluginInputRef.current?.click()}>{t("导入 HTML / JS / manifest.json", "Import HTML / JS / manifest.json")}</button><span>{t("或添加网页插件", "or add a web plugin")}</span><input value={pluginName} onChange={(event) => setPluginName(event.target.value)} placeholder={t("自定义插件名称", "Custom plugin name")} /><input value={pluginUrl} onChange={(event) => setPluginUrl(event.target.value)} placeholder="https://banner.xmit.dev/" /><button className="preference-action" type="button" onClick={() => void addUrlPlugin()}>{t("读取并添加", "Fetch and add")}</button></div>
              <p className="plugin-security-note">{t("非 iframe 插件拥有页面脚本执行能力，只安装你信任的 HTML / JavaScript。插件需要宿主能力时可调用 window.PicLitePlugin.post()。", "Non-iframe plugins can execute page scripts. Install only HTML / JavaScript you trust. Plugins can request host capabilities with window.PicLitePlugin.post().")}</p>
            </section>}

            {preferenceSection === "shortcuts" && <section className="preference-card">
              <div className="preference-card-heading"><span>{t("全局快捷键", "Keyboard shortcuts")}</span><small>{t("窗口隐藏后仍然有效", "Available while windows are hidden")}</small></div>
              <label className="preference-row clickable"><div><strong>{t("启用全局快捷键", "Enable global shortcuts")}</strong><small>{t("发生冲突时可以关闭或重新录制", "Disable or record another combination if a shortcut conflicts")}</small></div><button className={`switch ${desktopPreferences.shortcutsEnabled ? "on" : ""}`} type="button" role="switch" aria-checked={desktopPreferences.shortcutsEnabled} onClick={() => setDesktopPreferences((current) => ({ ...current, shortcutsEnabled: !current.shortcutsEnabled }))}><i /></button></label>
              {([
                ["shortcutShow", t("显示主窗口", "Show main window"), t("从任何软件快速唤起 PicLite", "Open PicLite from any application")],
                ["shortcutPaste", t("压缩剪贴板图片", "Optimise clipboard image"), t("不启用剪贴板监听也能立即压缩当前图片，并在悬浮窗显示结果", "Optimise the current image and show the result without enabling clipboard monitoring")],
                ["shortcutDock", t("打开 / 关闭悬浮窗", "Toggle floating window"), t("用同一快捷键显示或隐藏图片优化悬浮窗", "Use the same shortcut to show or hide the floating optimiser")],
                ["shortcutGallery", t("打开图库", "Open library"), t("直接打开本地压缩结果图库", "Open the local result library")],
                ["shortcutUpload", t("上传当前悬浮结果", "Upload current floating result"), t("使用已保存的图床配置上传并复制链接", "Upload with the saved image-host profile and copy the URL")],
              ] as const).map(([preference, title, note]) => <div className="preference-row shortcut-row" key={preference}><div><strong>{title}</strong><small>{note}</small></div><button className={`shortcut-recorder ${recordingShortcut === preference ? "recording" : ""}`} type="button" disabled={!desktopPreferences.shortcutsEnabled} aria-pressed={recordingShortcut === preference} onClick={() => setRecordingShortcut((current) => current === preference ? null : preference)}>{recordingShortcut === preference ? t("请按快捷键…", "Press shortcut…") : shortcutLabel(desktopPreferences[preference], nativeBridge?.platform || "win32")}</button></div>)}
              <p className="shortcut-help">{t("点击组合键后直接按新的按键；Delete 清除，Esc 取消。快捷键必须包含 Ctrl/⌘ 或 Alt。", "Click a shortcut and press a new combination. Delete clears it, Esc cancels. Shortcuts must include Ctrl/⌘ or Alt.")}</p>
            </section>}

            {preferenceSection === "about" && <section className="preference-card about-card">
              <div className="preference-card-heading"><span>{t("关于 PicLite", "About PicLite")}</span><small>{t("版本与运行环境", "Version and runtime")}</small></div>
              <div className="about-product"><span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span><div><strong>PicLite 图轻 · v{APP_VERSION}</strong><small>{t(`更新日期 ${APP_RELEASE_DATE}`, `Updated ${APP_RELEASE_DATE}`)} · Tauri 2 + Rust</small></div><em>OPEN SOURCE</em></div>
              <p>{t("图片在本机处理，不上传到 PicLite 服务器。桌面端使用系统 WebView，因此安装包不携带完整浏览器内核。", "Images are processed locally and are never uploaded to PicLite. The desktop app uses the system WebView instead of bundling a browser engine.")}</p>
              <p className="license-note">{t("PicLite 以 GPL-3.0-or-later 开源；自动化工作流参考 FuzzyIdeas 的 Clop，PicLite 保留独立品牌和跨平台实现。", "PicLite is open source under GPL-3.0-or-later. Its automation workflow is inspired by FuzzyIdeas' Clop while retaining independent branding and a cross-platform implementation.")}</p>
              <div className="about-links"><button type="button" onClick={() => openReleasePage("https://github.com/amiaoapp/PicLite")}>{t("GitHub 项目", "GitHub project")}</button><button type="button" onClick={() => openReleasePage("https://github.com/amiaoapp/PicLite/blob/main/LICENSE")}>{t("GPLv3 许可", "GPLv3 license")}</button><button type="button" onClick={() => showToast(`PicLite ${APP_VERSION} · Tauri 2 + Rust`)}>{t("版本信息", "Version information")}</button><button type="button" disabled={checkingUpdate} onClick={() => void checkForUpdates(true)}>{checkingUpdate ? t("检查中…", "Checking…") : updateInfo?.available ? t(`更新到 ${updateInfo.latestVersion}`, `Update to ${updateInfo.latestVersion}`) : t("检查更新", "Check for updates")}</button></div>
            </section>}
          </div>
        </section>
      )}

      {presetDialogOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPresetDialogOpen(false); }}><form className="preset-dialog" onSubmit={(event) => { event.preventDefault(); saveCustomPreset(); }}><span className="eyebrow">SAVE PRESET</span><h2>{t("保存当前压缩参数", "Save current compression settings")}</h2><p>{t("目标大小、画质、尺寸、格式、元数据和水印会一起保存，下次启动仍然可用。", "Target size, quality, dimensions, format, metadata and watermark settings are saved for future launches.")}</p><input autoFocus value={presetName} maxLength={24} placeholder={t("例如：报名照 200 KB", "For example: application photo 200 KB")} onChange={(event) => setPresetName(event.target.value)} /><div><button type="button" onClick={() => setPresetDialogOpen(false)}>{t("取消", "Cancel")}</button><button className="primary" type="submit" disabled={!presetName.trim()}>{t("保存预设", "Save preset")}</button></div></form></div>}
      {galleryPreview && <div className="gallery-lightbox" role="dialog" aria-modal="true" aria-label={`预览 ${galleryPreview.name}`} onMouseDown={(event) => { if (event.target === event.currentTarget) setGalleryPreviewId(null); }}>
        <header><div><span>QUICK LOOK</span><strong title={galleryPreview.name}>{galleryPreview.name}</strong></div><button type="button" aria-label={t("关闭预览", "Close preview")} title={t("关闭（Esc）", "Close (Esc)")} onClick={() => setGalleryPreviewId(null)}>×</button></header>
        <div className="gallery-lightbox-image"><img src={galleryPreview.previewUrl} alt={galleryPreview.name} /></div>
        <footer><span>{galleryPreview.width} × {galleryPreview.height} · {formatBytes(galleryPreview.outputBytes)} <b>{sizeChangeLabel(galleryPreview.originalBytes, galleryPreview.outputBytes)}</b></span><div><button type="button" title={t("上一张（←）", "Previous (←)")} onClick={() => { const index = galleryItems.findIndex((item) => item.id === galleryPreview.id); const next = galleryItems[(index - 1 + galleryItems.length) % galleryItems.length]; setGallerySelectedId(next.id); setGalleryPreviewId(next.id); }}>←</button><button type="button" onClick={() => void copyGalleryResult(galleryPreview)}>⧉ {t("复制结果图", "Copy result")}</button>{nativeBridge && (galleryPreview.outputPath || galleryPreview.sourcePath) && <button type="button" onClick={() => void nativeBridge.revealPath(galleryPreview.outputPath || galleryPreview.sourcePath!)}>⌑ {t("定位", "Reveal")}</button>}<button type="button" title={t("下一张（→）", "Next (→)")} onClick={() => { const index = galleryItems.findIndex((item) => item.id === galleryPreview.id); const next = galleryItems[(index + 1) % galleryItems.length]; setGallerySelectedId(next.id); setGalleryPreviewId(next.id); }}>→</button></div></footer>
      </div>}
      {dragging && <div className="drag-overlay" onDragLeave={() => setDragging(false)}><div><span>＋</span><strong>{t("松开即可加入图片", "Drop to add images")}</strong><small>{t("支持同时导入多张", "Multiple images supported")}</small></div></div>}
      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}
