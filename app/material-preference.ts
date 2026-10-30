export type InterfaceMaterial = "standard" | "glass";
export type TransparencyPreference = "system" | "reduce";
export type MaterialPreference = { material: InterfaceMaterial; transparency: TransparencyPreference };

export const MATERIAL_STORAGE_KEY = "piclite.interfaceMaterial.v1";
export const MATERIAL_EVENT = "piclite:interface-material";
export const DEFAULT_MATERIAL: Readonly<MaterialPreference> = Object.freeze({ material: "standard", transparency: "system" });
let sessionPreference: MaterialPreference = { ...DEFAULT_MATERIAL };

export function parseMaterialPreference(raw: string | null): MaterialPreference {
  try {
    const value = JSON.parse(raw || "{}");
    return {
      material: value?.material === "glass" ? "glass" : "standard",
      transparency: value?.transparency === "reduce" ? "reduce" : "system",
    };
  } catch { return { ...DEFAULT_MATERIAL }; }
}

export function readMaterialPreference(): MaterialPreference {
  if (typeof window === "undefined") return { ...DEFAULT_MATERIAL };
  try { return parseMaterialPreference(window.localStorage.getItem(MATERIAL_STORAGE_KEY)); }
  catch { return sessionPreference; }
}

export function setMaterialPreference(patch: Partial<MaterialPreference>): void {
  const next = parseMaterialPreference(JSON.stringify({ ...readMaterialPreference(), ...patch }));
  sessionPreference = next;
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(MATERIAL_STORAGE_KEY, JSON.stringify(next)); }
  catch { /* The preference remains usable for this session with storage blocked. */ }
  window.dispatchEvent(new Event(MATERIAL_EVENT));
}

/** Synchronizes presentation only; the existing application owns data-theme/data-palette. */
export function applyMaterialPreference(root: HTMLElement, preference: MaterialPreference, systemReducesTransparency: boolean) {
  root.dataset.material = preference.material;
  root.dataset.transparency = preference.transparency === "reduce" || systemReducesTransparency ? "reduce" : "full";
}
