import assert from 'node:assert/strict';
import { floatingBrowser } from './helpers/floating-test-browser.mjs';
await floatingBrowser(async ({send,evaluate,wait,click}) => {
  await send('Emulation.setDeviceMetricsOverride',{width:1050,height:760,deviceScaleFactor:1,mobile:false});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`
    if(window===top){localStorage.clear();localStorage.setItem('piclite.desktop.clop-settings.v1',JSON.stringify({language:'en',updateCheckFrequency:'never'}));
      localStorage.setItem('piclite.preferences.requested-section','clipboard');
      let api;window.nativePreferences=[];
      Object.defineProperty(window,'picLite',{configurable:true,get(){return api},set(value){api={...value,windowLabel:'preferences',updateDesktopPreferences:async prefs=>nativePreferences.push(prefs)}}});
    }
  `});
  await send('Page.navigate',{url:(process.env.ORIGIN||'http://127.0.0.1:1551')+'/?window=preferences'});
  await wait('!!document.querySelector(".settings-sidebar")');
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Clipboard')?.click()`);
  await wait('!!document.querySelector(".clipboard-source-controls")');
  assert.equal(await evaluate('document.querySelector(".clipboard-source-controls [role=switch]").getAttribute("aria-checked")'),'true');
  // Fill the controlled input using the same native setter as a real edit.
  const enter = async name => {
    await evaluate(`(()=>{const input=document.querySelector('.clipboard-source-add input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(name)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await click('.clipboard-source-add > button');
  };
  await enter('com.example.editor');
  await wait('nativePreferences.at(-1)?.clipboardExcludedApps.includes("com.example.editor")');
  assert.deepEqual(await evaluate('JSON.parse(localStorage.getItem("piclite.desktopPreferences.v1")).clipboardExcludedApps'),['com.example.editor']);
  await enter('COM.EXAMPLE.EDITOR');
  assert.equal(await evaluate('document.querySelectorAll(".clipboard-source-apps li").length'),1,'duplicates should not be added');
  await click('.clipboard-source-controls [role=switch]');
  await wait('nativePreferences.at(-1)?.clipboardExcludeOffice===false');
  await click('.clipboard-source-apps li button');
  await wait('nativePreferences.at(-1)?.clipboardExcludedApps.length===0');
  console.log('PASS Office switch defaults on; custom app add/remove/dedup and native settings synchronization');
});
