// Actual Vite renderer geometry: no fixture markup or replacement styles.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const port = process.env.PICLITE_CDP_PORT || 9457;
const origin = process.env.PICLITE_TEST_ORIGIN || 'http://127.0.0.1:1457';
const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
const ws = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let sequence = 0;
const pending = new Map();
ws.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  if (!pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  message.error ? reject(Error(message.error.message)) : resolve(message.result);
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence; pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};
const wait = async expression => {
  for (let i = 0; i < 100; i++) {
    try { if (await evaluate(expression)) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error(`UI condition timed out: ${expression}`);
};
const resize = async (width, height) => {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  assert.deepEqual(await evaluate('[innerWidth,innerHeight]'), [width, height]);
};
const sizes = [[820, 540], [1120, 700], [1440, 900]];
const rectFunction = `el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}}`;
try {
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `if(location.origin===${JSON.stringify(origin)}){localStorage.setItem('piclite.interfaceStyle.v1','classic');localStorage.setItem('piclite.desktopPreferences.v1',JSON.stringify({language:'en',theme:'light'}));}` });
  await send('Page.navigate', { url: origin });
  await wait('!!document.querySelector(".result-strip")');
  assert.equal(await evaluate('!!document.querySelector(".desktop-app")'), true, 'exercise desktop renderer');
  for (const layout of ['classic', 'studio']) {
    await evaluate(`localStorage.setItem('piclite.interfaceStyle.v1',${JSON.stringify(layout)});window.dispatchEvent(new Event('piclite:interface-style'))`);
    await wait(`!!document.querySelector('.${layout}-shell')`);
    for (const state of ['empty', 'loaded']) {
      if (state === 'loaded') {
        await evaluate(`(async()=>{const c=document.createElement('canvas');c.width=640;c.height=400;const ctx=c.getContext('2d');ctx.fillStyle='#5083b2';ctx.fillRect(0,0,640,400);ctx.fillStyle='#efc35d';ctx.fillRect(80,80,200,200);const blob=await new Promise(r=>c.toBlob(r,'image/png'));const transfer=new DataTransfer();transfer.items.add(new File([blob],'layout-regression.png',{type:'image/png'}));const input=document.querySelector('input[type=file][accept^="image/*"]:not([webkitdirectory])');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
        await wait('!!document.querySelector(".queue-item") && !document.querySelector(".result-strip > .icon-button").disabled');
        await wait('[...document.querySelectorAll(".preview-stage img")].some(img=>img.naturalWidth>0)');
      }
      for (const [width, height] of sizes) {
        await resize(width, height);
        const geometry = await evaluate(`(()=>{const rect=${rectFunction};const strip=document.querySelector('.result-strip');return {strip:rect(strip),controls:[...strip.querySelectorAll(':scope > button')].map(el=>({...rect(el),disabled:el.disabled,clipped:el.scrollWidth>el.clientWidth+1})),children:[...strip.children].filter(el=>getComputedStyle(el).display!=='none').map(rect)}})()`);
        assert.equal(geometry.controls.length, 2, 'both export controls exist');
        const [current, all] = geometry.controls;
        assert.ok(current.right + 5 <= all.x && all.x - current.right <= 12, `${layout}/${state}/${width}: export spacing must be 5–12px: ${JSON.stringify(geometry)}`);
        for (const control of geometry.controls) {
          assert.equal(control.disabled, state === 'empty', `${layout}/${state}: disabled state`);
          assert.ok(control.width >= 30 && control.height >= 30, 'usable export targets');
          assert.ok(control.x >= geometry.strip.x && control.right <= geometry.strip.right + 1 && control.bottom <= height && control.y >= 0, 'exports inside footer and viewport');
          assert.equal(control.clipped, false, 'export label is not clipped');
        }
        for (let i=1;i<geometry.children.length;i++) assert.ok(geometry.children[i-1].right<=geometry.children[i].x+1,'footer content must not overlap');
        for(const theme of ['light','dark']) {
          await evaluate(`Object.assign(document.documentElement.dataset,{material:'glass',theme:'${theme}',transparency:'full',nativeMaterial:'glass'});new Promise(r=>setTimeout(r,300))`);
          const colors=await evaluate(`([...document.querySelectorAll('.result-strip > button')].map(b=>{const c=getComputedStyle(b);return{bg:c.backgroundColor,fg:c.color,opacity:c.opacity,disabled:b.disabled}}))`);
          const rgb=s=>s.match(/[\d.]+/g).map(Number),light=s=>{const a=rgb(s).slice(0,3).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4});return a[0]*.2126+a[1]*.7152+a[2]*.0722};
          for(const c of colors){assert.equal(c.disabled,state==='empty');assert.ok(theme==='light'?light(c.bg)>light(c.fg):light(c.bg)<light(c.fg),'export colour inverted: '+JSON.stringify(c));if(!c.disabled){assert.equal(c.opacity,'1');const l1=light(c.bg),l2=light(c.fg);assert.ok((Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05)>4.5,'contrast');}else assert.equal(c.opacity,'0.55');}
          assert.equal(colors[0].bg,colors[1].bg,'both export controls must use same surface');
          if(width===1120&&state==='loaded'){const image=await send('Page.captureScreenshot',{format:'png'});const dir='/Users/amiao/.hermes/cache/scratch/piclite-ui-v7';mkdirSync(dir,{recursive:true});writeFileSync(`${dir}/exports-${layout}-${theme}.png`,Buffer.from(image.data,'base64'));}
        }
        await evaluate(`Object.assign(document.documentElement.dataset,{theme:'light',material:'standard',nativeMaterial:'none'})`);
        console.log(`PASS exports ${layout} ${state} ${width}x${height}: gap=${(all.x-current.right).toFixed(1)}, glass colours/contrast/light/dark/disabled`);
      }
      if (state === 'loaded') {
        await evaluate(`[...document.querySelectorAll('button')].find(el=>el.textContent.trim()==='Clear'||el.textContent.trim()==='清空').click()`);
        await wait('document.querySelectorAll(".queue-item").length===0');
      }
    }
  }
  // Use the real preferences window entry and CSS import order.
  await send('Page.navigate', { url: `${origin}/?window=preferences` });
  await wait('document.querySelectorAll(".settings-palette").length===5');
  for (const [width, height] of sizes) {
    await resize(width, height);
    const geometry = await evaluate(`(()=>{const rect=${rectFunction};const picker=document.querySelector('.settings-palette-picker');const row=picker.closest('.settings-row');return {row:rect(row),label:rect(row.firstElementChild),picker:rect(picker),cards:[...picker.children].map(el=>({...rect(el),clipped:el.querySelector('b').scrollWidth>el.querySelector('b').clientWidth+1}))}})()`);
    assert.equal(geometry.cards.length, 5);
    assert.ok(geometry.picker.width >= geometry.row.width - 30, 'palette uses row width without a blank label column');
    assert.ok(geometry.label.bottom <= geometry.picker.y && geometry.picker.y - geometry.label.bottom <= 16, 'palette sits directly under label');
    assert.ok(new Set(geometry.cards.map(r=>Math.round(r.y))).size <= 2, 'five palettes fit in at most two rows');
    for (const card of geometry.cards) {
      assert.ok(card.width >= 105 && card.height >= 40 && card.x >= geometry.row.x && card.right <= geometry.row.right && card.bottom <= height, 'palette cards fit and remain visible');
      assert.equal(card.clipped,false,'palette label fits');
    }
    for(let i=0;i<geometry.cards.length;i++)for(let j=i+1;j<geometry.cards.length;j++){
      const a=geometry.cards[i],b=geometry.cards[j];assert.ok(a.right<=b.x||b.right<=a.x||a.bottom<=b.y||b.bottom<=a.y,'palette cards do not overlap');
    }
    console.log(`PASS preferences ${width}x${height}: ${geometry.picker.width.toFixed(1)}px / ${new Set(geometry.cards.map(r=>Math.round(r.y))).size} rows`);
  }
  await evaluate('document.querySelector(".settings-palette.violet").click()');
  await wait('document.querySelector(".settings-palette.violet").getAttribute("aria-pressed")==="true"');
  assert.equal(await evaluate('JSON.parse(localStorage.getItem("piclite.desktop.clop-settings.v1")).colorTheme'),'violet');
  console.log('PASS palette selection persists');
} finally { ws.close(); }
