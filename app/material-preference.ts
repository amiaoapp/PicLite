/** Legacy input types are accepted so older callers can migrate safely. */
export type InterfaceMaterial = "standard" | "glass";
export type TransparencyPreference = "system" | "reduce";
export type MaterialPreference = { material: InterfaceMaterial; transparency: TransparencyPreference };

export const MATERIAL_STORAGE_KEY = "piclite.interfaceMaterial.v1";
export const MATERIAL_EVENT = "piclite:interface-material";
export const DEFAULT_MATERIAL: Readonly<MaterialPreference> = Object.freeze({ material: "standard", transparency: "system" });

/** The retired preference always resolves to the standard appearance. */
export function parseMaterialPreference(_raw: string | null): MaterialPreference {
  void _raw;
  return { ...DEFAULT_MATERIAL };
}

export function readMaterialPreference(): MaterialPreference {
  const preference = { ...DEFAULT_MATERIAL };
  if (typeof window === "undefined") return preference;
  try {
    const raw = window.localStorage.getItem(MATERIAL_STORAGE_KEY);
    const migrated = JSON.stringify(preference);
    if (raw !== null && raw !== migrated) window.localStorage.setItem(MATERIAL_STORAGE_KEY, migrated);
  } catch { /* Standard appearance also works with storage blocked. */ }
  return preference;
}

export function setMaterialPreference(_patch: Partial<MaterialPreference>): void {
  void _patch;
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(MATERIAL_STORAGE_KEY, JSON.stringify(DEFAULT_MATERIAL)); }
  catch { /* Standard appearance does not depend on persistence. */ }
  window.dispatchEvent(new Event(MATERIAL_EVENT));
}

/** Compatibility datasets never alter the application's theme or palette. */
export function applyMaterialPreference(root: HTMLElement, _preference: MaterialPreference, _systemReducesTransparency: boolean) {
  void _preference;
  void _systemReducesTransparency;
  root.dataset.material = "standard";
  root.dataset.transparency = "reduce";
  root.dataset.nativeMaterial = "none";
}
