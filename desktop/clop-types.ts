export type Language = "zh" | "en";
export type Appearance = "system" | "light" | "dark";
export type ColorTheme = "graphite" | "mist" | "violet" | "green";
export type UpdateCheckFrequency = "startup" | "daily" | "weekly" | "never";
export type ResultLayout = "compact" | "full";
export type ResultDisplayMode = "stack" | "list";
export type FilePlacement = "same-folder" | "fixed-folder";
export type ImageFormat = "keep" | "jpeg" | "png" | "webp";
export type CleanupUnit = "hours" | "days" | "months";
export type FloatingAction = "downscale" | "watermark" | "undo" | "copy" | "preview" | "reveal" | "gallery" | "upload";

export type FloatingWatermark = {
  text: string;
  fontFamily: string;
  fontScale: number;
  color: string;
  opacity: number;
  rotation: number;
  density: number;
  shadow: boolean;
  shadowBlur: number;
  shadowColor: string;
};

export type StoredUploadProfile = {
  provider: "webdav" | "s3" | "r2" | "oss" | "ftp" | "sftp";
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
  secret: string;
};

export type OptimisationPreset = {
  mode: "auto" | "manual";
  quality: number;
  scale: number;
  format: ImageFormat;
  stripMetadata: boolean;
  preventLarger: boolean;
};

export type DesktopSettings = {
  language: Language;
  appearance: Appearance;
  colorTheme: ColorTheme;
  updateCheckFrequency: UpdateCheckFrequency;
  launchAtLogin: boolean;
  showMenubarIcon: boolean;
  showInTaskbarDock: boolean;
  clipboardOptimiser: boolean;
  clipboardImageData: boolean;
  clipboardImageFiles: boolean;
  keepClipboardResults: boolean;
  filePlacement: FilePlacement;
  outputFolder: string;
  outputSuffix: string;
  renameTemplate: string;
  preserveDates: boolean;
  autoCleanupEnabled: boolean;
  autoCleanupAmount: number;
  autoCleanupUnit: CleanupUnit;
  stripMetadata: boolean;
  preserveColorProfile: boolean;
  enableDropZone: boolean;
  dropZoneAtCursor: boolean;
  autoCopyDropResults: boolean;
  batchThreshold: number;
  enableFloatingResults: boolean;
  allowFloatingCapture: boolean;
  floatingLayout: ResultLayout;
  floatingDisplayMode: ResultDisplayMode;
  floatingMaxResults: number;
  floatingCorner: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  floatingWidth: number;
  floatingHeight: number;
  floatingActions: FloatingAction[];
  floatingWatermark: FloatingWatermark;
  autoHideResults: boolean;
  autoHideSeconds: number;
  followCursorScreen: boolean;
  showCopyClearButtons: boolean;
  hideTooltips: boolean;
  watchFolders: string[];
  watchProfiles: WatchProfile[];
  pauseAutomaticOptimisations: boolean;
  shortcutsEnabled: boolean;
  shortcutToggleDropzone: string;
  shortcutOptimiseClipboard: string;
  shortcutShowMain: string;
  shortcutShowGallery: string;
  shortcutUploadCurrent: string;
  preset: OptimisationPreset;
};

export type QuickCompressSettings = {
  mode?: "auto" | "balanced" | "small" | "lossless" | "manual";
  quality: number;
  scale: number;
  format: string;
  stripMetadata: boolean;
  preventLarger: boolean;
  exportMode: string;
  exportSuffix: string;
  renameTemplate?: string;
  fixedFolder?: string;
};

export type QuickCompressResult = {
  source: string;
  output?: string;
  originalBytes?: number;
  outputBytes?: number;
  keptOriginal: boolean;
  error?: string;
};

export type BatchRenameRequest = {
  rootFolder: string;
  folderPattern: string;
  renameTemplate: string;
  firstPadding: number;
  secondPadding: number;
  wordSeparator: string;
};

export type BatchRenameEntry = {
  source: string;
  target: string;
  sourceName: string;
  targetName: string;
  matchedFolder?: string;
  code?: string;
  ready: boolean;
  unchanged: boolean;
  error?: string;
};

export type BatchRenameResult = {
  entries: BatchRenameEntry[];
  matched: number;
  renamed: number;
  skipped: number;
  failed: number;
};

export type CompressedAnimationData = {
  data: Uint8Array;
  mimeType: string;
  extension: string;
  width: number;
  height: number;
  keptOriginal: boolean;
};

export type NativeImageWatermark = {
  data: string;
  imageScale: number;
  opacity: number;
  rotation: number;
  layout: "tile" | "single";
  density: number;
  positionX: number;
  positionY: number;
};

export type NativeAnimationWatermark = {
  kind: "visible" | "blind";
  data: Uint8Array;
  opacity: number;
  text: string;
  blindStrength: number;
};

export type WatchProfile = WatcherSettings & { id: string; name: string; enabled: boolean };

export type WatcherSettings = {
  profiles?: WatcherSettings[];
  folderRename?: BatchRenameRequest;
  onlyWhenNeeded?: boolean;
  notifyOnComplete?: boolean;
  showFloatingResult?: boolean;
  inputFolder: string;
  inputFolders: string[];
  outputFolder: string;
  outputSuffix?: string;
  renameTemplate?: string;
  mode: string;
  quality: number;
  scale: number;
  format: string;
  resize: boolean;
  maxWidth: number;
  maxHeight: number;
  stripMetadata: boolean;
  preventLarger: boolean;
};

