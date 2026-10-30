import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { tmpdir } from 'node:os';
// Vite resolves the renderer's extensionless TypeScript imports without a build.
const server = await createServer({ configFile:false, optimizeDeps:{noDiscovery:true,include:[]}, cacheDir:tmpdir()+'/piclite-palette-test-vite', server:{middlewareMode:true}, appType:'custom' });
const { loadSettings, saveSettings } = await server.ssrLoadModule('/desktop/clop-store.ts');
await server.close();
const values = new Map();
globalThis.localStorage = { getItem:key=>values.get(key)??null, setItem:(key,value)=>values.set(key,value) };
globalThis.window = { dispatchEvent() {} };
globalThis.CustomEvent = class { constructor(type) { this.type=type; } };
test('pure white survives desktop and main preference synchronization and reload',()=>{
  values.clear();
  values.set('piclite.desktop.clop-settings.v1',JSON.stringify({colorTheme:'white'}));
  assert.equal(loadSettings().colorTheme,'white');
  saveSettings(loadSettings());
  assert.equal(JSON.parse(values.get('piclite.desktopPreferences.v1')).colorTheme,'white');
  assert.equal(loadSettings().colorTheme,'white');
  values.set('piclite.desktopPreferences.v1',JSON.stringify({colorTheme:'white'}));
  values.set('piclite.desktop.clop-settings.v1',JSON.stringify({colorTheme:'green'}));
  assert.equal(loadSettings().colorTheme,'white');
});
test('palette validation keeps existing choices and rejects unknown identifiers',()=>{
  for(const colorTheme of ['graphite','mist','violet','green','white']) {
    values.clear();values.set('piclite.desktopPreferences.v1',JSON.stringify({colorTheme}));
    assert.equal(loadSettings().colorTheme,colorTheme);
  }
  values.clear();values.set('piclite.desktopPreferences.v1',JSON.stringify({colorTheme:'unknown'}));
  assert.equal(loadSettings().colorTheme,'graphite');
});
