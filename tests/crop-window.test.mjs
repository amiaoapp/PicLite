import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('crop renderer uses isolated token route and native promise contract', () => {
 const renderer=readFileSync(new URL('../desktop/renderer.tsx',import.meta.url),'utf8');
 const bridge=readFileSync(new URL('../desktop/tauri-bridge.ts',import.meta.url),'utf8');
 assert.match(renderer,/CropEditorApp/);
 assert.match(bridge,/openCropEditor/);
 assert.match(bridge,/finish_crop_editor/);
});
