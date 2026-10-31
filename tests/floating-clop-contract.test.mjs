import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
const app=await readFile(new URL('../desktop/clop-desktop-app.tsx',import.meta.url),'utf8');
const css=await readFile(new URL('../desktop/floating-adaptive.css',import.meta.url),'utf8');
test('preview hover filename and metric states are mutually exclusive',()=>{
 assert.ok(app.includes('<strong className="result-name" title={fileName(item.source)}>{fileName(item.source)}</strong>'));
 assert.ok(css.includes('.result-card:hover :is(.result-metrics,.result-dimensions)'));
 assert.ok(css.includes('.result-card:hover .result-name'));
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
 assert.ok(css.includes('--action-size:26px'));
 assert.ok(css.includes('width:16px!important;height:16px!important'));
});
