import {coverFixture,inspectCoverExport} from "./helpers/cover-export.mjs";
import { apngFixture, verifyCompressedApng, verifyResizedApng } from './apng-fixture.mjs';
import { animatedWebpFixture, verifyWebpToGif } from './animated-webp-fixture.mjs';
// Runs against the real published container, never a fixture renderer or native IPC mock.
// Node 24 + installed Chrome; ORIGIN defaults to Docker's published localhost port.
// Set CDP to a debugging port/HTTP endpoint to reuse an isolated external Chrome.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const origin = new URL(process.env.ORIGIN || 'http://127.0.0.1:3456').origin;
const artifacts = process.env.ARTIFACTS || mkdtempSync(join(tmpdir(), 'piclite-docker-ui-'));
const downloadPath = join(artifacts, 'downloads');
mkdirSync(downloadPath, { recursive: true });
const cdp = process.env.CDP || '9461';
const endpoint = /^https?:/.test(cdp) ? cdp.replace(/\/$/, '') : `http://127.0.0.1:${cdp}`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { origin, image:process.env.IMAGE, digest:process.env.DIGEST, runtime: 'production browser (no native bridge)', geometry: [], outputs: [] };
let chrome, profile, browser, page, browserContextId;
let chromeLog = '';
const runtimeErrors = [];
const failedResponses = [];

async function poll(description, probe, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try { const value = await probe(); if (value) return value; } catch (error) { lastError = error; }
    await delay(100);
  }
  throw new Error(`Timed out: ${description}${lastError ? ` (${lastError.message})` : ''}`);
}

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP socket open timeout')), 15000);
    ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP socket connection failed')); }, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    const request = pending.get(message.id);
    if (request) {
      pending.delete(message.id); clearTimeout(request.timer);
      if (message.error) request.reject(new Error(JSON.stringify(message.error)));
      else request.resolve(message.result);
    } else for (const listener of listeners.get(message.method) || []) listener(message.params);
  });
  ws.addEventListener('close', () => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('CDP socket closed')); }
    pending.clear();
  });
  return {
    close: () => ws.close(),
    on(method, listener) { const current = listeners.get(method) || []; current.push(listener); listeners.set(method, current); },
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
        pending.set(id, { resolve, reject, timer });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
  };
}

async function evaluate(expression) {
  const result = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}
const wait = expression => poll(expression, () => evaluate(expression));
const settle = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
async function move(x, y) { await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); }
async function click(selector) {
  await evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'nearest',inline:'nearest'})`);
  await settle();
  const point = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element || element.disabled) throw new Error('Missing/disabled click target: ' + ${JSON.stringify(selector)});
    const r = element.getBoundingClientRect();
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    if (!r.width || !r.height || !(element === hit || element.contains(hit))) throw new Error('Occluded click target: ' + ${JSON.stringify(selector)});
    return { x, y };
  })()`);
  await move(point.x, point.y);
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
}

async function presentation(layout, scale, width, height = 800) {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await evaluate(`(() => {
    localStorage.setItem('piclite.interfaceStyle.v1', ${JSON.stringify(layout)});
    for (const key of ['piclite.desktopPreferences.v1', 'piclite.desktop.clop-settings.v1']) {
      localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key) || '{}'), interfaceFontScale: ${scale} }));
    }
    window.dispatchEvent(new Event('piclite:interface-style'));
    window.dispatchEvent(new Event('piclite:interface-typography'));
  })()`);
  await wait(`document.querySelector('.app-shell').classList.contains('${layout}-shell') && Number(getComputedStyle(document.documentElement).getPropertyValue('--interface-font-scale')) === ${scale / 100}`);
  await settle();
}

