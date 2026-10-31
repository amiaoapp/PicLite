import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_SETTINGS,loadSettings,saveSettings} from '../desktop/clop-store.ts';
const key='piclite.desktop.clop-settings.v1',main='piclite.desktopPreferences.v1';
test('floating styles persist and synchronize without modifying compression preset',()=>{
 const previous={storage:globalThis.localStorage,window:globalThis.window};const data=new Map();globalThis.localStorage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};globalThis.window=new EventTarget();
 try{
  assert.equal(loadSettings().floatingStyle,'immersive');
  const preset={...DEFAULT_SETTINGS.preset,quality:39,mode:'manual',format:'webp'};
  for(const style of ['classic','immersive']){saveSettings({...DEFAULT_SETTINGS,preset,floatingStyle:style});assert.equal(loadSettings().floatingStyle,style);assert.equal(JSON.parse(data.get(main)).floatingStyle,style);assert.deepEqual(loadSettings().preset,preset);}
  data.set(main,JSON.stringify({floatingStyle:'classic'}));assert.equal(loadSettings().floatingStyle,'classic');
  data.set(key,JSON.stringify({...DEFAULT_SETTINGS,preset,floatingStyle:'invalid'}));data.set(main,'{}');assert.equal(loadSettings().floatingStyle,'immersive');assert.deepEqual(loadSettings().preset,preset);
 }finally{if(previous.storage===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous.storage;if(previous.window===undefined)delete globalThis.window;else globalThis.window=previous.window;}
});
