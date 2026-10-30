export type LibraryFolder = { id: string; name: string };
export type LibraryFolders = { folders: LibraryFolder[]; defaultFolderId: string };
export const LIBRARY_FOLDERS_KEY = 'piclite.libraryFolders.v1';
export function moveBefore<T>(items: T[], from: T, target: T): T[] {
  if (from === target || !items.includes(from) || !items.includes(target)) return items;
  const next = items.filter((item) => item !== from);
  next.splice(next.indexOf(target), 0, from);
  return next;
}
export function normalizeLibraryFolders(value: unknown): LibraryFolders {
  const raw = value && typeof value === 'object' ? value as Partial<LibraryFolders> : {};
  const seen = new Set<string>();
  const folders = (Array.isArray(raw.folders) ? raw.folders : []).filter((f) => {
    if (!f || typeof f.id !== 'string' || !f.id || typeof f.name !== 'string' || !f.name.trim() || seen.has(f.id)) return false;
    seen.add(f.id); return true;
  }).map((f) => ({ id: f.id, name: f.name.trim() }));
  return { folders, defaultFolderId: folders.some((f) => f.id === raw.defaultFolderId) ? raw.defaultFolderId! : '' };
}
export function loadLibraryFolders(): LibraryFolders {
  try { return normalizeLibraryFolders(JSON.parse(window.localStorage.getItem(LIBRARY_FOLDERS_KEY) || '{}')); }
  catch { return normalizeLibraryFolders(null); }
}
export function chooseFolderForWrite(explicit: string | undefined, existing: { folderId?: string } | undefined, destination: string): string {
  return explicit !== undefined ? explicit : existing ? existing.folderId || '' : destination;
}
