export type InterfaceTypography = { interfaceFontScale: number; interfaceFontFamily: string; interfaceFontId: string };
export const DEFAULT_INTERFACE_TYPOGRAPHY: InterfaceTypography = { interfaceFontScale: 110, interfaceFontFamily: '', interfaceFontId: '' };
export const TYPOGRAPHY_KEYS = ['piclite.desktopPreferences.v1', 'piclite.desktop.clop-settings.v1'] as const;
export const TYPOGRAPHY_EVENT = 'piclite:interface-typography';
export function normalizeInterfaceTypography(value: Partial<InterfaceTypography> = {}): InterfaceTypography {
  const scale = value.interfaceFontScale;
  const family = value.interfaceFontFamily;
  return {
    interfaceFontScale: typeof scale === 'number' && Number.isFinite(scale) && scale >= 90 && scale <= 150 ? scale : 110,
    interfaceFontFamily: typeof family === 'string' && family.length <= 200 && !Array.from(family).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ? family.trim() : '',
    interfaceFontId: typeof value.interfaceFontId === 'string' && /^piclite-ui-[a-f0-9]{64}$/.test(value.interfaceFontId) ? value.interfaceFontId : '',
  };
}
export function loadInterfaceTypography(): InterfaceTypography {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_INTERFACE_TYPOGRAPHY };
  const read = (key: string) => { try { return JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch { return {}; } };
  return normalizeInterfaceTypography({ ...read(TYPOGRAPHY_KEYS[1]), ...read(TYPOGRAPHY_KEYS[0]) });
}
export function saveInterfaceTypography(value: InterfaceTypography) {
  const next = normalizeInterfaceTypography(value);
  for (const key of TYPOGRAPHY_KEYS) {
    let current: Record<string, unknown> = {};
    try { current = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch { /* Repair only this preference store. */ }
    localStorage.setItem(key, JSON.stringify({ ...current, ...next }));
  }
  window.dispatchEvent(new Event(TYPOGRAPHY_EVENT));
  window.dispatchEvent(new Event('piclite:settings-changed'));
  return next;
}
export function interfaceFontStack(family: string, id = '') {
  const fallback = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif';
  return family ? `${JSON.stringify(id || family)}, ${fallback}` : fallback;
}
