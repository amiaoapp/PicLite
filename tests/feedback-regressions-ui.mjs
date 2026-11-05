import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { floatingBrowser } from './helpers/floating-test-browser.mjs';

const origin = process.env.ORIGIN || 'http://127.0.0.1:1551';
const artifacts = process.env.ARTIFACTS || '/tmp/piclite-feedback-regressions';
mkdirSync(artifacts, { recursive: true });
const init = (label, platform = 'darwin', section = 'floating') => `
  localStorage.clear();
  localStorage.setItem('piclite.interfaceStyle.v1','studio');
  localStorage.setItem('piclite.desktopPreferences.v1',JSON.stringify({language:'en',theme:'light',updateCheckFrequency:'never'}));
  localStorage.setItem('piclite.desktop.clop-settings.v1',JSON.stringify({language:'en',autoHideResults:false,updateCheckFrequency:'never'}));
  localStorage.setItem('piclite.preferences.requested-section','${section}');
  window.calls=[];window.regions={};
  let api;Object.defineProperty(window,'picLite',{configurable:true,get(){return api},set(value){
    api={...value,windowLabel:'${label}',platform:'${platform}',getFloatingCollapsed:async()=>false,
      takePendingClipboard:async()=>null,onWatcherEvent:cb=>{window.publishResult=cb;return()=>{}},onTrayAction:()=>()=>{},
      configureFloatingBehavior:async()=>{},configureDropzoneWindow:async()=>{},
      configureGlobalShortcuts:async config=>calls.push(['shortcuts',config]),
      setFloatingToggleRegion:async(region,control)=>{regions[control]=region},
      loadImportedFonts:async()=>[],
      readImagesFromPaths:async paths=>{const c=document.createElement('canvas');c.width=600;c.height=400;c.getContext('2d').fillRect(0,0,600,400);
        return paths.map(path=>({path,type:'image/png',width:600,height:400,data:Uint8Array.from(atob(c.toDataURL().split(',')[1]),s=>s.charCodeAt(0))}))}
    };
  }});
`;

await floatingBrowser(async ({ send, evaluate: ev, wait }) => {
  await send('Page.addScriptToEvaluateOnNewDocument', { source: init('main') });
  await send('Page.navigate', { url: origin });
  await wait('!!document.querySelector(".studio-status")');
  for (const [width, height] of [[1440,900],[1130,700],[900,650]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false });
    await ev('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const geometry = await ev(`(()=>{const r=document.querySelector('.studio-status').getBoundingClientRect();return{bottom:r.bottom,scroll:document.documentElement.scrollHeight,icons:[...document.querySelectorAll('.quick-mode-icon svg')].map(e=>({w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height}))}})()`);
    assert.equal(geometry.bottom, height, JSON.stringify(geometry));
    assert.equal(geometry.scroll, height, JSON.stringify(geometry));
    assert.equal(geometry.icons.length,3);
    assert.ok(geometry.icons.every(icon=>Math.abs(icon.w-18)<.01&&Math.abs(icon.h-18)<.01));
  }
  writeFileSync(artifacts+'/workbench.png', Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  console.log('PASS Studio footer fills viewport and three preset SVGs have equal dimensions');
});

for (const platform of ['darwin','win32']) await floatingBrowser(async ({send,evaluate:ev,wait,click}) => {
  await send('Emulation.setDeviceMetricsOverride',{width:1100,height:800,deviceScaleFactor:2,mobile:false});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:init('preferences',platform)});
  await send('Page.navigate',{url:origin+'/?window=preferences'});
  await wait('document.querySelector(".floating-preview img")?.naturalWidth > 0');
  const preview = await ev(`(()=>{const box=document.querySelector('.floating-preview').getBoundingClientRect(),card=document.querySelector('.floating-preview .result-card').getBoundingClientRect();return {w:box.width,h:box.height,cardHeight:card.height,inert:document.querySelector('.floating-preview').inert}})()`);
  assert.ok(preview.w>=300&&preview.h>=230&&Math.abs(preview.cardHeight-preview.h)<3,JSON.stringify(preview));
  assert.ok(preview.inert,'sample cannot execute real file actions');
  await ev(`document.querySelector('.floating-preview').scrollIntoView({block:'center'})`);
  if(platform==='darwin') writeFileSync(artifacts+'/settings-preview.png',Buffer.from((await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
  // Select the real shortcut preferences page, then record browser key events.
  await ev(`[...document.querySelectorAll('.settings-sidebar button')].find(b=>b.textContent.includes('Keyboard Shortcuts')).click()`);
  await wait('!!document.querySelector(".shortcut-recorder")');
  for (const [modifier, expected] of [['ctrlKey','Control+Alt+C'],['metaKey','Super+Alt+C']]) {
    await click('.shortcut-recorder');
    await ev(`dispatchEvent(new KeyboardEvent('keydown',{key:'c',code:'KeyC',${modifier}:true,altKey:true,bubbles:true,cancelable:true}))`);
    await wait(`JSON.parse(localStorage.getItem('piclite.desktop.clop-settings.v1')).shortcutToggleDropzone==='${expected}'`);
    assert.ok(await ev(`calls.some(([name,c])=>name==='shortcuts'&&c.toggleDropzone==='${expected}')`));
    const label=await ev(`document.querySelector('.shortcut-recorder').textContent`);
    assert.ok(label.includes(modifier==='ctrlKey'?(platform==='darwin'?'⌃':'Ctrl'):(platform==='darwin'?'⌘':'Win')),label);
  }
  console.log('PASS full-size settings preview and distinct recorded/registerable modifiers: '+platform);
});

await floatingBrowser(async ({send,evaluate:ev,wait,click}) => {
  await send('Emulation.setDeviceMetricsOverride',{width:392,height:330,deviceScaleFactor:2,mobile:false});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:init('dropzone')});
  await send('Page.navigate',{url:origin+'/?window=dropzone'});
  await wait('typeof publishResult === "function"');
  for(const populated of [false,true]) {
    if(populated){await ev(`publishResult({type:'success',file:'/test.png',output:'/test.webp',time:1,originalBytes:10000,outputBytes:2000})`);await wait('!!document.querySelector(".result-card")');}
    await click('.click-through-toggle');
    await wait('!!document.querySelector(".is-click-through")');
    const hits=await ev(`[...document.querySelectorAll('main button')].map(b=>{const r=b.getBoundingClientRect();return {toggle:b.classList.contains('click-through-toggle'),hit:r.width>0&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===b}})`);
    assert.equal(hits.filter(b=>b.hit).length,1,JSON.stringify(hits));
    assert.ok(hits.find(b=>b.hit).toggle);
    await click('.click-through-toggle');
    await wait('!document.querySelector(".is-click-through")');
  }
  console.log('PASS empty/populated click-through exposes only its own toggle');
});
