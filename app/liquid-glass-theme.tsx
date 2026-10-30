"use client";

import { useEffect, useSyncExternalStore } from "react";
// Standalone floating/preferences documents do not load app/globals.css.
import "./liquid-glass.css";
import { applyMaterialPreference, DEFAULT_MATERIAL, MATERIAL_EVENT, MATERIAL_STORAGE_KEY, readMaterialPreference, setMaterialPreference } from "./material-preference";
export { setMaterialPreference } from "./material-preference";
export type { InterfaceMaterial, MaterialPreference, TransparencyPreference } from "./material-preference";

function subscribe(listener: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === MATERIAL_STORAGE_KEY || event.key === null) listener(); };
  window.addEventListener("storage", storage);
  window.addEventListener(MATERIAL_EVENT, listener);
  return () => { window.removeEventListener("storage", storage); window.removeEventListener(MATERIAL_EVENT, listener); };
}
// Primitive snapshot stays stable between notifications (required by useSyncExternalStore).
function snapshot() { return JSON.stringify(readMaterialPreference()); }
function serverSnapshot() { return JSON.stringify(DEFAULT_MATERIAL); }

export function useMaterialPreference() {
  const raw = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const preference = JSON.parse(raw) as ReturnType<typeof readMaterialPreference>;
  return [preference, setMaterialPreference] as const;
}

/** Mount once per document, including standalone desktop/floating windows. */
export function useLiquidGlassTheme() {
  const [preference, choose] = useMaterialPreference();
  const { material, transparency } = preference;
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-transparency: reduce)");
    let disposed = false;
    let revision = 0;
    // Serialize native transitions so a slow earlier toggle cannot win over a newer one.
    let pending = Promise.resolve();
    const apply = () => {
      const root = document.documentElement;
      applyMaterialPreference(root, { material, transparency }, media.matches);
      const enabled = material === "glass" && root.dataset.transparency === "full" && root.dataset.floatingCollapsed !== "true";
      const current = ++revision;
      const bridge = window.picLite;
      if (!bridge?.setWindowMaterial) return;
      pending = pending.then(async () => {
        if (disposed || current !== revision) return;
        try {
          let radius = 18;
          if (bridge.windowLabel === "dropzone") {
            try {
              const saved = JSON.parse(localStorage.getItem("piclite.desktop.clop-settings.v1") || "{}");
              radius = typeof saved.floatingCornerRadius === "number" && Number.isFinite(saved.floatingCornerRadius)
                ? Math.max(0, Math.min(80, saved.floatingCornerRadius)) : 10;
            } catch { radius = 10; }
          }
          const result = await bridge.setWindowMaterial!({ enabled, radius });
          if (disposed || current !== revision) return;
          root.dataset.nativeMaterial = result.enabled
            ? (result.backend === "nsglass-clear" ? "glass" : result.backend === "nsvisualeffect" ? "vibrancy" : "none")
            : "none";
          if (result.reducedTransparency) root.dataset.transparency = "reduce";
          window.dispatchEvent(new CustomEvent("piclite:native-material", { detail: result }));
        } catch (error) {
          if (!disposed && current === revision) root.dataset.nativeMaterial = "error";
          console.warn("Native window material unavailable", error);
        }
      });
    };
    apply();
    media.addEventListener("change", apply);
    const storage = (event: StorageEvent) => { if (event.key === "piclite.desktop.clop-settings.v1" || event.key === null) apply(); };
    window.addEventListener("storage", storage);
    window.addEventListener("piclite:settings-changed", apply);
    window.addEventListener("piclite:floating-collapsed", apply);
    // AppKit accessibility preferences may change without WebKit firing its media query.
    window.addEventListener("focus", apply);
    return () => {
      disposed = true;
      media.removeEventListener("change", apply);
      window.removeEventListener("storage", storage);
      window.removeEventListener("piclite:settings-changed", apply);
      window.removeEventListener("piclite:floating-collapsed", apply);
      window.removeEventListener("focus", apply);
    };
  }, [material, transparency]);
  return [preference, choose] as const;
}

export function LiquidGlassThemeRoot() { useLiquidGlassTheme(); return null; }

/** Ready-to-use controls. These settings are independent of layout and palette. */
export function MaterialControls({ language = "zh" }: { language?: "zh" | "en" }) {
  const [value, choose] = useMaterialPreference();
  const zh = language === "zh";
  return <div className="material-controls">
    <label><span>{zh ? "界面材质" : "Interface material"}</span><select value={value.material} onChange={event => choose({ material: event.target.value === "glass" ? "glass" : "standard" })}>
      <option value="standard">{zh ? "标准" : "Standard"}</option><option value="glass">{zh ? "液态玻璃" : "Liquid Glass"}</option>
    </select></label>
    <label><span>{zh ? "透明效果" : "Transparency"}</span><select value={value.transparency} onChange={event => choose({ transparency: event.target.value === "reduce" ? "reduce" : "system" })}>
      <option value="system">{zh ? "跟随系统" : "Follow system"}</option><option value="reduce">{zh ? "减少透明度" : "Reduce transparency"}</option>
    </select></label>
  </div>;
}