export type NativeImage = { name: string; type: string; path: string; data: Uint8Array };

export type PicLiteBridge = {
  platform: string;
  windowLabel: string;
  readClipboardImage: () => Promise<{ data: Uint8Array } | null>;
  readClipboardPaths: () => Promise<string[]>;
  copyImageData: (data: Uint8Array) => Promise<void>;
  copyCompressedData: (data: Uint8Array, fileName: string) => Promise<string>;
  cacheImageData: (data: Uint8Array, fileName: string) => Promise<string>;
  copyImagePath: (path: string) => Promise<void>;
  selectImages: () => Promise<NativeImage[]>;
  readImagesFromPaths: (paths: string[]) => Promise<NativeImage[]>;
  selectFolder: (kind: "input" | "output" | "export") => Promise<string | null>;
  validateWatcher: (settings: WatcherSettings) => Promise<{ ok: boolean; error?: string }>;
  startWatcher: (settings: WatcherSettings) => Promise<{ ok: boolean; error?: string }>;
  stopWatcher: () => Promise<{ ok: boolean }>;
  getWatcherState: () => Promise<{ active: boolean; settings?: WatcherSettings }>;
  quickCompressPaths: (paths: string[], settings: QuickCompressSettings) => Promise<QuickCompressResult[]>;
  compressImageData: (data: Uint8Array, fileName: string, settings: QuickCompressSettings) => Promise<CompressedAnimationData>;
  compressImageWithWatermarkData: (data: Uint8Array, fileName: string, settings: QuickCompressSettings, watermark: NativeImageWatermark) => Promise<CompressedAnimationData>;
  compressAnimationData: (data: Uint8Array, fileName: string, settings: QuickCompressSettings) => Promise<CompressedAnimationData>;
  compressAnimationWithWatermarkData: (data: Uint8Array, fileName: string, settings: QuickCompressSettings, watermark: NativeAnimationWatermark) => Promise<CompressedAnimationData>;
  configureGlobalShortcuts: (bindings: { enabled: boolean; toggleDropzone: string; optimiseClipboard: string; showMain: string; showGallery?: string; uploadCurrent?: string }) => Promise<void>;
  cleanupOptimisedFiles: (payload: { folder: string; suffix: string; olderThanSeconds: number }) => Promise<{ deleted: number }>;
  previewBatchRename: (request: BatchRenameRequest) => Promise<BatchRenameResult>;
  applyBatchRename: (request: BatchRenameRequest) => Promise<BatchRenameResult>;
  revealPath: (path: string) => Promise<void>;
  openImage: (path: string) => Promise<void>;
  uploadImage: (payload: StoredUploadProfile & { fileName: string; mimeType: string; data: Uint8Array }) => Promise<{ url: string; remotePath: string }>;
  loadUploadProfile: () => Promise<StoredUploadProfile | null>;
  saveUploadProfile: (profile: StoredUploadProfile) => Promise<void>;
  copyText: (text: string) => Promise<void>;
  loadImportedFonts: () => Promise<Array<{ family: string; data: Uint8Array }>>;
  saveImportedFont: (family: string, data: Uint8Array) => Promise<void>;
  listSystemFonts: () => Promise<Array<{ family: string; path: string; faceIndex: number }>>;
  readSystemFont: (path: string, faceIndex: number) => Promise<{ data: Uint8Array }>;
  updateDesktopPreferences: (preferences: { minimizeToTray: boolean; showInTaskbarDock?: boolean; clipboardWatcherEnabled: boolean }) => Promise<void>;
  setWindowTheme: (theme: Appearance) => Promise<void>;
  startDragging: () => Promise<void>;
  startResizeDragging: (direction: "SouthEast") => Promise<void>;
  showMainWindow: () => Promise<void>;
  showGalleryWindow: () => Promise<void>;
  showPreferencesWindow: (section?: "general" | "clipboard" | "files" | "images" | "dropzone" | "zones" | "floating" | "hosting" | "plugins" | "shortcuts" | "about") => Promise<void>;
  showDropzoneWindow: () => Promise<void>;
  configureDropzoneWindow: (width: number, height: number) => Promise<void>;
  resizeDropzoneWindow: (width: number, height: number) => Promise<void>;
  setAlwaysOnTop: (enabled: boolean) => Promise<void>;
  setContentProtected: (protected_: boolean) => Promise<void>;
  hideCurrentWindow: () => Promise<void>;
  quitApplication: () => Promise<void>;
  onFileDrop: (callback: (event: { type: "over" | "drop" | "leave" | "error"; paths?: string[]; error?: string }) => void) => () => void;
  onTrayAction: (callback: (action: string) => void) => () => void;
  onImageImportProgress: (callback: (progress: { current: number; total: number }) => void) => () => void;
  onClipboardImage: (callback: (data: Uint8Array) => void) => () => void;
  onClipboardPaths: (callback: (paths: string[]) => void) => () => void;
  onWatcherEvent: (callback: (event: { type: string; message?: string; file?: string; output?: string; originalBytes?: number; outputBytes?: number; time: number }) => void) => () => void;
  onWindowResized: (callback: (size: { width: number; height: number }) => void) => () => void;
  checkForUpdates: () => Promise<{ currentVersion: string; latestVersion: string; available: boolean; releaseUrl: string }>;
  openExternal: (url: string) => Promise<void>;
};
