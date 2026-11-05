import assert from 'node:assert/strict';
import test from 'node:test';
import { shortcutFromEvent, shortcutLabel } from '../desktop/shortcuts.ts';

const key = (modifiers) => ({ key: 'c', code: 'KeyC', ctrlKey: false, metaKey: false, altKey: true, shiftKey: false, ...modifiers });

test('recording preserves Control, Command/Win and combinations on both platforms', () => {
  assert.equal(shortcutFromEvent(key({ ctrlKey: true })), 'Control+Alt+C');
  assert.equal(shortcutFromEvent(key({ metaKey: true })), 'Super+Alt+C');
  assert.equal(shortcutFromEvent(key({ ctrlKey: true, metaKey: true, shiftKey: true })), 'Control+Super+Alt+Shift+C');
  assert.equal(shortcutLabel('Control+Alt+C', 'darwin'), '⌃ ⌥ C');
  assert.equal(shortcutLabel('Super+Alt+C', 'darwin'), '⌘ ⌥ C');
  assert.equal(shortcutLabel('Super+Alt+C', 'win32'), 'Win + Alt + C');
  assert.equal(shortcutLabel('Control+Alt+C', 'win32'), 'Ctrl + Alt + C');
});

test('existing portable defaults and recorder cancellation still work', () => {
  assert.equal(shortcutLabel('CommandOrControl+Alt+V', 'darwin'), '⌘ ⌥ V');
  assert.equal(shortcutLabel('CommandOrControl+Alt+V', 'win32'), 'Ctrl + Alt + V');
  assert.equal(shortcutFromEvent(key({ key: 'Meta', code: 'MetaLeft', metaKey: true })), null);
  assert.equal(shortcutFromEvent(key({ key: 'Escape', code: 'Escape' })), 'escape');
  assert.equal(shortcutFromEvent(key({ key: 'Delete', code: 'Delete' })), '');
  assert.equal(shortcutFromEvent(key({ ctrlKey: true, key: 'ç' })), 'Control+Alt+C');
});
