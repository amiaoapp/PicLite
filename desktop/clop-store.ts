import type { Appearance, ColorTheme, DesktopSettings, ImageFormat, Language, OptimisationPreset, UpdateCheckFrequency } from "./clop-types";

const SETTINGS_KEY = "piclite.desktop.clop-settings.v1";
const MAIN_DESKTOP_PREFERENCES_KEY = "piclite.desktopPreferences.v1";
const WINDOWS_CLIPBOARD_REPAIR_KEY = "piclite.windows-clipboard-repair.v1.8.3";
const SETTINGS_EVENT = "piclite:settings-changed";

export const DEFAULT_SETTINGS: DesktopSettings = {
  language: "zh",
  appearance: "system",
  colorTheme: "graphite",
  updateCheckFrequency: "startup",
  launchAtLogin: false,
  showMenubarIcon: true,
  showInTaskbarDock: true,
  clipboardOptimiser: true,
  clipboardImageData: true,
  clipboardImageFiles: true,
  keepClipboardResults: false,
  filePlacement: "same-folder",
  outputFolder: "",
  outputSuffix: "-piclite",
  renameTemplate: "{name}{suffix}",
  preserveDates: true,
  autoCleanupEnabled: false,
  autoCleanupAmount: 7,
  autoCleanupUnit: "days",
  stripMetadata: true,
  preserveColorProfile: true,
  enableDropZone: true,
  dropZoneAtCursor: false,
  autoCopyDropResults: false,
  batchThreshold: 30,
  enableFloatingResults: true,
  allowFloatingCapture: false,
  floatingLayout: "compact",
  floatingDisplayMode: "stack",
  floatingMaxResults: 5,
  floatingCorner: "bottom-right",
  floatingWidth: 320,
  floatingHeight: 230,
  floatingActions: ["downscale", "watermark", "undo", "copy", "preview", "reveal"],
  floatingWatermark: {
    text: "PicLite",
    fontFamily: "Microsoft YaHei",
    fontScale: 4.5,
    color: "#ffffff",
    opacity: 28,
    rotation: -28,
    density: 55,
    shadow: true,
    shadowBlur: 7,
    shadowColor: "#000000",
  },
  autoHideResults: true,
  autoHideSeconds: 10,
  followCursorScreen: true,
  showCopyClearButtons: true,
  hideTooltips: false,
  watchFolders: [],
  watchProfiles: [],
  pauseAutomaticOptimisations: false,
  shortcutsEnabled: true,
  shortcutToggleDropzone: "CommandOrControl+Alt+D",
  shortcutOptimiseClipboard: "CommandOrControl+Alt+V",
  shortcutShowMain: "CommandOrControl+Alt+P",
  shortcutShowGallery: "CommandOrControl+Alt+L",
  shortcutUploadCurrent: "CommandOrControl+Alt+U",
  preset: {
    mode: "auto",
    quality: 86,
    scale: 100,
    format: "keep",
    stripMetadata: true,
    preventLarger: true,
  },
};

function validFormat(value: unknown): value is ImageFormat {
  return value === "keep" || value === "jpeg" || value === "png" || value === "webp";
}

function validAppearance(value: unknown): value is Appearance {
  return value === "system" || value === "light" || value === "dark";
}

function validColorTheme(value: unknown): value is ColorTheme {
  return value === "graphite" || value === "mist" || value === "violet" || value === "green";
}

function validUpdateCheckFrequency(value: unknown): value is UpdateCheckFrequency {
  return value === "startup" || value === "daily" || value === "weekly" || value === "never";
}

function userFacingPath(value: string) {
  if (value.startsWith("\\\\?\\UNC\\")) return `\\\\${value.slice(8)}`;
  if (value.startsWith("\\\\?\\")) return value.slice(4);
  return value;
}

function repairWindowsClipboardPreference(
  parsed: Partial<DesktopSettings>,
  mainPreferences: Record<string, unknown>,
  current: boolean,
) {
  if (typeof navigator === "undefined" || !/windows|win32|win64/i.test(`${navigator.userAgent} ${navigator.platform}`)) return current;
  if (localStorage.getItem(WINDOWS_CLIPBOARD_REPAIR_KEY)) return current;
  localStorage.setItem(WINDOWS_CLIPBOARD_REPAIR_KEY, "1");
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...parsed, clipboardOptimiser: true }));
  localStorage.setItem(MAIN_DESKTOP_PREFERENCES_KEY, JSON.stringify({ ...mainPreferences, clipboardWatcherEnabled: true }));
  return true;
}

