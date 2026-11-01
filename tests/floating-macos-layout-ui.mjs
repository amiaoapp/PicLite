// Run against npm run desktop:renderer served at ORIGIN, with a dedicated CDP.
// Compression is stubbed; this validates UI state and real pointer hits only.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { floatingBrowser } from './helpers/floating-test-browser.mjs';

const origin = process.env.ORIGIN || 'http://127.0.0.1:1549';
const artifacts = resolve(process.env.ARTIFACTS || 'work/floating-macos-layout');
mkdirSync(artifacts, { recursive: true });
const report = [];
await floatingBrowser(async ({ send, evaluate: ev, wait, click }) => {
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    localStorage.clear();
    localStorage.setItem('piclite.desktopPreferences.v1',JSON.stringify({theme:'dark',language:'en',floatingStyle:'immersive',interfaceFontScale:150}));
    localStorage.setItem('piclite.desktop.clop-settings.v1',JSON.stringify({appearance:'dark',language:'en',floatingCornerRadius:18,autoHideResults:false,updateCheckFrequency:'never',floatingDisplayMode:'stack',preset:{mode:'manual',quality:73,scale:80,format:'webp',stripMetadata:false,preventLarger:false,targetSizeKb:0}}));
    let api; window.calls=[];
    Object.defineProperty(window,'picLite',{configurable:true,get(){return api},set(value){
      const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=600;
      const ctx=canvas.getContext('2d');ctx.fillStyle='#e7e8da';ctx.fillRect(0,0,1000,600);
      const data=Uint8Array.from(atob(canvas.toDataURL().split(',')[1]),c=>c.charCodeAt(0));
      api={...value,windowLabel:'dropzone',getFloatingCollapsed:async()=>false,
        setFloatingCollapsed:async value=>calls.push(['collapse',value]),
        registerFloatingControlRegion:async()=>{},unregisterFloatingControlRegion:async()=>{},
        takePendingClipboard:async()=>null,onWatcherEvent:callback=>{window.publishResult=callback;return()=>{}},
        readImagesFromPaths:async paths=>paths.map(path=>({path,type:'image/png',data,width:1000,height:600})),
        showMainWindow:async()=>calls.push(['workbench']),hideCurrentWindow:async()=>calls.push(['hide']),
        configureFloatingBehavior:async()=>{},onTrayAction:()=>()=>{},loadImportedFonts:async()=>[]};
    }});
  ` });
  await send('Emulation.setDeviceMetricsOverride', { width: 392, height: 330, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: origin + '/?window=dropzone' });
  await wait('typeof publishResult === "function"');
  for (let n = 1; n <= 3; n++) {
    const before = await ev('document.querySelector(".result-metrics")?.textContent');
    await ev(`publishResult({type:'success',file:'/private-test-image-${n}.png',output:'/private-test-image-${n}.png',time:${n},originalBytes:${n*10000},outputBytes:${n*2000}})`);
    await wait(`!!document.querySelector('.result-metrics') && document.querySelector('.result-metrics').textContent !== ${JSON.stringify(before)}`);
  }
  const preset = await ev('JSON.parse(localStorage.getItem("piclite.desktop.clop-settings.v1")).preset');
  for (const [width, height] of [[392,330], [556,436], [280,220], [246,188], [680,480]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    for (const style of ['immersive','classic']) for (const theme of ['light','dark']) {
      await ev(`localStorage.setItem('piclite.desktopPreferences.v1',JSON.stringify({theme:'${theme}',language:'en',floatingStyle:'${style}',interfaceFontScale:150}));dispatchEvent(new StorageEvent('storage',{key:'piclite.desktopPreferences.v1'}))`);
      await wait(`document.querySelector('main')?.dataset.floatingStyle==='${style}' && document.documentElement.dataset.theme==='${theme}'`);
      console.log('CHECK',width,height,style,theme);
      await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:width-20,y:height*.4});
      await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:width+10,y:height+10});
      await ev('document.activeElement?.blur()');await new Promise(r=>setTimeout(r,250));
      await wait(`getComputedStyle(document.querySelector('.result-hover-actions')).opacity==='0'`);
      assert.equal(await ev('document.querySelectorAll(".result-name,.floating-filename-badge").length'),0);
      assert.equal(await ev('getComputedStyle(document.querySelector(".result-metrics")).visibility'),'visible');
      await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:width-20,y:height*.4});
      await wait(`getComputedStyle(document.querySelector('.result-hover-actions')).opacity==='1'`);
      const layout = await ev(`(() => {
        const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}};
        const actions=[...document.querySelectorAll('.result-actions button')].map(b=>({...rect(b),icon:rect(b.querySelector('svg')),disabled:b.disabled,hit:document.elementFromPoint(b.getBoundingClientRect().x+b.offsetWidth/2,b.getBoundingClientRect().y+b.offsetHeight/2)?.closest('button')===b}));
        return {actions,footer:[...document.querySelectorAll('.floating-footer button')].map(b=>({...rect(b),label:b.title,hit:document.elementFromPoint(b.getBoundingClientRect().x+b.offsetWidth/2,b.getBoundingClientRect().y+b.offsetHeight/2)?.closest('button')===b})),close:rect(document.querySelector('.floating-card-icon,.result-close')),metricVisibility:getComputedStyle(document.querySelector('.result-metrics')).visibility,footerHeight:document.querySelector('.floating-footer').getBoundingClientRect().height};
      })()`);
      assert.equal(layout.actions.length,6);
      assert.equal(new Set(layout.actions.map(b=>Math.round(b.y))).size,2);
      assert.equal(new Set(layout.actions.map(b=>Math.round(b.x))).size,3);
      for (const b of layout.actions) {
        assert.ok(b.x>=0&&b.y>=0&&b.right<=width&&b.bottom<=height,JSON.stringify({width,height,style,b}));
        if (!b.disabled) assert.ok(b.hit,JSON.stringify({width,height,style,b}));
        assert.ok(Math.abs(b.x+b.w/2-b.icon.x-b.icon.w/2)<1);
        assert.ok(Math.abs(b.y+b.h/2-b.icon.y-b.icon.h/2)<1);
      }
      assert.ok(layout.footer.every(b=>b.w>0&&b.h>0&&b.x>=0&&b.right<=width&&b.hit),JSON.stringify({width,height,style,footer:layout.footer}));
      if (style==='immersive') {
        assert.equal(layout.metricVisibility,'hidden');
        if (width===392) assert.ok(layout.actions.every(b=>b.w>=67&&b.w<=69));
        if (width===556) assert.ok(layout.actions.every(b=>b.w>=80&&b.w<=85));
        assert.ok(layout.close.w<=48);
        assert.equal(layout.footer.length,8,'mode, page, click-through, collapse, workbench, list, clear, close');
        assert.equal(await ev('getComputedStyle(document.querySelector(".floating-window-image"),"::after").backdropFilter'),'blur(18px)');
      } else {
        assert.ok(layout.actions.every(b=>b.w===(width<=340?38:42)));
        assert.equal(layout.footerHeight,40);
        assert.equal(layout.metricVisibility,'visible','2.0.2 readouts remain visible under hover');
        assert.equal(layout.footer.length,6,'original mode and five window commands');
      }
      const selected = await ev('document.querySelector(".result-metrics").textContent');
      await click('.floating-collapse-button');
      await wait('!!document.querySelector(".is-collapsed")');
      await click('.floating-collapsed-logo');
      await wait('!!document.querySelector(".result-card")');
      assert.equal(await ev('document.querySelector(".result-metrics").textContent'),selected);
      await click('.floating-footer button[title="Open full workbench"]');
      assert.ok(await ev('calls.some(c=>c[0]==="workbench")'));
      if (width===392 || width===556) {
        await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:width-20,y:height*.4});
        await wait(`getComputedStyle(document.querySelector('.result-hover-actions')).opacity==='1'`);
        const shot=await send('Page.captureScreenshot',{format:'png'});
        writeFileSync(`${artifacts}/${style}-${theme}-${width}.png`,Buffer.from(shot.data,'base64'));
      }
      report.push({width,height,style,theme,button:layout.actions[0].w,footer:layout.footer.length});
    }
  }
  await ev(`localStorage.setItem('piclite.desktopPreferences.v1',JSON.stringify({theme:'dark',language:'en',floatingStyle:'immersive'}));dispatchEvent(new StorageEvent('storage',{key:'piclite.desktopPreferences.v1'}))`);
  await wait('!!document.querySelector(".floating-result-next")');
  const pages=[];
  for (let n=0;n<4;n++) {
    pages.push(await ev('document.querySelector(".floating-result-next").textContent'));
    await click('.floating-result-next');
  }
  assert.deepEqual(pages,['1/3','2/3','3/3','1/3']);
  const listOrder=async()=>{
    await click('.floating-footer button[title="Expand results"]');
    await wait('!!document.querySelector(".floating-list.list")');
    const metrics=await ev('[...document.querySelectorAll(".result-metrics")].map(e=>e.textContent)');
    await click('.floating-footer button[title="Stack results"]');
    await wait('!!document.querySelector(".floating-list.stack")');
    return metrics;
  };
  const before=await listOrder();
  await click('.floating-result-next');
  assert.deepEqual(await listOrder(),before);
  assert.deepEqual(await ev('JSON.parse(localStorage.getItem("piclite.desktop.clop-settings.v1")).preset'),preset);
  writeFileSync(`${artifacts}/report.json`,JSON.stringify({status:'passed',cases:report,pages},null,2));
  console.log(`PASS ${report.length} production layouts, Clop proportions, classic 2.0.2 toolbar, no filenames, pointer hits, collapse/restore, paging, stable history and unchanged preset`);
});
