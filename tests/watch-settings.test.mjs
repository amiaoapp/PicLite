import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSettings, saveSettings } from '../desktop/clop-store.ts';
const values = new Map();
globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
globalThis.window = { dispatchEvent() {} };
globalThis.CustomEvent = class { constructor(type) { this.type = type; } };
test('legacy watch folders migrate with independent rules and explicit empty profiles stay removed', () => {
  values.clear();
  values.set('piclite.desktop.clop-settings.v1', JSON.stringify({ watchFolders: ['A', 'B'], preset: { mode: 'manual', format: 'webp', quality: 72, scale: 50 } }));
  const migrated = loadSettings();
  assert.equal(migrated.watchProfiles.length, 2);
  assert.equal(migrated.watchProfiles[0].format, 'image/webp');
  assert.equal(migrated.watchProfiles[0].showFloatingResult, false);
  migrated.watchProfiles[0].quality = 20;
  assert.equal(migrated.watchProfiles[1].quality, 72);
  saveSettings({ ...migrated, watchProfiles: [] });
  assert.deepEqual(loadSettings().watchProfiles, []);
});
