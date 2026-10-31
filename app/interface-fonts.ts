export type InterfaceFont = { id: string; family: string; data: Uint8Array };
export type InterfaceFontBridge = {
  listSystemFonts: () => Promise<Array<{family: string; path: string; faceIndex: number}>>;
  readSystemFont: (path: string, faceIndex: number) => Promise<{data: Uint8Array}>;
  loadImportedFonts: () => Promise<Array<{family: string; data: Uint8Array}>>;
  saveImportedFont: (family: string, data: Uint8Array) => Promise<void>;
};
const installed = new Map<string, Promise<void>>();
const records = new Map<string, InterfaceFont>();
function openFonts(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('piclite.interface-fonts.v1', 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('fonts', {keyPath:'id'}); };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
async function transact<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openFonts();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('fonts', mode), request = action(tx.objectStore('fonts'));
    tx.oncomplete = () => { const result = request.result; db.close(); resolve(result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error('Font storage aborted')); };
  });
}
export async function listInterfaceFonts(): Promise<InterfaceFont[]> {
  const fonts = await transact('readonly', store => store.getAll());
  for (const font of fonts) records.set(font.id, font);
  return fonts;
}
export async function installInterfaceFont(id: string, data: Uint8Array) {
  if (installed.has(id)) return installed.get(id);
  const pending = (async () => {
    const face = new FontFace(id, data.slice().buffer as ArrayBuffer);
    await face.load();
    document.fonts.add(face);
  })();
  installed.set(id, pending);
  try { await pending; } catch (error) { installed.delete(id); throw error; }
}
export async function importInterfaceFont(file: File, bridge?: InterfaceFontBridge): Promise<InterfaceFont> {
  if (!/\.(ttf|otf|woff2?)$/i.test(file.name)) throw new Error('Use TTF, OTF, WOFF or WOFF2 / 请使用 TTF、OTF、WOFF 或 WOFF2 字体');
  if (!file.size || file.size > 32 * 1024 * 1024) throw new Error('Font must be between 1 byte and 32 MB / 字体文件不能为空且不超过 32 MB');
  const data = new Uint8Array(await file.arrayBuffer());
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data))).map(byte=>byte.toString(16).padStart(2,'0')).join('');
  const id = `piclite-ui-${hash}`;
  const font = {id, family:file.name.replace(/\.[^.]+$/, '').slice(0,200), data};
  await installInterfaceFont(id,data); // Validate before saving or selecting.
  if (bridge) await bridge.saveImportedFont(id,data);
  await transact('readwrite', store => store.put(font));
  records.set(id,font);
  return font;
}
export async function loadInterfaceFont(family: string, id: string, bridge?: InterfaceFontBridge) {
  if (!family) return;
  if (installed.has(id || family)) return installed.get(id || family);
  if (id) {
    let font = records.get(id);
    if (!font && bridge) { const native = (await bridge.loadImportedFonts()).find(font=>font.family===id); if (native) font={id,family,data:native.data}; }
    if (!font) font = await transact('readonly', store=>store.get(id));
    if (!font) throw new Error('Imported interface font unavailable / 导入的界面字体不可用，请重新导入');
    records.set(id,font);
    return installInterfaceFont(id,font.data);
  }
  if (!bridge) return; // Installed standard fonts resolve through the CSS fallback stack.
  const font = (await bridge.listSystemFonts()).find(font=>font.family===family);
  if (!font) throw new Error('System font unavailable / 系统字体不可用');
  const {data}=await bridge.readSystemFont(font.path,font.faceIndex);
  return installInterfaceFont(family,data);
}
