export const DEFAULT_CLIPBOARD_SOURCE_SETTINGS = {
  clipboardExcludeOffice: true,
  clipboardExcludedApps: [] as string[],
};

export function normalizeClipboardExcludedApps(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.filter((item): item is string => typeof item === "string").map(item => item.trim()).filter(item => {
    const key = item.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
}
