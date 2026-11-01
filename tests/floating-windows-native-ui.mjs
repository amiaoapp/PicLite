// Run the packaged Windows executable in an isolated portable profile.
// CDP drives the real WebView2 and Rust bridge; only watcher arrival is emitted.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { floatingBrowser } from './helpers/floating-test-browser.mjs';

assert.equal(process.platform, 'win32', 'This test requires actual Windows WebView2');
const binary = resolve(process.env.PICLITE_BINARY);
const directory = await mkdtemp(join(tmpdir(), 'piclite-native-ui-'));
const artifacts = resolve(process.env.ARTIFACTS || 'native-ui-artifacts');
await mkdir(artifacts, { recursive: true });
const executable = join(directory, 'PicLite.exe');
await copyFile(binary, executable);
await writeFile(join(directory, 'portable.txt'), 'Isolated CI test profile');
const sources = [];
for (let n = 1; n <= 3; n++) {
  const path = join(directory, `source-${n}.webp`);
  await copyFile('public/studio-coast.webp', path);
  sources.push(path);
}
const endpoint = 'http://127.0.0.1:9471';
const app = spawn(executable, [], { env: { ...process.env,
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9471 --remote-debugging-address=127.0.0.1',
}, stdio: ['ignore', 'pipe', 'pipe'] });
let appLog = '';
app.stdout.on('data', b => { appLog += b; });
app.stderr.on('data', b => { appLog += b; });
app.on('error', e => { appLog += e.stack; });
async function targetFor(dropzone) {
  let lastObservation;
  for (let n = 0; n < 240; n++) {
    if (app.exitCode !== null) throw Error(`App exited: ${app.exitCode}\n${appLog}`);
    try {
      const pages = await fetch(endpoint + '/json/list', {signal:AbortSignal.timeout(3000)}).then(r => r.json());
      lastObservation = pages;
      // WebView2 reports targets as "webview", unlike Chrome's "page".
      const page = pages.find(p => p.webSocketDebuggerUrl && (p.url.includes('tauri.localhost') || p.url.startsWith('tauri://localhost')) && p.url.includes('window=dropzone') === dropzone);
      if (page) return page;
    } catch (error) { lastObservation = String(error); }
    await new Promise(r => setTimeout(r, 250));
  }
  throw Error('Timed out waiting for native WebView2\n' + JSON.stringify(lastObservation) + '\n' + appLog);
}
const report = { platform: process.arch, cases: [], pages: [] };
try {
  await floatingBrowser(async ({ evaluate: ev, wait }) => {
    await wait('!!window.picLite?.showDropzoneWindow');
    assert.equal(await ev('picLite.platform'), 'win32');
    const prefs = { theme: 'dark', language: 'en', floatingStyle: 'immersive', interfaceFontScale: 150, autoCheckUpdates: false, clipboardWatcherEnabled: false, allowFloatingCapture: true };
    await ev(`localStorage.setItem('piclite.desktopPreferences.v1',${JSON.stringify(JSON.stringify(prefs))});localStorage.setItem('piclite.desktop.clop-settings.v1',JSON.stringify({appearance:'dark',language:'en',autoHideResults:false,clipboardOptimiser:false,updateCheckFrequency:'never',floatingDisplayMode:'stack',floatingActions:['downscale','watermark','undo','copy','preview','reveal'],showCopyClearButtons:true,preset:{mode:'manual',quality:73,scale:80,format:'webp',stripMetadata:false,preventLarger:false,targetSizeKb:0}}));dispatchEvent(new StorageEvent('storage',{key:'piclite.desktopPreferences.v1'}));picLite.showDropzoneWindow()`);
  }, { endpoint, target: await targetFor(false) });

  await floatingBrowser(async ({ send, evaluate: ev, wait, click }) => {
    await wait('picLite?.windowLabel === "dropzone"');
    await ev('picLite.setContentProtected(false)');
    const preset = await ev('JSON.parse(localStorage.getItem("piclite.desktop.clop-settings.v1")).preset');
    for (let n = 0; n < sources.length; n++) {
      const path = sources[n];
      const original = await readFile(path);
      const [result] = await ev(`picLite.quickCompressPaths([${JSON.stringify(path)}],{mode:'manual',quality:${70 + n},scale:80,format:'image/webp',stripMetadata:true,preventLarger:false,exportMode:'rename',exportSuffix:'-ci'})`);
      assert.ok(result?.output && !result.error, JSON.stringify(result));
      assert.ok((await readFile(result.output)).length > 0);
      assert.deepEqual(await readFile(path), original, 'Source file preserved');
      const event = { type: 'success', file: path, output: result.output, originalBytes: result.originalBytes, outputBytes: result.outputBytes, time: n + 1 };
      await ev(`window.__TAURI_INTERNALS__.invoke('plugin:event|emit',{event:'watcher:event',payload:${JSON.stringify(event)}})`);
      await wait(`document.querySelector('.floating-result-next')?.textContent === '1/${n + 1}' || (${n}===0 && !!document.querySelector('.result-metrics'))`);
    }
    // Native resize commands cap logical dimensions at 520 × 420.
    for (const [width, height] of [[392,330],[520,420],[280,220],[246,188],[460,360]]) {
      await ev(`picLite.resizeDropzoneWindow(${width},${height})`);
      await wait(`Math.abs(innerWidth-${width})<=1 && Math.abs(innerHeight-${height})<=1`);
      for (const style of ['immersive','classic']) for (const theme of ['light','dark']) {
        await ev(`localStorage.setItem('piclite.desktopPreferences.v1',JSON.stringify({...JSON.parse(localStorage.getItem('piclite.desktopPreferences.v1')),theme:'${theme}',floatingStyle:'${style}'}));dispatchEvent(new StorageEvent('storage',{key:'piclite.desktopPreferences.v1'}));document.activeElement?.blur()`);
        await wait(`document.querySelector('main')?.dataset.floatingStyle==='${style}' && document.documentElement.dataset.theme==='${theme}'`);
        await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:width-20,y:height*.4});
        await wait(`getComputedStyle(document.querySelector('.result-hover-actions')).opacity==='1'`);
        const layout = await ev(`(() => {
          const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}};
          return {actions:[...document.querySelectorAll('.result-actions button')].map(rect),footer:[...document.querySelectorAll('.floating-footer button')].map(b=>{const r=rect(b);return{...r,hit:document.elementFromPoint(r.x+r.w/2,r.y+r.h/2)?.closest('button')===b}}),filenames:document.querySelectorAll('.result-name,.floating-filename-badge').length,preview:!!document.querySelector('.result-card img')?.complete};
        })()`);
        assert.equal(layout.actions.length, 6);
        assert.equal(new Set(layout.actions.map(b=>Math.round(b.y))).size, 2);
        assert.equal(new Set(layout.actions.map(b=>Math.round(b.x))).size, 3);
        assert.ok(layout.actions.every(b=>b.x>=0&&b.y>=0&&b.right<=width+1&&b.bottom<=height+1));
        assert.ok(layout.footer.every(b=>b.w>0&&b.h>0&&b.x>=0&&b.right<=width+1&&b.hit), JSON.stringify(layout.footer));
        assert.equal(layout.filenames, 0);
        if (style==='immersive' && width===392) assert.ok(layout.actions.every(b=>b.w>=67&&b.w<=69));
        if (style==='immersive' && width===520) assert.ok(layout.actions.every(b=>b.w>=80&&b.w<=85));
        if (style==='classic') assert.ok(layout.actions.every(b=>b.w===(width<=340?38:42)));
        const metric = await ev('document.querySelector(".result-metrics").textContent');
        await click('.floating-collapse-button');
        await wait('!!document.querySelector(".is-collapsed")');
        assert.equal(await ev('picLite.getFloatingCollapsed()'), true);
        await click('.floating-collapsed-logo');
        await wait('!!document.querySelector(".result-card")');
        assert.equal(await ev('picLite.getFloatingCollapsed()'), false);
        assert.equal(await ev('document.querySelector(".result-metrics").textContent'), metric);
        report.cases.push({width,height,style,theme,button:layout.actions[0].w,footer:layout.footer.length});
        console.log('PASS native WebView2',width,height,style,theme);
        if(width===392&&theme==='dark') {
          const shot=await send('Page.captureScreenshot',{format:'png'});
          await writeFile(join(artifacts,`${style}-${process.arch}.png`),Buffer.from(shot.data,'base64'));
        }
      }
    }
    await ev(`localStorage.setItem('piclite.desktopPreferences.v1',JSON.stringify({...JSON.parse(localStorage.getItem('piclite.desktopPreferences.v1')),floatingStyle:'immersive'}));dispatchEvent(new StorageEvent('storage',{key:'piclite.desktopPreferences.v1'}))`);
    await wait('!!document.querySelector(".floating-result-next")');
    for(let n=0;n<4;n++) {report.pages.push(await ev('document.querySelector(".floating-result-next").textContent'));await click('.floating-result-next');}
    assert.deepEqual(report.pages,['1/3','2/3','3/3','1/3']);
    const order=async()=>{
      await click('.floating-footer button[title="Expand results"]');await wait('!!document.querySelector(".floating-list.list")');
      const images=await ev('[...document.querySelectorAll(".result-metrics")].map(i=>i.textContent)');
      await click('.floating-footer button[title="Stack results"]');await wait('!!document.querySelector(".floating-list.stack")');
      return images;
    };
    const before=await order();assert.equal(before.length,3);assert.equal(new Set(before).size,3);
    await click('.floating-result-next');assert.deepEqual(await order(),before);
    assert.deepEqual(await ev('JSON.parse(localStorage.getItem("piclite.desktop.clop-settings.v1")).preset'),preset);
    report.status='passed';
    await writeFile(join(artifacts,'report.json'),JSON.stringify(report,null,2));
    console.log('PASS Windows packaged app: native compression, source preservation, 20 WebView2 layouts, footer hits, collapse/restore, cyclic paging, stable history and preset preservation');
  }, { endpoint, target: await targetFor(true) });
} finally {
  await writeFile(join(artifacts,'app.log'),appLog);
  if (app.pid) spawnSync('taskkill', ['/PID',String(app.pid),'/T','/F'],{stdio:'ignore'});
  await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:300});
}
