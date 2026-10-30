// Exercise actual Vite desktop renderer through Chrome CDP.
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
const port=process.env.PICLITE_CDP_PORT||9442;
const origin=process.env.PICLITE_TEST_ORIGIN||'http://127.0.0.1:1432';
const pages=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());
const ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener('open',r,{once:true}));
let seq=0;const pending=new Map();
ws.addEventListener('message',({data})=>{const m=JSON.parse(data);if(pending.has(m.id)){const {resolve,reject}=pending.get(m.id);pending.delete(m.id);m.error?reject(m.error):resolve(m.result);}});
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async expression=>{for(let i=0;i<80;i++){try{if(await evaluate(expression))return;}catch{}await pause(100);}throw Error('UI did not become ready: '+expression);};
const scratch='/Users/amiao/.hermes/cache/scratch';mkdirSync(`${scratch}/piclite-ui-v2`,{recursive:true});
try{
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`if(location.origin===${JSON.stringify(origin)}){
 if(!sessionStorage.getItem('ui-seeded')){localStorage.setItem('piclite.workspacePlugins.v2',JSON.stringify(['watcher','gallery','rename','convert','resize'].map(id=>({id,kind:'builtin',enabled:true}))));localStorage.setItem('piclite.interfaceStyle.v1','classic');localStorage.setItem('piclite.interfaceMaterial.v1',JSON.stringify({material:'glass',transparency:'system'}));localStorage.removeItem('piclite.toolOrder.v1');sessionStorage.setItem('ui-seeded','1');}}
`});
 await send('Emulation.setDeviceMetricsOverride',{width:1120,height:700,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:origin});await wait('!!document.querySelector(".topbar")');
 await evaluate(`localStorage.setItem('piclite.workspacePlugins.v2',JSON.stringify(['watcher','gallery','rename','convert','resize'].map(id=>({id,kind:'builtin',enabled:true}))));localStorage.setItem('piclite.interfaceStyle.v1','classic');localStorage.setItem('piclite.interfaceMaterial.v1',JSON.stringify({material:'glass',transparency:'system'}));localStorage.removeItem('piclite.toolOrder.v1');localStorage.setItem('piclite.desktopPreferences.v1',JSON.stringify({...JSON.parse(localStorage.getItem('piclite.desktopPreferences.v1')||'{}'),theme:'light'}));window.dispatchEvent(new StorageEvent('storage',{key:'piclite.desktopPreferences.v1'}));window.dispatchEvent(new StorageEvent('storage',{key:'piclite.workspacePlugins.v2'}));window.dispatchEvent(new Event('piclite:tool-order'));window.dispatchEvent(new Event('piclite:interface-style'));window.dispatchEvent(new Event('piclite:interface-material'));`);
 await wait('document.querySelectorAll("[data-tool-id]").length>=7');
 // Browser path uses native bridge fallback; these checks inspect actual React components.
 for(const [width,height] of [[1120,700],[820,540],[1440,900]]){
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await pause(150);
  const metrics=await evaluate(`(()=>{const r=el=>{const b=el.getBoundingClientRect();return {x:b.x,y:b.y,right:b.right,bottom:b.bottom,w:b.width,h:b.height}};return {header:r(document.querySelector('.topbar')),brand:r(document.querySelector('.brand')),nav:r(document.querySelector('.tool-navigation')),actions:r(document.querySelector('.topbar-actions')),appearanceButtons:document.querySelectorAll('.appearance-trigger').length,requiredActions:[...document.querySelectorAll('.appearance-trigger,.sponsor-entry-button,.settings-entry-button')].map(r),inlineAppearanceControls:document.querySelectorAll('.topbar>.topbar-actions>.material-controls,.topbar .interface-style-control').length,bodyOverflow:document.documentElement.scrollWidth>innerWidth,workspace:r(document.querySelector('.workspace')),cards:[...document.querySelectorAll('.workspace>.queue-panel,.workspace>.settings-panel,.workspace>.preview-panel')].map(r)}})()`);
  console.log(JSON.stringify({width,height,...metrics}));
  assert.equal(metrics.appearanceButtons,1);assert.equal(metrics.inlineAppearanceControls,0);assert.equal(metrics.requiredActions.length,3);assert.ok(metrics.requiredActions.every(a=>a.w>=28&&a.h>=28&&a.right<=width),'theme, support and settings must remain visible');
  assert.ok(metrics.brand.right<=metrics.nav.x+2,'brand overlaps tools');assert.ok(metrics.nav.right<=metrics.actions.x+2,'tools overlap actions');
  assert.ok(metrics.actions.right<=width,'actions outside window');assert.equal(metrics.bodyOverflow,false,'page overflows horizontally');
  assert.ok(metrics.cards.every(c=>c.right<=width&&c.bottom<=height+1),'workspace outside window');
  const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(`${scratch}/piclite-ui-v2/workspace-${width}.png`,Buffer.from(shot.data,'base64'));
 }
 // Native pointer drag, not synthetic HTML5 drag events.
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});await pause(100);
 const boxes=await evaluate(`[...document.querySelectorAll('[data-tool-id]')].map(el=>{const r=el.getBoundingClientRect();return{id:el.dataset.toolId,x:r.x+r.width/2,y:r.y+r.height/2}})`);
 const a=boxes.find(b=>b.id==='banner'),b=boxes.find(b=>b.id==='gallery');
 await send('Input.dispatchMouseEvent',{type:'mousePressed',x:a.x,y:a.y,button:'left',buttons:1,clickCount:1});
 for(let i=1;i<=12;i++)await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:a.x+(b.x-a.x)*i/12,y:a.y,button:'left',buttons:1});
 await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:b.x,y:b.y,button:'left',buttons:0});await pause(100);
 const order=await evaluate(`JSON.parse(localStorage.getItem('piclite.toolOrder.v1'))`);assert.ok(order.indexOf('banner')>order.indexOf('gallery'),'pointer drag did not reorder');
 assert.equal(await evaluate(`!!document.querySelector('.drag-overlay')`),false,'UI drag opened image import overlay');
 await send('Page.reload');await wait('document.querySelectorAll("[data-tool-id]").length>=7');
 const reloaded=await evaluate(`[...document.querySelectorAll('[data-tool-id]')].map(e=>e.dataset.toolId)`);assert.deepEqual(reloaded,order);
 // A plugin may be disabled and restored without losing its saved location.
 await evaluate(`(()=>{const plugins=JSON.parse(localStorage.getItem('piclite.workspacePlugins.v2'));plugins.find(p=>p.id==='gallery').enabled=false;localStorage.setItem('piclite.workspacePlugins.v2',JSON.stringify(plugins));window.dispatchEvent(new StorageEvent('storage',{key:'piclite.workspacePlugins.v2'}));})()`);await pause(100);
 assert.equal(await evaluate(`!!document.querySelector('[data-tool-id="gallery"]')`),false);
 await evaluate(`(()=>{const plugins=JSON.parse(localStorage.getItem('piclite.workspacePlugins.v2'));plugins.find(p=>p.id==='gallery').enabled=true;localStorage.setItem('piclite.workspacePlugins.v2',JSON.stringify(plugins));window.dispatchEvent(new StorageEvent('storage',{key:'piclite.workspacePlugins.v2'}));})()`);await pause(100);
 assert.deepEqual(await evaluate(`[...document.querySelectorAll('[data-tool-id]')].map(e=>e.dataset.toolId)`),order);
 await evaluate(`document.querySelector('.appearance-trigger').click()`);await wait('!!document.querySelector(".appearance-panel")');
 assert.equal(await evaluate(`document.querySelector('.appearance-panel').querySelectorAll('fieldset').length`),4);
 // Switch to dark and Studio using the real controls.
 await evaluate(`document.querySelectorAll('.appearance-segments')[0].querySelectorAll('button')[2].click()`);await pause(100);
 assert.equal(await evaluate('document.documentElement.dataset.theme'),'dark');
 await evaluate(`document.querySelectorAll('.appearance-segments')[2].querySelectorAll('button')[1].click()`);await pause(200);
 for(const [width,height] of [[820,540],[1120,700]]){
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await pause(100);
  const geom=await evaluate(`(()=>{const n=document.querySelector('.tool-navigation').getBoundingClientRect(),a=document.querySelector('.topbar-actions').getBoundingClientRect(),h=document.querySelector('.topbar').getBoundingClientRect();return {navRight:n.right,navBottom:n.bottom,actionsX:a.x,headerHeight:h.height,overflow:document.documentElement.scrollWidth>innerWidth};})()`);console.log('studio',width,geom);
  assert.ok(geom.navRight<=geom.actionsX+2,'Studio nav overlaps');assert.equal(geom.headerHeight,64);assert.equal(geom.overflow,false);
 }
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await pause(100);assert.equal(await evaluate(`!!document.querySelector('.appearance-panel')`),false);
 console.log('PASS: real pointer reorder + reload, single appearance button, light/dark and classic/studio geometry.');
}finally{ws.close();}
