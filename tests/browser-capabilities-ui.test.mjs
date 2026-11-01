// Mount the real shared app without native IPC; verify user-visible browser capabilities.
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
const root=decodeURIComponent(new URL('../',import.meta.url).pathname);
const port=process.env.PICLITE_CDP_PORT||9443;
const production=process.env.PICLITE_TEST_PRODUCTION==='1';
const seed=`localStorage.removeItem('piclite.compressionSettings.v2');localStorage.setItem('piclite.interfaceStyle.v1','classic');localStorage.setItem('piclite.desktop.clop-settings.v1',JSON.stringify({interfaceFontScale:100}));localStorage.setItem('piclite.desktopPreferences.v1',JSON.stringify({language:'en',theme:'light',interfaceFontScale:100}));localStorage.setItem('piclite.workspacePlugins.v2',JSON.stringify(['rename','watcher','convert','resize','gallery'].map(id=>({id,kind:'builtin',enabled:true}))));`;
const target=await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'}).then(r=>r.json());
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
let sequence=0;const pending=new Map();
ws.addEventListener('message',({data})=>{const m=JSON.parse(data),p=pending.get(m.id);if(p){pending.delete(m.id);if(m.error)p.reject(Error(m.error.message));else p.resolve(m.result);}});
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
const wait=async expression=>{for(let i=0;i<150;i++){try{if(await evaluate(expression))return;}catch{/* The document can navigate while waiting. */}await new Promise(r=>setTimeout(r,25));}throw Error(`Timed out: ${expression}`);};
const bundle=await build({stdin:{contents:"import React from 'react';import{createRoot}from'react-dom/client';import{PicLiteApp}from'./app/piclite-app';createRoot(document.getElementById('root')).render(<PicLiteApp/>);",resolveDir:root,loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'empty','.html':'text'},define:{'process.env.NODE_ENV':'"test"','import.meta.env.BASE_URL':'"/"'}});
const click=async text=>{await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(el=>el.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Missing button: '+${JSON.stringify(text)});b.click()})()`);};
try{
 await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});
 if(production)await send('Page.addScriptToEvaluateOnNewDocument',{source:seed});
 await send('Page.navigate',{url:process.env.PICLITE_TEST_ORIGIN||'http://127.0.0.1:1537'});
 await wait('!!document.querySelector(".settings-entry-button")');
 if(!production){
 const fixtureUrl=await evaluate("URL.createObjectURL(new Blob(['<!doctype html><html><body><div id=\"root\"></div></body></html>'],{type:'text/html'}))");
 await send('Page.navigate',{url:fixtureUrl});await wait('!!document.getElementById("root")');
 await evaluate(`window.picLite=undefined;${seed}${bundle.outputFiles[0].text}`);
 await wait('!!document.querySelector(".settings-entry-button")');
 }
 assert.equal(await evaluate('!!window.picLite'),false,'test the real browser capability boundary');
 if(production){await evaluate(`${seed}location.reload()`);await wait(`!!document.querySelector('[data-tool-id=convert]')`);}
 if(production)await test('production browser toolbar geometry uses the shared one-row rail',async()=>{
  for(const layout of ['classic','studio'])for(const scale of [100,150])for(const width of [820,1120,1440]){
   await evaluate(`localStorage.setItem('piclite.interfaceStyle.v1',${JSON.stringify(layout)});for(const key of ['piclite.desktopPreferences.v1','piclite.desktop.clop-settings.v1'])localStorage.setItem(key,JSON.stringify({...JSON.parse(localStorage.getItem(key)||'{}'),interfaceFontScale:${scale}}));window.dispatchEvent(new Event('piclite:interface-style'));window.dispatchEvent(new Event('piclite:interface-typography'));`);
   await send('Emulation.setDeviceMetricsOverride',{width,height:700,deviceScaleFactor:1,mobile:false});await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
   const geometry=await evaluate(`(()=>{const r=el=>{const b=el.getBoundingClientRect();return{x:b.x,right:b.right,cy:b.y+b.height/2}};const nav=document.querySelector('.tool-tabs');return{width:innerWidth,nav:r(nav),arrows:[...document.querySelectorAll('.nav-scroll')].filter(el=>!el.hidden&&getComputedStyle(el).display!=='none').map(r),tabs:[...nav.children].map(r),overflow:nav.scrollWidth>nav.clientWidth+1,actions:r(document.querySelector('.topbar-actions'))}})()`);
   assert.equal(geometry.width,width);assert.equal(geometry.arrows.length,geometry.overflow?2:0);
   for(const arrow of geometry.arrows)assert.ok(Math.abs(arrow.cy-geometry.tabs[0].cy)<=1,`${layout}/${scale}/${width}: arrow alignment`);
   assert.ok(geometry.nav.right<=geometry.actions.x+1,'tools do not overlap settings');
   console.log(`PASS web toolbar ${layout} ${scale}% ${width}: overflow=${geometry.overflow}`);
  }
 });
 await test('browser omits unavailable folder monitoring but keeps working tools',async()=>{
  const tools=await evaluate("[...document.querySelectorAll('[data-tool-id]')].map(el=>el.dataset.toolId)");
  assert.equal(tools.includes('watcher'),false,'folder monitoring needs native IPC');
  assert.equal(tools.includes('rename'),false,'filesystem batch rename needs native IPC');
  for(const id of ['workspace','banner','convert','resize','gallery'])assert.ok(tools.includes(id),`${id} remains available in the browser`);
 });
 await evaluate("document.querySelector('.settings-entry-button').click()");await wait('!!document.querySelector(".preferences-sidebar")');
 await test('browser settings hide native integrations and preserve typography',async()=>{
  const categories=await evaluate("document.querySelector('.preferences-sidebar nav').textContent");
  for(const name of ['Clipboard','File handling','Drop Zone','Image Hosting','Keyboard Shortcuts'])assert.equal(categories.includes(name),false,`${name} is not a browser capability`);
  const general=await evaluate("document.querySelector('.preferences-content').textContent");
  for(const name of ['Show in taskbar / Dock','Automatic update checks','Launch at login','System tray','Global drop zone'])assert.equal(general.includes(name),false,`${name} is native-only`);
  assert.ok(await evaluate("!!document.querySelector('.interface-typography-controls')"),'web font import and scale remain accessible');
 });
 await test('browser image preferences omit background clipboard watching',async()=>{
  await click('▧Images');
  const text=await evaluate("document.querySelector('.preferences-content').textContent");
  assert.equal(text.includes('Enable clipboard optimiser'),false);
  assert.ok(text.includes('Avoid unnecessary size increases'));
 });
 await test('browser image safeguard settings update the working compression control',async()=>{
  const previous=await evaluate("document.querySelector('.preferences-content [role=switch]').getAttribute('aria-checked')");
  await evaluate("document.querySelector('.preferences-content [role=switch]').click()");
  await evaluate("document.querySelector('[data-tool-id=workspace]').click()");await wait('!!document.querySelector(".secondary-check input")');
  assert.equal(await evaluate("document.querySelector('.secondary-check input').checked"),previous!=='true');
  await evaluate("document.querySelector('.secondary-check input').click()");
  await evaluate("document.querySelector('.settings-entry-button').click()");
  await click('▧Images');
  assert.equal(await evaluate("document.querySelector('.preferences-content [role=switch]').getAttribute('aria-checked')"),previous);
 });
 await test('browser floating settings omit ignored native-only appearance options',async()=>{
  await click('▤Floating Results');
  const text=await evaluate("document.querySelector('.preferences-content').textContent");
  for(const native of ['Allow screenshot / recording capture','Floating result layout','Floating result appearance'])assert.equal(text.includes(native),false,`${native} is ignored by the browser result panel`);
  assert.ok(text.includes('New floating window'));assert.ok(text.includes('Dismiss result after'));
 });
 await test('browser plugin settings do not advertise filesystem-only tools',async()=>{
  await click('◇Plugins');
  const text=await evaluate("document.querySelector('.plugin-preference-card').textContent");
  assert.equal(text.includes('Folder watch'),false);assert.equal(text.includes('Batch rename'),false);
  assert.ok(text.includes('Format converter'));assert.ok(text.includes('Resize images'));assert.ok(text.includes('Library'));
  assert.equal(text.includes('Resize & enlarge'),false,'the browser workbench supports shrinking, so do not promise native enlargement');
 });
 await test('browser tools open dedicated converter, resize and gallery pages',async()=>{
  for(const id of ['convert','resize','gallery']){
   await evaluate(`document.querySelector('[data-tool-id=${id}]').click()`);
   await wait(id==='gallery'?`!!document.querySelector('.gallery-page')`:`document.querySelector('.browser-image-tool')?.dataset.tool==='${id}'`);
   assert.equal(await evaluate("!!document.querySelector('section.workspace')"),false,'tool tab must not render the workspace');
   assert.equal(await evaluate(`document.querySelector('[data-tool-id=${id}]').getAttribute('aria-current')`),'page');
  }
 });
 await test('independent browser conversion and resize produce real image output',async()=>{
  await evaluate(`document.querySelector('[data-tool-id=convert]').click()`);
  await evaluate(`(async()=>{const c=document.createElement('canvas');c.width=160;c.height=100;const ctx=c.getContext('2d');ctx.fillStyle='#3785ba';ctx.fillRect(0,0,160,100);const blob=await new Promise(r=>c.toBlob(r,'image/png'));const dt=new DataTransfer();dt.items.add(new File([blob],'capability-source.png',{type:'image/png'}));const input=document.querySelector('.browser-image-tool input[type=file]');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await wait(`document.querySelectorAll('.web-tool-item').length===1`);
  await evaluate(`const select=document.getElementById('web-tool-format');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'image/jpeg');select.dispatchEvent(new Event('change',{bubbles:true}));`);
  await evaluate(`document.querySelector('.web-tool-run').click()`);await wait(`!!document.querySelector('.web-tool-item.done')`);
  const converted=await evaluate(`(async()=>{const blob=await fetch(document.querySelector('.web-tool-result img').src).then(r=>r.blob());const bitmap=await createImageBitmap(blob);return{type:blob.type,width:bitmap.width,height:bitmap.height,bytes:blob.size}})()`);
  assert.equal(converted.type,'image/jpeg');assert.deepEqual([converted.width,converted.height],[160,100]);assert.ok(converted.bytes>0);
  await evaluate(`document.querySelector('[data-tool-id=resize]').click()`);
  await evaluate(`const input=document.getElementById('web-resize-scale');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'50');input.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('.web-tool-run').click()`);
  await wait(`document.querySelector('.web-tool-result img')?.naturalWidth===80`);
  const resized=await evaluate(`(async()=>{const blob=await fetch(document.querySelector('.web-tool-result img').src).then(r=>r.blob());const bitmap=await createImageBitmap(blob);return{type:blob.type,width:bitmap.width,height:bitmap.height,bytes:blob.size}})()`);
  assert.deepEqual([resized.width,resized.height],[80,50]);assert.ok(resized.bytes>0);
  await evaluate(`document.querySelector('[data-tool-id=gallery]').click()`);await wait(`document.querySelectorAll('.gallery-card').length>0`);
  console.log('Real independent tool outputs:',JSON.stringify({converted,resized}));
 });
 await test('browser hides unsupported native update actions in About',async()=>{
  await evaluate("document.querySelector('.settings-entry-button').click()");await click('ⓘAbout');
  const labels=await evaluate("[...document.querySelectorAll('.about-links button')].map(b=>b.textContent)");
  assert.equal(labels.some(label=>label.includes('Check for updates')),false,'native update IPC is unavailable');
 });
}finally{ws.close();await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`);}
