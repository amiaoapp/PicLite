// The OS cursor and WebView :hover deliberately disagree here, as they do when
// an inactive native WebView misses mouse events after Cmd+Tab / Alt+Tab.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { floatingBrowser } from './helpers/floating-test-browser.mjs';

const origin = process.env.ORIGIN || 'http://127.0.0.1:1551';
const artifacts = process.env.ARTIFACTS || '/tmp/piclite-pointer-recovery';
mkdirSync(artifacts, { recursive: true });
await floatingBrowser(async ({ send, evaluate: ev, wait, click }) => {
  await send('Emulation.setDeviceMetricsOverride', { width: 392, height: 330, deviceScaleFactor: 2, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    localStorage.clear();
    localStorage.setItem('piclite.desktopPreferences.v1', JSON.stringify({language:'en',theme:'dark'}));
    localStorage.setItem('piclite.desktop.clop-settings.v1', JSON.stringify({autoHideResults:false,updateCheckFrequency:'never',floatingDisplayMode:'stack'}));
    window.nativePointer={x:-50,y:-50,focused:true};
    let api;Object.defineProperty(window,'picLite',{configurable:true,get(){return api},set(value){api={...value,
      windowLabel:'dropzone',getFloatingCollapsed:async()=>false,
      getFloatingPointerPosition:async()=>window.nativePointer,
      takePendingClipboard:async()=>null,onWatcherEvent:cb=>{window.publishResult=cb;return()=>{}},
      onTrayAction:()=>()=>{},loadImportedFonts:async()=>[],configureFloatingBehavior:async()=>{},
      configureDropzoneWindow:async()=>{},setFloatingToggleRegion:async()=>{},
      readImagesFromPaths:async paths=>paths.map(path=>{const c=document.createElement('canvas');c.width=600;c.height=400;
        const x=c.getContext('2d');x.fillStyle='#237fa0';x.fillRect(0,0,600,400);x.fillStyle='#f4ce63';x.fillRect(100,100,400,200);
        return{path,type:'image/png',data:Uint8Array.from(atob(c.toDataURL().split(',')[1]),s=>s.charCodeAt(0))}})
    }}});
  ` });
  await send('Page.navigate', { url: origin + '/?window=dropzone' });
  await wait('typeof publishResult === "function"');
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 450, y: 400 });
  for (let n = 1; n <= 3; n++) {
    await ev(`publishResult({type:'success',file:'/source-${n}.png',output:'/source-${n}.png',time:${n},originalBytes:10000,outputBytes:2000})`);
    await wait(`document.querySelector('.floating-result-next')?.textContent === '1/${n}'`);
  }
  await wait('document.querySelector(".result-card")?.dataset.pointerTracked === "true"');
  await send('DOM.enable');
  await send('CSS.enable');
  async function forceHover(selectors, enabled) {
    const { root } = await send('DOM.getDocument');
    for (const selector of selectors) {
      const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
      await send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: enabled ? ['hover'] : [] });
    }
  }
  const hidden = `getComputedStyle(document.querySelector('.result-hover-actions')).opacity === '0' && getComputedStyle(document.querySelector('.result-metrics')).visibility === 'visible'`;
  const shown = `getComputedStyle(document.querySelector('.result-hover-actions')).opacity === '1' && getComputedStyle(document.querySelector('.result-metrics')).visibility === 'hidden'`;
  const cases = [];

  // Enter -> switch away with the pointer still inside. Hover stays usable in
  // an inactive window, and a later exit must work without any DOM mouse event.
  await forceHover(['main', '.result-card'], true);
  await ev('nativePointer={x:196,y:110,focused:true}');
  await wait(shown);
  await ev('nativePointer.focused=false;dispatchEvent(new Event("blur"))');
  await wait(shown);
  await ev('nativePointer={x:-50,y:-50,focused:false}');
  await wait(hidden);
  assert.equal(await ev(`document.querySelector('.result-card').matches(':hover')`), true, 'stale WebView hover is still forced');
  assert.equal(await ev(`getComputedStyle(document.querySelector('.result-actions button')).pointerEvents`), 'none');
  assert.equal(await ev(`getComputedStyle(document.querySelector('.floating-window-image'),'::after').backdropFilter`), 'blur(14px)');
  cases.push('stale hover clears after keyboard switching and moving out without a click');

  // Leave -> switch away -> enter, while the WebView never learns about entry.
  await forceHover(['main', '.result-card'], false);
  assert.equal(await ev(`document.querySelector('.result-card').matches(':hover')`), false);
  await ev('nativePointer={x:196,y:110,focused:false}');
  await wait(shown);
  assert.equal(await ev(`document.querySelector('.result-card').matches(':hover')`), false, 'no DOM hover or click was required');
  assert.equal(await ev(`getComputedStyle(document.querySelector('.result-actions button')).pointerEvents`), 'auto');
  assert.equal(await ev(`getComputedStyle(document.querySelector('.floating-window-image'),'::after').backdropFilter`), 'blur(18px)');
  cases.push('native entry reveals controls while the WebView is inactive and unhovered');

  // Keyboard focus must remain useful in the active window, but an element
  // retaining :focus-visible in an inactive WebView must not pin the overlay.
  await ev(`nativePointer={x:-50,y:-50,focused:true};document.querySelector('.floating-result-next').focus()`);
  await wait(shown);
  await ev('nativePointer.focused=false;dispatchEvent(new Event("blur"))');
  await wait(hidden);
  await ev(`document.activeElement.blur();nativePointer={x:196,y:110,focused:true}`);
  await wait(shown);
  cases.push('keyboard focus survives switching without pinning an inactive overlay');

  await click('.floating-footer button[title="Expand results"]');
  await wait('document.querySelectorAll(".floating-list.list .result-card").length === 3');
  await ev('document.activeElement?.blur();nativePointer={x:196,y:110,focused:false}');
  await wait(shown);
  const expanded = await ev(`[...document.querySelectorAll('.result-card')].map(c=>getComputedStyle(c.querySelector('.result-hover-actions')).opacity)`);
  assert.deepEqual(expanded, ['1', '0', '0']);
  await ev('document.querySelector(".floating-list.list").scrollTop=100000');
  await wait(`getComputedStyle(document.querySelectorAll('.result-card')[2].querySelector('.result-hover-actions')).opacity === '1'`);
  assert.equal(await ev(`getComputedStyle(document.querySelectorAll('.result-card')[0].querySelector('.result-hover-actions')).opacity`), '0');
  cases.push('expanded cards track the current image while scrolling with no mouse events');
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(artifacts + '/expanded-inactive-hover.png', Buffer.from(screenshot.data, 'base64'));

  // Hidden windows report no pointer; stale CSS hover must stay overridden.
  await forceHover(['main', '.result-card:last-child'], true);
  await ev('nativePointer=null');
  await wait(`[...document.querySelectorAll('.result-hover-actions')].every(e=>getComputedStyle(e).opacity === '0')`);
  cases.push('hidden window clears pointer and focus state');
  writeFileSync(artifacts + '/report.json', JSON.stringify({ status: 'passed', cases }, null, 2));
  console.log('PASS ' + cases.join('; '));
});
