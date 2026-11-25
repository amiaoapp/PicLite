import assert from 'node:assert/strict';
import { floatingBrowser } from './helpers/floating-test-browser.mjs';

await floatingBrowser(async ({ send, evaluate, wait, click }) => {
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    if (window === top) {
    localStorage.clear();
    localStorage.setItem('piclite.desktop.clop-settings.v1', JSON.stringify({
      language:'en',autoHideResults:false,updateCheckFrequency:'never',
      floatingDisplayMode:'stack',pauseAutomaticOptimisations:true,clipboardOptimiser:true,
      floatingActions:['clipboard-monitor','copy','save','undo','quality','cover']
    }));
    let api; window.drags=0;
    Object.defineProperty(window,'picLite',{configurable:true,get(){return api},set(value){
      api={...value,windowLabel:'dropzone',
        onFileDrop:callback=>{window.dropImages=callback;return()=>{}},
        startDragging:async()=>{drags++},
        quickCompressPaths:async(paths)=>paths.map(source=>({source,output:source+'.webp',originalBytes:1000000,outputBytes:200000,width:1000,height:800,keptOriginal:false})),
        readImagesFromPaths:async()=>[],
      };
    }});
    }
  ` });
  await send('Emulation.setDeviceMetricsOverride', { width: 460, height: 360, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: (process.env.ORIGIN || 'http://127.0.0.1:1551') + '/?window=dropzone' });
  await wait('typeof dropImages === "function"');
  await evaluate(`dropImages({type:'drop',paths:['/test/a.png','/test/b.png','/test/c.png']})`);
  await wait('document.querySelectorAll(".result-card.done").length===3');
  assert.equal(await evaluate('document.querySelectorAll(".floating-list.list .result-card").length'), 3);
  assert.equal(await evaluate('document.querySelectorAll(".floating-list.stack,.floating-window-image").length'), 0);
  assert.equal(await evaluate(`!!document.querySelector('[title="Stack results"],[title="Expand results"]')`), false);
  assert.equal(await evaluate('JSON.parse(localStorage.getItem("piclite.desktop.clop-settings.v1")).floatingDisplayMode'), 'list');
  const order = await evaluate('[...document.querySelectorAll(".floating-result-slot")].map(e=>e.dataset.resultId)');
  const layout = await evaluate(`[...document.querySelectorAll('.result-card')].map(e=>{const r=e.getBoundingClientRect();return {w:r.width,h:r.height}})`);
  assert.ok(layout.every(r=>Math.abs(r.w/r.h-460/360)<.01),JSON.stringify(layout));
  for (let index=0;index<3;index++) {
    await evaluate(`document.querySelectorAll('.floating-result-next')[${index}].click()`);
    await wait(`(()=>{const list=document.querySelector('.floating-list');const slot=list.children[${(index+1)%3}];return Math.abs(slot.getBoundingClientRect().top-list.getBoundingClientRect().top)<2})()`);
  }
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".floating-result-slot")].map(e=>e.dataset.resultId)'), order);
  await send('Input.dispatchMouseEvent', {type:'mouseMoved',x:220,y:100});
  await click('.result-actions [data-action="clipboard-monitor"]');
  await wait(`document.querySelector('[data-action="clipboard-monitor"]').getAttribute('aria-pressed')==='true'`);
  assert.equal(await evaluate('picLite.getClipboardMonitorPaused()'),true);
  assert.equal(await evaluate(`document.querySelectorAll('.result-actions [data-clipboard-paused-icon]').length`),3);
  const saved = await evaluate('JSON.parse(localStorage.getItem("piclite.desktop.clop-settings.v1"))');
  assert.equal(saved.clipboardOptimiser,true,'session pause must not disable the persisted preference');
  assert.equal(saved.pauseAutomaticOptimisations,false,'legacy global pause cannot strand folder watchers');
  await evaluate('picLite.setClipboardMonitorPaused(false)');
  await wait(`document.querySelector('[data-action="clipboard-monitor"]').getAttribute('aria-pressed')==='false'`);
  assert.equal(await evaluate(`document.querySelectorAll('.result-actions [data-clipboard-paused-icon]').length`),0);
  assert.equal(await evaluate(`document.querySelector('[data-action="clipboard-monitor"]').title`),'Temporarily disable clipboard monitoring');
  await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:15,y:25});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:15,y:25});
  assert.ok(await evaluate('drags>0'),'expanded results must remain draggable');
  console.log('PASS legacy stack migrates to list; full-window cards scroll in stable order; pause state synchronizes without altering settings; dragging works');
});
