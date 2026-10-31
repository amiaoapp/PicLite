import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const template = readFileSync(new URL('../app/img2banner-template.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app/cover-editor.css', import.meta.url), 'utf8');
const scratch = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'cover-browser-'));
const checks = `<script>
(async () => {
 const results = {};
 try {
 const rect = id => document.getElementById(id).getBoundingClientRect();
 results.toolbarVisible = rect('downloadBtn').top >= 0 && rect('downloadBtn').bottom < innerHeight;
 results.controlsScroll = getComputedStyle(document.querySelector('.controls-scroll')).overflowY === 'auto';
 results.previewScroll = getComputedStyle(document.querySelector('.panel.right')).overflowY === 'auto';
 const before = rect('downloadBtn').top;
 document.querySelector('.controls-scroll').scrollTop = 9999;
 results.toolbarStable = before === rect('downloadBtn').top;
 const fixture = document.createElement('canvas'); fixture.width=80; fixture.height=80;
 const ctx = fixture.getContext('2d'); ctx.fillStyle='#dd3344';ctx.fillRect(0,0,80,80);
 const blob = await new Promise(resolve=>fixture.toBlob(resolve));
 const transfer = new DataTransfer(); transfer.items.add(new File([blob],'source.png',{type:'image/png'}));
 document.getElementById('fileInput').files = transfer.files;
 document.getElementById('fileInput').dispatchEvent(new Event('change'));
 await new Promise(resolve=>setTimeout(resolve,300));
 results.imageImported = document.getElementById('editorWrap').style.display === 'block';
 const crop = document.getElementById('editorCanvas');
 crop.dispatchEvent(new WheelEvent('wheel',{deltaY:-1,deltaMode:0,cancelable:true}));
 results.gentleWheel = document.getElementById('zoomNum').value === '100';
 crop.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,deltaMode:0,cancelable:true}));
 results.boundedWheel = Number(document.getElementById('zoomNum').value) <= 102;
 document.getElementById('resetCropBtn').click();
 results.cropReset = document.getElementById('zoomNum').value === '100';
 const input = document.getElementById('textContent'); input.value='PicLite'; input.dispatchEvent(new Event('input'));
 await new Promise(resolve=>setTimeout(resolve,100));
 results.pngExport = document.getElementById('mainCanvas').toDataURL('image/png').startsWith('data:image/png;base64,');
 results.canvasDimensions = document.getElementById('mainCanvas').width===300 && document.getElementById('mainCanvas').height===200;
 const ids = [...document.querySelectorAll('[id]')].map(el=>el.id);
 results.uniqueIds = new Set(ids).size===ids.length;
 document.getElementById('themeToggle').click();
 results.darkTheme = document.documentElement.getAttribute('data-theme') === 'dark';
 results.darkToolbarVisible = rect('downloadBtn').top >= 0 && rect('downloadBtn').bottom < innerHeight;
 document.getElementById('themeToggle').click();
 results.lightTheme = document.documentElement.getAttribute('data-theme') !== 'dark';
 } catch(error) {results.error=error.message;}
 const out=document.createElement('pre');out.id='test-results';out.textContent=JSON.stringify(results);document.body.appendChild(out);
})();
</script>`;
const path=join(scratch,'editor.html');
writeFileSync(path,template.replace('</head>',`<style>${css}</style></head>`).replace('</body>',`${checks}</body>`));
for (const [width,height] of [[1280,800],[390,844]]) test(`cover editor in Chrome at ${width}×${height}`, () => {
 const run=spawnSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless','--no-sandbox',`--user-data-dir=${join(scratch,`profile-${width}`)}`,`--window-size=${width},${height}`,'--virtual-time-budget=3000','--dump-dom',`file://${path}`],{encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024});
 assert.equal(run.status,0,run.stderr);
 const match=run.stdout.match(/<pre id="test-results">(.*?)<\/pre>/);
 assert.ok(match,'browser checks did not finish');
 const results=JSON.parse(match[1]);
 assert.equal(results.error,undefined);
 for(const [name,value] of Object.entries(results)) assert.equal(value,true,`${name}: ${JSON.stringify(results)}`);
 console.log(JSON.stringify({width,height,...results}));
});
