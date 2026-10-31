import assert from 'node:assert/strict';
import test from 'node:test';
import {DEFAULT_SETTINGS,loadSettings,saveSettings} from '../desktop/clop-store.ts';
const SETTINGS_KEY='piclite.desktop.clop-settings.v1',MAIN_KEY='piclite.desktopPreferences.v1';
test('interface typography defaults to a readable scale and persists size and font without changing compression',()=>{
 const previous={storage:globalThis.localStorage,window:globalThis.window};const data=new Map();globalThis.localStorage={getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)};globalThis.window=new EventTarget();
 try{
  assert.equal(DEFAULT_SETTINGS.interfaceFontScale,110);assert.equal(DEFAULT_SETTINGS.interfaceFontFamily,'');
  const preset={...DEFAULT_SETTINGS.preset,mode:'manual',quality:37,format:'webp'};
  for(const [scale,family] of [[90,''],[125,'Noto Sans CJK SC']]){saveSettings({...DEFAULT_SETTINGS,preset,interfaceFontScale:scale,interfaceFontFamily:family});const loaded=loadSettings();assert.equal(loaded.interfaceFontScale,scale);assert.equal(loaded.interfaceFontFamily,family);assert.deepEqual(loaded.preset,preset);const main=JSON.parse(data.get(MAIN_KEY));assert.equal(main.interfaceFontScale,scale);assert.equal(main.interfaceFontFamily,family);}
  data.set(SETTINGS_KEY,JSON.stringify({...DEFAULT_SETTINGS,interfaceFontScale:999,interfaceFontFamily:'bad\u0000font'}));data.set(MAIN_KEY,'{}');assert.equal(loadSettings().interfaceFontScale,110);assert.equal(loadSettings().interfaceFontFamily,'');
 }finally{if(previous.storage===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous.storage;if(previous.window===undefined)delete globalThis.window;else globalThis.window=previous.window;}
});
test('main and independent desktop documents mount shared typography controls',async()=>{
 const {readFile}=await import('node:fs/promises');
 for(const path of ['../app/piclite-app.tsx','../desktop/clop-desktop-app.tsx']) { const app=await readFile(new URL(path,import.meta.url),'utf8');assert.ok(app.includes('InterfaceTypographyControls'));assert.ok(app.includes('useInterfaceTypography')); }
});
test('text size scales without changing images, geometry, or pixel output',async()=>{
 const postcss=(await import('postcss')).default;const plugin=(await import('../build/interface-typography-postcss.mjs')).default;
 const result=await postcss([plugin()]).process('p{font-size:12px;width:240px;height:100px}h1{font-size:clamp(16px,2vw,28px)}small{font-size:.75em}',{from:undefined});
 assert.match(result.css,/font-size:calc\(\(12px\) \* var\(--interface-font-scale, 1\)\)/);assert.match(result.css,/width:240px;height:100px/);assert.match(result.css,/font-size:calc\(\(clamp\(16px,2vw,28px\)\) \* var/);assert.match(result.css,/font-size:\.75em/);
});
