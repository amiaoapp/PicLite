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

test('Windows clipboard repair re-enables old disabled monitor settings once', () => {
  values.clear();
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', platform: 'Win32' },
  });
  try {
    values.set('piclite.desktop.clop-settings.v1', JSON.stringify({ clipboardOptimiser: false }));
    values.set('piclite.desktopPreferences.v1', JSON.stringify({ clipboardWatcherEnabled: false }));
    assert.equal(loadSettings().clipboardOptimiser, true);
    assert.equal(JSON.parse(values.get('piclite.desktop.clop-settings.v1')).clipboardOptimiser, true);
    assert.equal(JSON.parse(values.get('piclite.desktopPreferences.v1')).clipboardWatcherEnabled, true);

    const manuallyDisabled = JSON.parse(values.get('piclite.desktop.clop-settings.v1'));
    manuallyDisabled.clipboardOptimiser = false;
    values.set('piclite.desktop.clop-settings.v1', JSON.stringify(manuallyDisabled));
    assert.equal(loadSettings().clipboardOptimiser, false);
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
  }
});