async function heading(state, layout, scale, width) {
  await presentation(layout, scale, width);
  const geometry = await evaluate(`(() => {
    const rect = element => { const r = element.getBoundingClientRect(); return { x:r.x, y:r.y, right:r.right, bottom:r.bottom, width:r.width, height:r.height }; };
    const toolbar = document.querySelector('.preview-toolbar');
    const stage = document.querySelector('.preview-stage');
    const texts = [...toolbar.querySelectorAll(':scope > div:first-child > .eyebrow, :scope > div:first-child > strong')].map(element => {
      const range = document.createRange(); range.selectNodeContents(element);
      const style = getComputedStyle(element);
      const glyphs = [...range.getClientRects()].filter(r => r.width && r.height).map(r => ({x:r.x,y:r.y,right:r.right,bottom:r.bottom}));
      return { text:element.textContent, fontSize:parseFloat(style.fontSize), display:style.display, visibility:style.visibility, opacity:style.opacity, box:rect(element), glyphs, ellipsis:style.textOverflow === 'ellipsis', hits:glyphs.map(r=>{const x=Math.min(r.right,element.getBoundingClientRect().right)-2,y=(r.y+r.bottom)/2;const hit=document.elementFromPoint(x,y);return hit===element||element.contains(hit);}) };
    });
    return { viewport:[innerWidth,innerHeight], toolbar:rect(toolbar), stage:rect(stage), texts, canvas:document.querySelector('.compare-canvas') ? rect(document.querySelector('.compare-canvas')) : null, buttons:[...toolbar.querySelectorAll('button')].map(element=>({label:element.getAttribute('aria-label')||element.textContent,box:rect(element)})) };
  })()`);
  const label = `${state}/${layout}/${scale}%/${width}`;
  assert.deepEqual(geometry.viewport, [width, 800], label);
  assert.equal(geometry.texts.length, 2, `${label}: comparison heading and subtitle must exist`);
  assert.ok(geometry.stage.height > 80, `${label}: retained preview space`);
  assert.ok(geometry.toolbar.bottom <= geometry.stage.y + 1, `${label}: heading cannot overlap preview`);
  for (const text of geometry.texts) {
    assert.ok(text.box.width > 0 && text.box.height > 0 && text.glyphs.length, `${label}: visible heading ${text.text}`);
    assert.notEqual(text.display, 'none'); assert.notEqual(text.visibility, 'hidden'); assert.notEqual(text.opacity, '0');
    for (const glyph of text.glyphs) {
      assert.ok(glyph.y >= geometry.toolbar.y - 1 && glyph.bottom <= geometry.toolbar.bottom + 1, `${label}: glyph line contained in toolbar ${JSON.stringify(text)}`);
      assert.ok(glyph.y >= text.box.y - 1 && glyph.bottom <= text.box.bottom + 1, `${label}: glyph line not vertically clipped`);
      if (!text.ellipsis) assert.ok(glyph.x >= text.box.x - 1 && glyph.right <= text.box.right + 1, `${label}: comparison label not horizontally clipped`);
    }
    assert.ok(text.hits.every(Boolean), `${label}: comparison text must not be covered`);
  }
  if (state === 'image') {
    assert.ok(geometry.canvas?.height > 80, `${label}: real comparison canvas remains visible`);
    assert.ok(geometry.canvas.y >= geometry.stage.y - 1 && geometry.canvas.bottom <= geometry.stage.bottom + 1, `${label}: canvas stays within preview stage`);
  }
  for (const button of geometry.buttons) {
    assert.ok(button.box.height > 0 && button.box.y >= geometry.toolbar.y - 1 && button.box.bottom <= geometry.toolbar.bottom + 1, `${label}: toolbar control contained: ${button.label}`);
  }
  report.geometry.push({ state, layout, scale, width, headingFont:geometry.texts[0].fontSize, titleFont:geometry.texts[1].fontSize, toolbarHeight:geometry.toolbar.height, stageHeight:geometry.stage.height });
  return geometry.texts.map(text => text.fontSize);
}

async function typography(state) {
  for (const layout of ['classic', 'studio']) for (const width of [820, 1120, 1440]) {
    const baseline = await heading(state, layout, 100, width);
    const scaled = await heading(state, layout, 150, width);
    scaled.forEach((value, index) => assert.ok(Math.abs(value / baseline[index] - 1.5) < 0.02, `${state}/${layout}/${width}: production text really scales to 150%, not just its preference`));
  }
  console.log(`PASS real production comparison typography: ${state}, classic/studio, 100/150%, 820/1120/1440px`);
}

