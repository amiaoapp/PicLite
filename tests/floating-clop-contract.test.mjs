import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
const app=await readFile(new URL('../desktop/clop-desktop-app.tsx',import.meta.url),'utf8');
const css=await readFile(new URL('../desktop/floating-adaptive.css',import.meta.url),'utf8');
const compact=css.replace(/\s+/g,'');
test('preview hover reveals actions without a filename caption',()=>{
 const card=app.slice(app.indexOf('export function ResultCard'),app.indexOf('export function FloatingResults'));
 assert.doesNotMatch(card,/className="result-name"/);
 assert.ok(compact.includes('.result-card:is(:hover,:focus-within,[data-controls-visible="true"])' + ':is(.result-metrics,.result-dimensions)'));
 assert.match(css,/result-hover-actions[^}]*opacity:\s*0/);
});
test('progressive lower-image blur remains separate from exported pixels',()=>{
 assert.ok(css.includes('.floating-window-image::before'));
 assert.ok(css.includes('.floating-window-image::after'));
 assert.ok(compact.includes('backdrop-filter:blur(14px)'));
 assert.ok(compact.includes('mask-image:linear-gradient(transparent,#000'));
 assert.doesNotMatch(css,/\.floating-image-slot>img[^}]*filter:\s*brightness/);
});
test('metrics, dimensions and tools retain compact fixed proportions',()=>{
 assert.match(compact,/\.result-metrics\{font-size:18px/);
 assert.match(compact,/\.result-dimensions\{[^}]*font-size:10px/);
 assert.ok(compact.includes('17.35cqw'));
 assert.ok(compact.includes('--action-size:clamp(28px'));
 assert.ok(compact.includes('calc(var(--action-size)*.34)'));
});
