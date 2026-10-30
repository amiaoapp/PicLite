"use client";

import { useEffect, useSyncExternalStore } from "react";
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
    const apply = () => applyMaterialPreference(document.documentElement, { material, transparency }, media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
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