async function welcomeLayout() {
  report.welcome = [];
  // Effective CSS viewports after browser zoom, plus a phone-width layout.
  for (const [width,height] of [[1386,792],[1109,634],[924,528],[960,540],[853,480],[390,844]]) {
    await presentation('studio',150,width,height);
    const geometry = await evaluate(`(() => {
      const welcome=document.querySelector('.studio-welcome'),stage=document.querySelector('.preview-stage').getBoundingClientRect();
      return {overflow:getComputedStyle(welcome).overflowY,scroll:welcome.scrollHeight,client:welcome.clientHeight,
        actions:[...welcome.querySelectorAll('.studio-import button')].map(button=>{const r=button.getBoundingClientRect();return {inside:r.width>0&&r.height>0&&r.x>=stage.x-1&&r.right<=stage.right+1&&r.y>=stage.y-1&&r.bottom<=stage.bottom+1,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===button}}),
        settingsOverflow:getComputedStyle(document.querySelector('.settings-scroll-content')).overflowY};
    })()`);
    const label=JSON.stringify({width,height,...geometry});
    assert.equal(geometry.overflow,'visible',label);
    assert.ok(geometry.scroll<=geometry.client+1,label);
    assert.equal(geometry.actions.length,2,label);
    assert.ok(geometry.actions.every(action=>action.inside),label);
    if(width>800){assert.ok(geometry.actions.every(action=>action.hit),label);assert.equal(geometry.settingsOverflow,'auto',label);}
    report.welcome.push({width,height,...geometry});
  }
  console.log('PASS zoomed studio welcome: no nested scroll, import actions visible, settings scroll retained');
}

async function importImage(name) {
  return evaluate(`(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 400;
    const context = canvas.getContext('2d'); const image = context.createImageData(640, 400);
    let seed = 123456789;
    for (let offset = 0; offset < image.data.length; offset += 4) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const x = (offset / 4) % 640, y = Math.floor(offset / 2560), noise = seed >>> 27;
      image.data[offset] = Math.min(255, 30 + x / 4 + noise);
      image.data[offset+1] = Math.min(255, 40 + y / 2 + noise);
      image.data[offset+2] = Math.min(255, 80 + (x+y) / 6 + noise); image.data[offset+3] = 255;
    }
    context.putImageData(image, 0, 0);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Fixture PNG encoding failed');
    const input = document.querySelector('input[type=file][multiple]:not([webkitdirectory])');
    if (!input) throw new Error('Browser import input missing');
    const files = new DataTransfer(); files.items.add(new File([blob], ${JSON.stringify(name)}, {type:'image/png'}));
    input.files = files.files; input.dispatchEvent(new Event('change', {bubbles:true}));
    return { bytes:blob.size, width:canvas.width, height:canvas.height };
  })()`);
}

