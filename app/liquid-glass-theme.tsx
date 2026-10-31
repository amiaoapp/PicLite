"use client";

import { useEffect } from "react";
import { applyMaterialPreference, DEFAULT_MATERIAL, readMaterialPreference, setMaterialPreference } from "./material-preference";
export { setMaterialPreference } from "./material-preference";
export type { InterfaceMaterial, MaterialPreference, TransparencyPreference } from "./material-preference";

/** Compatibility hook for callers predating standard-only appearance. */
export function useMaterialPreference() {
  useEffect(() => { readMaterialPreference(); }, []);
  return [DEFAULT_MATERIAL, setMaterialPreference] as const;
}

/** Retains native window clipping and decorated-titlebar safety only. */
export function useLiquidGlassTheme() {
  const preference = useMaterialPreference();
  useEffect(() => {
    let disposed = false;
    let pending = Promise.resolve();
    const apply = () => {
      applyMaterialPreference(document.documentElement, DEFAULT_MATERIAL, false);
      const bridge = window.picLite;
      if (!bridge?.setWindowMaterial) return;
      let radius = 18;
      if (bridge.windowLabel === "dropzone") {
        try {
          const saved = JSON.parse(localStorage.getItem("piclite.desktop.clop-settings.v1") || "{}");
          radius = typeof saved.floatingCornerRadius === "number" && Number.isFinite(saved.floatingCornerRadius)
            ? Math.max(0, Math.min(80, saved.floatingCornerRadius)) : 10;
        } catch { radius = 10; }
      }
      pending = pending.then(async () => {
        if (disposed) return;
        try {
          const result = await bridge.setWindowMaterial!({ enabled: false, radius });
          if (!disposed) window.dispatchEvent(new CustomEvent("piclite:native-material", { detail: result }));
        } catch (error) { console.warn("Native window appearance unavailable", error); }
      });
    };
    apply();
    const storage = (event: StorageEvent) => {
      if (event.key === "piclite.desktop.clop-settings.v1" || event.key === null) apply();
    };
    window.addEventListener("storage", storage);
    window.addEventListener("piclite:settings-changed", apply);
    window.addEventListener("focus", apply);
    return () => {
      disposed = true;
      window.removeEventListener("storage", storage);
      window.removeEventListener("piclite:settings-changed", apply);
      window.removeEventListener("focus", apply);
    };
  }, []);
  return preference;
}

export function LiquidGlassThemeRoot() { useLiquidGlassTheme(); return null; }

/** Retired controls remain an empty compatibility export. */
export function MaterialControls(_props: { language?: "zh" | "en" }) { void _props; return null; }