export function loadSettings(): DesktopSettings {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") as Partial<DesktopSettings>;
    const mainPreferences = JSON.parse(localStorage.getItem(MAIN_DESKTOP_PREFERENCES_KEY) || "{}") as Partial<{ language: Language; theme: Appearance; colorTheme: ColorTheme; autoCheckUpdates: boolean; updateCheckFrequency: UpdateCheckFrequency; showInTaskbarDock: boolean; allowFloatingCapture: boolean; clipboardWatcherEnabled: boolean; shortcutsEnabled: boolean; shortcutDock: string; shortcutPaste: string; shortcutShow: string; shortcutGallery: string; shortcutUpload: string; renameTemplate: string }>;
    const preset = { ...DEFAULT_SETTINGS.preset, ...(parsed.preset || {}) } as OptimisationPreset;
    if (preset.mode !== "manual") preset.mode = "auto";
    if (!validFormat(preset.format)) preset.format = "keep";
    const clipboardOptimiser = repairWindowsClipboardPreference(
      parsed,
      mainPreferences as Record<string, unknown>,
      typeof parsed.clipboardOptimiser === "boolean" ? parsed.clipboardOptimiser : mainPreferences.clipboardWatcherEnabled ?? DEFAULT_SETTINGS.clipboardOptimiser,
    );
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      appearance: validAppearance(mainPreferences.theme) ? mainPreferences.theme : validAppearance(parsed.appearance) ? parsed.appearance : DEFAULT_SETTINGS.appearance,
      colorTheme: validColorTheme(mainPreferences.colorTheme) ? mainPreferences.colorTheme : validColorTheme(parsed.colorTheme) ? parsed.colorTheme : DEFAULT_SETTINGS.colorTheme,
      showInTaskbarDock: typeof mainPreferences.showInTaskbarDock === "boolean" ? mainPreferences.showInTaskbarDock : parsed.showInTaskbarDock ?? DEFAULT_SETTINGS.showInTaskbarDock,
      allowFloatingCapture: typeof mainPreferences.allowFloatingCapture === "boolean" ? mainPreferences.allowFloatingCapture : parsed.allowFloatingCapture ?? DEFAULT_SETTINGS.allowFloatingCapture,
      // The dedicated desktop settings key was the original source of truth.
      // Prefer it while migrating older installs whose main-window key still
      // contains the former false default, then save both keys in sync below.
      clipboardOptimiser,
      updateCheckFrequency: validUpdateCheckFrequency(mainPreferences.updateCheckFrequency)
        ? mainPreferences.updateCheckFrequency
        : validUpdateCheckFrequency(parsed.updateCheckFrequency)
          ? parsed.updateCheckFrequency
          : mainPreferences.autoCheckUpdates === false ? "never" : DEFAULT_SETTINGS.updateCheckFrequency,
      shortcutsEnabled: typeof mainPreferences.shortcutsEnabled === "boolean" ? mainPreferences.shortcutsEnabled : parsed.shortcutsEnabled ?? DEFAULT_SETTINGS.shortcutsEnabled,
      shortcutToggleDropzone: mainPreferences.shortcutDock || parsed.shortcutToggleDropzone || DEFAULT_SETTINGS.shortcutToggleDropzone,
      shortcutOptimiseClipboard: mainPreferences.shortcutPaste || parsed.shortcutOptimiseClipboard || DEFAULT_SETTINGS.shortcutOptimiseClipboard,
      shortcutShowMain: mainPreferences.shortcutShow || parsed.shortcutShowMain || DEFAULT_SETTINGS.shortcutShowMain,
      shortcutShowGallery: mainPreferences.shortcutGallery || parsed.shortcutShowGallery || DEFAULT_SETTINGS.shortcutShowGallery,
      shortcutUploadCurrent: mainPreferences.shortcutUpload || parsed.shortcutUploadCurrent || DEFAULT_SETTINGS.shortcutUploadCurrent,
      floatingWidth: Math.max(280, Number(parsed.floatingWidth) || DEFAULT_SETTINGS.floatingWidth),
      floatingHeight: Math.max(220, Number(parsed.floatingHeight) || DEFAULT_SETTINGS.floatingHeight),
      floatingActions: Array.isArray(parsed.floatingActions) ? parsed.floatingActions.slice(0, 6) : DEFAULT_SETTINGS.floatingActions,
      floatingWatermark: { ...DEFAULT_SETTINGS.floatingWatermark, ...(parsed.floatingWatermark || {}) },
      watchProfiles: Array.isArray(parsed.watchProfiles) ? parsed.watchProfiles : (parsed.watchFolders || []).map((path, index) => ({
        id: `migrated-${index}`, name: fileName(path), enabled: true,
        inputFolder: userFacingPath(path), inputFolders: [], outputFolder: parsed.filePlacement === "fixed-folder" ? parsed.outputFolder || "" : "@same-folder",
        outputSuffix: parsed.outputSuffix || "-piclite", renameTemplate: parsed.renameTemplate || "{name}{suffix}",
        mode: preset.mode === "auto" ? "balanced" : "manual", quality: preset.quality, scale: preset.scale,
        format: toNativeFormat(preset.format), resize: false, maxWidth: 1920, maxHeight: 1920,
        stripMetadata: preset.stripMetadata, preventLarger: preset.preventLarger, onlyWhenNeeded: false, notifyOnComplete: true, showFloatingResult: false,
      })),
      watchFolders: Array.isArray(parsed.watchFolders) ? parsed.watchFolders.map(userFacingPath) : DEFAULT_SETTINGS.watchFolders,
      renameTemplate: mainPreferences.renameTemplate || parsed.renameTemplate || DEFAULT_SETTINGS.renameTemplate,
      language: mainPreferences.language === "en" || (!mainPreferences.language && parsed.language === "en") ? "en" : "zh",
      preset,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: DesktopSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  try {
    const mainPreferences = JSON.parse(localStorage.getItem(MAIN_DESKTOP_PREFERENCES_KEY) || "{}") as Record<string, unknown>;
    localStorage.setItem(MAIN_DESKTOP_PREFERENCES_KEY, JSON.stringify({
      ...mainPreferences,
      language: settings.language,
      theme: settings.appearance,
      colorTheme: settings.colorTheme,
      autoCheckUpdates: settings.updateCheckFrequency !== "never",
      updateCheckFrequency: settings.updateCheckFrequency,
      showInTaskbarDock: settings.showInTaskbarDock,
      allowFloatingCapture: settings.allowFloatingCapture,
      clipboardWatcherEnabled: settings.clipboardOptimiser,
      shortcutsEnabled: settings.shortcutsEnabled,
      shortcutDock: settings.shortcutToggleDropzone,
      shortcutPaste: settings.shortcutOptimiseClipboard,
      shortcutShow: settings.shortcutShowMain,
      shortcutGallery: settings.shortcutShowGallery,
      shortcutUpload: settings.shortcutUploadCurrent,
      renameTemplate: settings.renameTemplate,
    }));
  } catch {
    // The floating window still owns a complete local copy when an older main-window preference is malformed.
  }
  window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: settings }));
}

export function subscribeSettings(callback: (settings: DesktopSettings) => void) {
  const listener = (event: Event) => callback((event as CustomEvent<DesktopSettings>).detail || loadSettings());
  const storage = (event: StorageEvent) => {
    if (event.key === SETTINGS_KEY || event.key === MAIN_DESKTOP_PREFERENCES_KEY) callback(loadSettings());
  };
  window.addEventListener(SETTINGS_EVENT, listener);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(SETTINGS_EVENT, listener);
    window.removeEventListener("storage", storage);
  };
}

export function tr(language: Language, zh: string, en: string) {
  return language === "zh" ? zh : en;
}

export function toNativeFormat(format: ImageFormat) {
  if (format === "keep") return "keep";
  return `image/${format}`;
}

export function formatBytes(value?: number) {
  if (value == null) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10240 ? 1 : 0)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

export function fileName(path: string) {
  return path.split(/[\\/]/).pop() || path;
}
