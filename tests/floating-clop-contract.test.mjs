import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
const app=await readFile(new URL('../desktop/clop-desktop-app.tsx',import.meta.url),'utf8');
const css=await readFile(new URL('../desktop/floating-adaptive.css',import.meta.url),'utf8');
test('preview hover reveals actions without a filename caption',()=>{
 const card=app.slice(app.indexOf('export function ResultCard'),app.indexOf('export function FloatingResults'));
 assert.doesNotMatch(card,/className="result-name"/);
 assert.ok(css.includes('.result-card:is(:hover,:focus-within,[data-controls-visible="true"]) :is(.result-metrics,.result-dimensions)'));
 assert.ok(css.includes('.result-hover-actions{opacity:1}'));
});
test('progressive lower-image blur remains separate from exported pixels',()=>{
 assert.ok(css.includes('.floating-window-image::before'));
 assert.ok(css.includes('.floating-window-image::after'));
 assert.ok(css.includes('backdrop-filter:blur(14px)'));
 assert.ok(css.includes('mask-image:linear-gradient(transparent,#000'));
 assert.doesNotMatch(css,/\.floating-image-slot>img[^}]*filter:\s*brightness/);
});
test('metrics, dimensions and tools retain compact fixed proportions',()=>{
 assert.match(css,/\.result-metrics\{font-size:18px!important/);
 assert.match(css,/\.result-dimensions\{[^}]*font-size:10px!important/);
 assert.ok(css.includes('--action-size:38px'));
 assert.ok(css.includes('--action-size:28px'));
 assert.ok(css.includes('width:16px!important;height:16px!important'));
});