async function output(previousUrl = null, expectedDimensions = [640, 400]) {
  await wait(`(() => {
    const preview = document.querySelector('.compare-after');
    return !!document.querySelector('.item-status.done') && preview?.complete && preview.naturalWidth > 0 && preview.src !== ${JSON.stringify(previousUrl)};
  })()`);
  assert.equal(await evaluate(`!!document.querySelector('.browser-floating-result')`), false, 'Results stay in the workbench');
  const value = await evaluate(`(async () => {
    const preview = document.querySelector('.compare-after');
    const blob = await fetch(preview.src).then(response => response.blob());
    const bitmap = await createImageBitmap(blob);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const result = {type:blob.type,bytes:blob.size,width:bitmap.width,height:bitmap.height,head:[...bytes.slice(0,16)],url:preview.src};
    bitmap.close(); return result;
  })()`);
  assert.match(value.type, /^image\//); assert.ok(value.bytes > 0);
  if (expectedDimensions) assert.deepEqual([value.width, value.height], expectedDimensions);
  return value;
}

async function responsivePreferences() {
  report.preferences = [];
  await evaluate(`document.querySelector('.main-nav button').click()`);
  await wait(`!!document.querySelector('.workspace')`);
  for (const layout of ['classic', 'studio']) for (const [width, height] of [[390,844],[768,1024],[1440,900],[2560,1440]]) {
    await presentation(layout, 150, width);
    await page.send('Emulation.setDeviceMetricsOverride', {width,height,deviceScaleFactor:1,mobile:false});
    await click('.settings-entry-button');
    await wait(`!!document.querySelector('.clop-preferences')`);
    const preferenceLabels = await evaluate(`[...document.querySelectorAll('.clop-preferences nav button, .clop-preferences-content .preference-row strong')].map(element => element.textContent)`);
    assert.ok(!preferenceLabels.some(label => /Floating Results|Dismiss result after/.test(label)), 'Floating settings are desktop only');
    await settle();
    const geometry = await evaluate(`(() => {
      const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,w:r.width,h:r.height}};
      const panel=document.querySelector('.clop-preferences'),nav=panel.querySelector('aside'),content=panel.querySelector('.clop-preferences-content');
      return {nav:rect(nav),content:rect(content),navButtons:[...nav.querySelectorAll('button')].map(rect),overflow:document.documentElement.scrollWidth>innerWidth+1,contentOverflow:content.scrollWidth>content.clientWidth+1};
    })()`);
    const label=`${layout}/${width}x${height}/150%`;
    assert.equal(geometry.overflow,false,label+': no page overflow');
    assert.equal(geometry.contentOverflow,false,label+': no settings overflow');
    assert.ok(geometry.content.w>Math.min(width*.65,500),label+': usable content width');
    assert.ok(geometry.content.bottom<=height+1,label+': content contained in viewport');
    if(width<=720) {
      assert.ok(geometry.nav.h<85 && geometry.content.y>=geometry.nav.bottom-1,label+': horizontal phone navigation');
      assert.ok(geometry.navButtons.every(button=>button.h>=38),label+': usable phone targets');
    } else assert.ok(geometry.content.x>=geometry.nav.right-1 && geometry.nav.w<230,label+': sidebar and content');
    const shot=await page.send('Page.captureScreenshot',{format:'png'});
    writeFileSync(join(artifacts,`settings-${layout}-${width}.png`),Buffer.from(shot.data,'base64'));
    await evaluate(`document.querySelector('.preferences-sidebar nav button:last-child').click()`);
    await wait(`!!document.querySelector('.about-product')`);
    await evaluate(`document.querySelector('.preferences-sidebar nav button:first-child').click()`);
    await wait(`!!document.querySelector('.interface-typography-controls')`);
    await evaluate(`document.querySelector('.main-nav button').click()`);
    await wait(`!!document.querySelector('.workspace')`);
    report.preferences.push({layout,width,height,fontScale:150,...geometry});
  }
  console.log('PASS actual container responsive settings: 390/768/1440/2560px, classic/studio, 150% text and category changes');
}

try {
  if (!process.env.CDP) {
    profile = mkdtempSync(join(tmpdir(), 'piclite-docker-chrome-'));
    const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    const executable = process.env.CHROME_BIN || (existsSync(macChrome) ? macChrome : 'google-chrome');
    chrome = spawn(executable, ['--headless=new', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9461', `--user-data-dir=${profile}`, 'about:blank'], {stdio:['ignore','ignore','pipe']});
    chrome.on('error', error => { chromeLog += error.message; });
    chrome.stderr.on('data', data => { chromeLog = (chromeLog + data).slice(-5000); });
  }
  const version = await poll('Chrome CDP endpoint', async () => {
    const response = await fetch(`${endpoint}/json/version`, {signal:AbortSignal.timeout(2000)});
    if (!response.ok) return false; return response.json();
  });
  report.chrome = version.Browser;
  browser = await connect(version.webSocketDebuggerUrl);
  ({ browserContextId } = await browser.send('Target.createBrowserContext'));
  const { targetId } = await browser.send('Target.createTarget', {url:'about:blank', browserContextId});
  const target = await poll('isolated page target', async () => (await fetch(`${endpoint}/json/list`).then(response=>response.json())).find(item=>item.id===targetId));
  page = await connect(target.webSocketDebuggerUrl);
  page.on('Runtime.exceptionThrown', ({exceptionDetails}) => runtimeErrors.push(exceptionDetails.exception?.description || exceptionDetails.text));
  // Chromium requests this optional icon even when the app declares none.
  page.on('Network.responseReceived', ({response}) => { if (response.status >= 400 && response.url.startsWith(origin + '/') && new URL(response.url).pathname !== '/favicon.ico') failedResponses.push({url:response.url,status:response.status}); });
  await page.send('Runtime.enable'); await page.send('Page.enable'); await page.send('Network.enable');
  await page.send('Network.setCacheDisabled', {cacheDisabled:true});
  await page.send('Emulation.setDeviceMetricsOverride', {width:1120,height:800,deviceScaleFactor:1,mobile:false});
  const navigation=await page.send('Page.navigate', {url:origin});
  assert.ok(!navigation.errorText,`Production navigation failed: ${navigation.errorText}`);
  // Fresh context initially matches SSR defaults; seed only after the app effects
  // attach. Pre-hydration English preferences would manufacture React error 418.
  await wait(`!!document.querySelector('.app-shell.web-app .preview-toolbar') && !!document.documentElement.dataset.density`);
  await evaluate(`(() => {
    localStorage.setItem('piclite.interfaceStyle.v1', 'classic');
    localStorage.setItem('piclite.workspacePlugins.v2', JSON.stringify(['rename','watcher','convert','resize','gallery'].map(id=>({id,kind:'builtin',enabled:true}))));
    const preferences={language:'en',theme:'light',dockTheme:'light',colorTheme:'graphite',interfaceFontScale:100,interfaceFontFamily:'',interfaceFontId:'',floatingStyle:'immersive',floatingResultSeconds:0,floatingAutoHideSeconds:0};
    for(const key of ['piclite.desktopPreferences.v1','piclite.desktop.clop-settings.v1']) localStorage.setItem(key,JSON.stringify({...JSON.parse(localStorage.getItem(key)||'{}'),...preferences}));
    for(const key of ['piclite.desktopPreferences.v1','piclite.workspacePlugins.v2']) window.dispatchEvent(new StorageEvent('storage',{key}));
    window.dispatchEvent(new Event('piclite:interface-style'));
    window.dispatchEvent(new Event('piclite:interface-typography'));
  })()`);
  await wait(`document.documentElement.lang === 'en' && !!document.querySelector('[data-tool-id=convert]')`);
  assert.equal(await evaluate('!!window.picLite || !!window.__TAURI_INTERNALS__'), false, 'No native bridge or fixture IPC');
  const tools = await evaluate(`[...document.querySelectorAll('[data-tool-id]')].map(element=>element.dataset.toolId)`);
  for (const id of ['workspace','convert','resize','gallery']) assert.ok(tools.includes(id), `Browser tool ${id}`);
  for (const id of ['watcher','rename']) assert.ok(!tools.includes(id), `No native-only ${id} placeholder`);
  await typography('empty');
  await welcomeLayout();
  await presentation('classic',150,1120);
  const source = await importImage('docker-smoke-source.png');
  const encoded = await output();
  assert.ok(encoded.bytes < source.bytes, 'Real default smart compression must reduce this deterministic PNG fixture');
  report.outputs.push({source,...encoded});
  const queueCount = await evaluate(`document.querySelectorAll('.queue-item').length`);
  await importImage('docker-smoke-renamed.png');
  await wait(`document.querySelector('.toast')?.textContent.includes('duplicate images')`);
  assert.equal(await evaluate(`document.querySelectorAll('.queue-item').length`), queueCount, 'Importing identical bytes twice keeps one queue item');
  await typography('image');
  await presentation('classic',150,1120);
  await evaluate(`(() => {
    const quality = document.querySelector('#quality-range');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(quality, '60');
    quality.dispatchEvent(new Event('input', {bubbles:true}));
  })()`);
  const liveResult = await output(encoded.url);
  await click('button.compress-button');
  const reprocessed = await output(liveResult.url);
  report.outputs.push(liveResult, reprocessed);
  const downloads = new Map();
  browser.on('Browser.downloadWillBegin', event => downloads.set(event.guid, {...event}));
  browser.on('Browser.downloadProgress', event => { const current=downloads.get(event.guid); if(current)Object.assign(current,event); });
  await browser.send('Browser.setDownloadBehavior', {behavior:'allowAndName',downloadPath,browserContextId,eventsEnabled:true});
  await click('.result-strip [aria-label="Export selected image"]');
  const download = await poll('actual browser download completion', () => [...downloads.values()].find(item=>item.state==='completed'));
  assert.match(download.suggestedFilename, /^docker-smoke-source.*\.(?:png|jpe?g|webp)$/i);
  const filePath = join(downloadPath, download.guid);
  await poll('download bytes on disk', () => existsSync(filePath));
  const saved = readFileSync(filePath);
  assert.ok(saved.length > 0); assert.equal(saved.length,reprocessed.bytes,'Downloaded file is the actual compressed output');
  assert.deepEqual([...saved.subarray(0,16)], reprocessed.head, 'Downloaded image magic matches encoded output');
  const decoded = await evaluate(`(async()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(saved.toString('base64'))}),c=>c.charCodeAt(0));const bitmap=await createImageBitmap(new Blob([bytes],{type:${JSON.stringify(reprocessed.type)}}));const result=[bitmap.width,bitmap.height];bitmap.close();return result;})()`);
  assert.deepEqual(decoded,[640,400], 'Downloaded bytes decode as a real image');
  report.download={filename:download.suggestedFilename,bytes:saved.length,decoded};
  await wait(`!document.querySelector('.toast')`);
  await click('.reset-button');
  const setNumeric = (selector, value) => evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(String(value))});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const targetKb = process.env.PICLITE_TEST_APNG ? 200 : 10;
  await setNumeric('#target-size-input', targetKb);
  await setNumeric('#scale-range', 73.4);
  const targetAnimation = process.env.PICLITE_TEST_APNG ? readFileSync(process.env.PICLITE_TEST_APNG) : apngFixture({ noisy: true });
  await evaluate(`(()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(targetAnimation.toString('base64'))}),c=>c.charCodeAt(0));const dt=new DataTransfer();dt.items.add(new File([bytes],'target-limit.apng',{type:'image/apng'}));const input=document.querySelector('input[type=file][multiple]:not([webkitdirectory])');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await wait(`document.querySelector('.queue-item:last-child strong')?.textContent.includes('target-limit.apng')`);
  await click('.queue-item:last-child');
  const targetResult = await output(null, null);
  assert.ok(targetResult.width < 188 && targetResult.height < 188, `Target continues shrinking below the requested 188 px: ${targetResult.width} × ${targetResult.height}`);
  assert.ok(targetResult.bytes <= targetKb * 1000, `APNG target size is honoured after an explicit scale: ${targetResult.bytes} bytes`);
  const targetBytes = Buffer.from(await evaluate(`(async()=>Array.from(new Uint8Array(await fetch(document.querySelector('.compare-after').src).then(r=>r.arrayBuffer()))))()`));
  const frames = verifyResizedApng(targetAnimation, targetBytes, targetResult.width, targetResult.height).frames.length;
  assert.match(await evaluate(`document.querySelector('.settings-footer .live-size-card').textContent`), new RegExp(`≤ ${targetKb} KB`));
  assert.match(await evaluate(`document.querySelector('.settings-footer .compress-button').textContent`), /Apply to all · 2 images/);
  await evaluate(`document.querySelector('.settings-scroll-content').scrollTop = 0`);
  const footerTop = await evaluate(`document.querySelector('.settings-footer').getBoundingClientRect().top`);
  await evaluate(`document.querySelector('.settings-scroll-content').scrollTop = 1000`);
  assert.equal(await evaluate(`document.querySelector('.settings-footer').getBoundingClientRect().top`), footerTop);
  report.apngTarget={bytes:targetResult.bytes,width:targetResult.width,height:targetResult.height,frames};
  console.log('PASS APNG target with explicit resize, queue deduplication, and fixed footer', report.apngTarget);
  const footerScreenshot = await page.send('Page.captureScreenshot', {format:'png'});
  writeFileSync(join(artifacts,'apng-target-footer.png'), Buffer.from(footerScreenshot.data, 'base64'));
  for (const [id, selector] of [['convert','.browser-image-tool[data-tool="convert"]'],['resize','.browser-image-tool[data-tool="resize"]'],['gallery','.gallery-page']]) {
    await click('[data-tool-id='+id+']');
    await wait(`!!document.querySelector('${selector}')`);
    assert.equal(await evaluate(`!!document.querySelector('section.workspace')`),false,`${id} tab must open its own page`);
    assert.equal(await evaluate(`document.querySelector('[data-tool-id=${id}]').getAttribute('aria-current')`),'page');
  }
  console.log('PASS actual container tool navigation: distinct converter, resize and gallery pages');
  await click('[data-tool-id=convert]');
  await evaluate(`(async()=>{const canvas=document.createElement('canvas');canvas.width=160;canvas.height=100;const ctx=canvas.getContext('2d');ctx.fillStyle='#287e9b';ctx.fillRect(0,0,160,100);const blob=await new Promise(r=>canvas.toBlob(r));const dt=new DataTransfer();dt.items.add(new File([blob],'container-tool.png',{type:'image/png'}));const input=document.querySelector('.browser-image-tool input[type=file]');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await wait(`document.querySelectorAll('.web-tool-item').length===1`);
  await evaluate(`(()=>{const select=document.getElementById('web-tool-format');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'image/jpeg');select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await click('.web-tool-run');await wait(`!!document.querySelector('.web-tool-item.done')`);
  const convertedTool=await evaluate(`(async()=>{const blob=await fetch(document.querySelector('.web-tool-result img').src).then(r=>r.blob());const bitmap=await createImageBitmap(blob);return{type:blob.type,width:bitmap.width,height:bitmap.height,bytes:blob.size}})()`);
  assert.equal(convertedTool.type,'image/jpeg');assert.deepEqual([convertedTool.width,convertedTool.height],[160,100]);
  await click('[data-tool-id=resize]');
  await evaluate(`(()=>{const input=document.getElementById('web-resize-scale');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'50');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await click('.web-tool-run');await wait(`document.querySelector('.web-tool-result img')?.naturalWidth===80`);
  const resizedTool=await evaluate(`(async()=>{const blob=await fetch(document.querySelector('.web-tool-result img').src).then(r=>r.blob());const bitmap=await createImageBitmap(blob);return{type:blob.type,width:bitmap.width,height:bitmap.height,bytes:blob.size}})()`);
  assert.deepEqual([resizedTool.width,resizedTool.height],[80,50]);
  await click('[data-tool-id=convert]');
  const animation = apngFixture({ partial: true, indexed: true });
  await evaluate(`(()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(animation.toString('base64'))}),c=>c.charCodeAt(0));const dt=new DataTransfer();dt.items.add(new File([bytes],'container-animation.apng',{type:'image/apng'}));const input=document.querySelector('.browser-image-tool input[type=file]');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await wait(`document.querySelector('.browser-image-tool .web-tool-item:last-child strong')?.textContent==='container-animation.apng'`);
  await evaluate(`(()=>{const select=document.getElementById('web-tool-format');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'image/png');select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await evaluate(`(()=>{const input=document.getElementById('web-tool-quality');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'100');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await click('.web-tool-run');
  await wait(`document.querySelectorAll('.browser-image-tool .web-tool-item.done').length===2`);
  await click('.browser-image-tool .web-tool-item:last-child .web-tool-select');
  const animationOutput = await evaluate(`(async()=>Array.from(new Uint8Array(await fetch(document.querySelector('.web-tool-result img').src).then(r=>r.arrayBuffer()))))()`);
  verifyCompressedApng(animation, Buffer.from(animationOutput));
  await click('[data-tool-id=resize]');
  await click('.browser-image-tool .web-tool-item:last-child .web-tool-select');
  await evaluate(`(()=>{const input=document.getElementById('web-tool-quality');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'45');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await click('.web-tool-run');
  await wait(`document.querySelector('.browser-image-tool .web-tool-result img')?.naturalWidth===16`);
  const scaledAnimation = await evaluate(`(async()=>Array.from(new Uint8Array(await fetch(document.querySelector('.web-tool-result img').src).then(r=>r.arrayBuffer()))))()`);
  assert.equal(verifyResizedApng(animation, Buffer.from(scaledAnimation), 16, 12).header[9], 3, 'lossy resize keeps indexed pixels');
  await click('[data-tool-id=convert]');
  const webp = animatedWebpFixture().toString('base64');
  await evaluate(`(()=>{const dt=new DataTransfer();dt.items.add(new File([Uint8Array.from(atob(${JSON.stringify(webp)}),c=>c.charCodeAt(0))],'animated.webp',{type:'image/webp'}));const input=document.querySelector('.browser-image-tool input[type=file]');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await wait(`document.querySelector('.browser-image-tool .web-tool-item:last-child strong')?.textContent==='animated.webp'`);
  await evaluate(`(()=>{const select=document.getElementById('web-tool-format');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'image/gif');select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await click('.web-tool-run');
  await wait(`document.querySelector('.browser-image-tool .web-tool-item:last-child')?.classList.contains('done')`);
  await click('.browser-image-tool .web-tool-item:last-child .web-tool-select');
  const gifOutput = await evaluate(`(async()=>Array.from(new Uint8Array(await fetch(document.querySelector('.web-tool-result img').src).then(r=>r.arrayBuffer()))))()`);
  await verifyWebpToGif(Buffer.from(gifOutput));
  await click('[data-tool-id=gallery]');await wait(`document.querySelectorAll('.gallery-card').length>0`);
  report.independentTools={converted:convertedTool,resized:resizedTool,galleryRecords:await evaluate(`document.querySelectorAll('.gallery-card').length`)};
  console.log('PASS actual container independent tool outputs',JSON.stringify(report.independentTools));
  await responsivePreferences();
  assert.deepEqual(runtimeErrors,[],'No uncaught production runtime exceptions');
  assert.deepEqual(failedResponses,[],'No failed same-origin production requests');
  await evaluate(`localStorage.setItem('piclite.cover-preset.v1',${JSON.stringify(JSON.stringify(coverFixture))})`);
  await click('[data-tool-id=banner]');
  await wait(`!!document.querySelector('.banner-page iframe')?.contentWindow.picLiteCover`);
  report.cover=await evaluate(`(${inspectCoverExport.toString()})()`);
  assert.deepEqual([report.cover.width,report.cover.height],[200,200]);
  assert.equal(report.cover.type,'image/png');
  assert.ok(report.cover.partial>40 && report.cover.boundaryPixels>40 && report.cover.meanEdgeError<.04 && report.cover.maxError<.12,JSON.stringify(report.cover));
  console.log('PASS actual container rounded cover export',report.cover);
  report.status='passed';
  console.log('PASS Docker UI smoke:',JSON.stringify({geometryCases:report.geometry.length,sourceBytes:source.bytes,outputBytes:encoded.bytes,download:report.download,chrome:report.chrome}));
} catch (error) {
  report.status='failed';report.error=error.stack;report.runtimeErrors=runtimeErrors;report.failedResponses=failedResponses;report.chromeLog=chromeLog;
  if(page) {
    try { report.page=await evaluate(`({url:location.href,body:document.body.innerText.slice(-3000)})`); } catch { /* The failing page may already be closed. */ }
    try { const {data}=await page.send('Page.captureScreenshot',{format:'png'});writeFileSync(join(artifacts,'failure.png'),Buffer.from(data,'base64')); } catch { /* Preserve the original error if screenshot capture fails. */ }
  }
  console.error(error.stack); process.exitCode=1;
} finally {
  writeFileSync(join(artifacts,'report.json'),JSON.stringify(report,null,2));
  console.log(`Docker UI evidence: ${artifacts}`);
  page?.close();
  if(browserContextId && browser) { try {await browser.send('Target.disposeBrowserContext',{browserContextId});}catch{ /* Chrome may already have exited. */ } }
  browser?.close();
  if(chrome) {
    chrome.kill('SIGTERM');
    await Promise.race([new Promise(resolve=>chrome.once('exit',resolve)),delay(3000)]);
    if(chrome.exitCode===null) { chrome.kill('SIGKILL'); await delay(200); }
  }
  if(profile)rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
