// Run against a freshly built production renderer, not replacement markup/CSS.
// PICLITE_CDP_PORT=9443 PICLITE_TEST_ORIGIN=http://127.0.0.1:1442 node tests/comparison-heading-ui.mjs
import assert from 'node:assert/strict';
const port = process.env.PICLITE_CDP_PORT || 9443;
const origin = process.env.PICLITE_TEST_ORIGIN || 'http://127.0.0.1:1442';
const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {method: 'PUT'}).then(r => r.json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, {once: true}));
let sequence = 0;
const pending = new Map();
ws.addEventListener('message', ({data}) => {
  const m = JSON.parse(data), p = pending.get(m.id);
  if (p) { pending.delete(m.id); if (m.error) p.reject(Error(m.error.message)); else p.resolve(m.result); }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence; pending.set(id, {resolve, reject}); ws.send(JSON.stringify({id, method, params}));
});
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};
const wait = async expression => {
  for (let i = 0; i < 100; i++) {
    try { if (await evaluate(expression)) return; } catch { /* Navigation replaces the execution context. */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw Error(`Timed out: ${expression}`);
};
const errors = [];
const fontBaselines = new Map();
let cases = 0;
try {
  await send('Page.enable');
  await send('Runtime.enable');
  ws.addEventListener('message', ({data}) => {
    const m = JSON.parse(data);
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  });
  await send('Network.enable');
  await send('Network.setCacheDisabled', {cacheDisabled: true});
  // Use the renderer's built-in localhost IPC fixture. All DOM, CSS and images
  // are production code; native encoding is outside this layout regression.
  await send('Page.addScriptToEvaluateOnNewDocument', {source: `
    if (location.origin === ${JSON.stringify(origin)}) {
      const language = new URLSearchParams(location.search).get('language') || 'zh';
      const preferences = {language,theme:'light',density:'auto',interfaceFontScale:110,interfaceFontFamily:'',interfaceFontId:''};
      for (const key of ['piclite.desktopPreferences.v1','piclite.desktop.clop-settings.v1']) localStorage.setItem(key,JSON.stringify(preferences));
      localStorage.setItem('piclite.interfaceStyle.v1','classic');
    }
  `});
  for (const language of ['zh','en']) {
    await send('Emulation.setDeviceMetricsOverride', {width:1120,height:700,deviceScaleFactor:1,mobile:false});
    await send('Page.navigate', {url: `${origin}/?language=${language}`});
    await wait(`!!document.querySelector('.preview-toolbar strong') && document.documentElement.style.getPropertyValue('--interface-font-scale')==='1.1'`);
    assert.equal(await evaluate(`document.querySelector('.app-shell').classList.contains('desktop-app')`), true);
    assert.equal(await evaluate(`document.querySelector('.preview-toolbar .eyebrow').textContent`), language === 'zh' ? '画质对比' : 'VISUAL COMPARISON');
    for (const state of ['empty','image']) {
      if (state === 'image') {
        await send('Emulation.setDeviceMetricsOverride', {width:1120,height:700,deviceScaleFactor:1,mobile:false});
        await evaluate(`document.querySelector('.queue-empty button').click()`);
        await wait(`!!document.querySelector('.compare-canvas img') && [...document.querySelectorAll('.compare-canvas img')].every(img=>img.complete&&img.naturalWidth>0)`);
      }
      for (const layout of ['classic','studio']) for (const scale of [150,110,90]) for (const [width,height] of [[1120,700],[820,540],[1440,900]]) {
        const label = `desktop/${language}/${state}/${layout}/${scale}%/${width}x${height}`;
        await evaluate(`localStorage.setItem('piclite.interfaceStyle.v1',${JSON.stringify(layout)});
          for(const key of ['piclite.desktopPreferences.v1','piclite.desktop.clop-settings.v1'])localStorage.setItem(key,JSON.stringify({...JSON.parse(localStorage.getItem(key)||'{}'),interfaceFontScale:${scale},interfaceFontFamily:'',interfaceFontId:''}));
          window.dispatchEvent(new Event('piclite:interface-style'));window.dispatchEvent(new Event('piclite:interface-typography'));`);
        await send('Emulation.setDeviceMetricsOverride', {width,height,deviceScaleFactor:1,mobile:false});
        await wait(`document.querySelector('.app-shell').classList.contains('${layout}-shell') && document.documentElement.style.getPropertyValue('--interface-font-scale')===String(${scale}/100)`);
        await evaluate(`document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))`);
        const g = await evaluate(`(()=>{
          const rect=el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,w:r.width,h:r.height}};
          const panel=document.querySelector('.preview-panel'),toolbar=panel.querySelector('.preview-toolbar'),heading=toolbar.firstElementChild,stage=panel.querySelector('.preview-stage');
          const text=[...heading.children].map(el=>{const range=document.createRange();range.selectNodeContents(el);return{...rect(el),text:el.textContent,font:parseFloat(getComputedStyle(el).fontSize),display:getComputedStyle(el).display,lines:[...range.getClientRects()].map(r=>({x:r.x,y:r.y,right:r.right,bottom:r.bottom,w:r.width,h:r.height,unoccluded:el.contains(document.elementFromPoint(r.x+1,r.y+r.height/2))})),scroll:el.scrollWidth,client:el.clientWidth}});
          return{viewport:[innerWidth,innerHeight],scale:getComputedStyle(document.documentElement).getPropertyValue('--interface-font-scale'),panel:rect(panel),toolbar:rect(toolbar),stage:rect(stage),heading:rect(heading),headingDisplay:getComputedStyle(heading).display,text,controls:[...toolbar.querySelectorAll('button')].map(el=>{const r=rect(el);return{...r,hit:el.contains(document.elementFromPoint(r.x+r.w/2,r.y+r.h/2))}}),canvas:panel.querySelector('.compare-canvas')?rect(panel.querySelector('.compare-canvas')):null,images:[...panel.querySelectorAll('.compare-canvas img')].map(el=>({naturalWidth:el.naturalWidth,...rect(el)}))};
        })()`);
        const detail = `${label}: ${JSON.stringify(g)}`;
        assert.deepEqual(g.viewport,[width,height],detail);
        assert.notEqual(g.headingDisplay,'none',`heading must not disappear at narrow widths: ${detail}`);
        assert.ok(g.heading.w>0&&g.heading.h>0,detail);
        assert.ok(g.toolbar.bottom<=g.stage.y+1,`preview must not overlap toolbar: ${detail}`);
        const baselineKey = `${language}/${state}/${layout}/${width}`;
        const normalizedFonts = g.text.map(t=>t.font/(scale/100));
        if (!fontBaselines.has(baselineKey)) fontBaselines.set(baselineKey,normalizedFonts);
        assert.ok(normalizedFonts.every((font,i)=>Math.abs(font-fontBaselines.get(baselineKey)[i])<0.05),`computed fonts must change proportionally, not just preference values: ${detail}`);
        for(const text of g.text){
          assert.ok(text.font>=8*scale/100,`text must really scale: ${detail}`);
          assert.ok(text.lines.length>0,detail);
          assert.ok(text.y>=g.toolbar.y-1&&text.bottom<=g.toolbar.bottom+1,`heading fits toolbar: ${detail}`);
          for(const line of text.lines){
            assert.ok(line.y>=g.toolbar.y-1&&line.bottom<=g.toolbar.bottom+1,`full glyph line fits toolbar: ${detail}`);
            assert.ok(line.unoccluded,`text is not covered by preview or controls: ${detail}`);
            if(state==='empty')assert.ok(line.x>=g.toolbar.x-1&&line.right<=g.toolbar.right+1,`full empty text width remains visible: ${detail}`);
          }
        }
        if(state==='empty')assert.ok(g.text.every(t=>t.scroll<=t.client+1),`empty heading must be fully readable, not ellipsized: ${detail}`);
        assert.ok(g.stage.w>=180&&g.stage.h>=180,`retain usable image area: ${detail}`);
        for(const [i,control] of g.controls.entries()){
          assert.ok(control.w>0&&control.h>0&&control.x>=g.toolbar.x-1&&control.right<=g.toolbar.right+1&&control.y>=g.toolbar.y-1&&control.bottom<=g.toolbar.bottom+1,`controls fit toolbar: ${detail}`);
          assert.ok(control.hit,`control centre is not occluded: ${detail}`);
          for(const other of g.controls.slice(i+1))assert.ok(control.right<=other.x+1||other.right<=control.x+1||control.bottom<=other.y+1||other.bottom<=control.y+1,`toolbar controls do not overlap: ${detail}`);
        }
        if(state==='image'){
          assert.ok(g.canvas.w>=150&&g.canvas.h>=150,detail);
          assert.ok(g.canvas.y>=g.stage.y-1&&g.canvas.bottom<=g.stage.bottom+1,`image canvas fits retained stage: ${detail}`);
          assert.ok(g.images.every(img=>img.naturalWidth>0&&img.w>0&&img.h>0),detail);
        }
        cases++;console.log(`PASS ${label} heading=${g.heading.h.toFixed(1)} toolbar=${g.toolbar.h.toFixed(1)} stage=${g.stage.w.toFixed(1)}x${g.stage.h.toFixed(1)} fonts=${g.text.map(t=>t.font).join('/')}`);
        if(state==='image'&&scale===150&&width===820){
          for(const index of [1,2,0]){
            const point=await evaluate(`(()=>{const el=document.querySelectorAll('.preview-mode-tabs button')[${index}],r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
            await send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',buttons:1,clickCount:1});
            await send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',buttons:0,clickCount:1});
            await wait(`document.querySelectorAll('.preview-mode-tabs button')[${index}].classList.contains('active') && !!document.querySelector('.${index===0?'compare-canvas':'image-inspector'} img')`);
            const inspector=await evaluate(`(()=>{const stage=document.querySelector('.preview-stage').getBoundingClientRect(),el=document.querySelector('.preview-stage>.${index===0?'compare-canvas':'image-inspector'}'),r=el.getBoundingClientRect(),img=el.querySelector('img');return{y:r.y,bottom:r.bottom,w:r.width,h:r.height,stageY:stage.y,stageBottom:stage.bottom,loaded:img.complete&&img.naturalWidth>0}})()`);
            assert.ok(inspector.loaded&&inspector.w>=150&&inspector.h>=150&&inspector.y>=inspector.stageY-1&&inspector.bottom<=inspector.stageBottom+1,`real pointer mode switch retains image area: ${label}/${index}: ${JSON.stringify(inspector)}`);
          }
        }
      }
    }
  }
  assert.deepEqual(errors,[],'production renderer should not raise runtime errors');
  assert.equal(cases,72,'complete both languages, empty/image, layouts, font scales and sizes');
  console.log(`PASS ${cases} real production comparison geometry cases; no replacement CSS, root zoom or runtime errors.`);
} finally {
  if (!cases) console.error('Startup diagnostics', await evaluate(`({body:document.body.innerText.slice(0,1000),scale:document.documentElement.style.getPropertyValue('--interface-font-scale')})`), errors);
  ws.close();
  await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`);
}
