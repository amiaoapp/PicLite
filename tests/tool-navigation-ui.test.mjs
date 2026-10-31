// Source-component regression checks; production entry coverage lives in workspace-chrome-ui.mjs.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
const root = decodeURIComponent(new URL('../', import.meta.url).pathname);
const port = process.env.PICLITE_CDP_PORT || 9443;
const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let sequence = 0; const pending = new Map();
ws.addEventListener('message', ({data}) => { const m=JSON.parse(data);const p=pending.get(m.id);if(p){pending.delete(m.id);if(m.error)p.reject(Error(m.error.message));else p.resolve(m.result);} });
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
const wait=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,25));}throw Error(`Timed out: ${expression}`);};
const bundle=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{ToolNavigation}from'./app/tool-navigation';window.renderTools=(count=7)=>window.root.render(<ToolNavigation language="en" items={['workspace','banner','rename','watcher','convert','resize','gallery'].slice(0,count).map((id,i)=>({id,label:['Workspace','Cover maker','Batch rename','Folder watch','Format converter','Resize images','Library'][i],active:i===0,select:()=>{window.selectedTool=id;}}))}/>);window.root=createRoot(document.getElementById('tools'));window.renderTools();`,resolveDir:root,loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'empty'}});
const css=['globals.css','studio.css','workspace-chrome.css'].map(file=>readFileSync(new URL(`../app/${file}`,import.meta.url),'utf8')).join('\n');
try {
 await send('Page.navigate',{url:process.env.PICLITE_TEST_ORIGIN||'http://127.0.0.1:1439'});
 await wait('document.readyState==="complete" && location.href!=="about:blank"');
 const fixtureUrl=await evaluate(`URL.createObjectURL(new Blob([${JSON.stringify(`<!doctype html><html><head><style>${css}</style></head><body><main class="app-shell desktop-app classic-shell"><header class="topbar"><div class="brand"><button class="brand-home"><span class="brand-mark"></span><span><strong>PicLite</strong><small>Image Optimiser</small></span></button><button class="brand-version">v2.0.2</button></div><div id="tools" style="min-width:0;height:100%"></div><div class="topbar-actions">Settings</div></header></main></body></html>`)}],{type:'text/html'}))`);
 await send('Page.navigate',{url:fixtureUrl});await wait('!!document.getElementById("tools")');
 await evaluate(`localStorage.removeItem('piclite.toolOrder.v1');${bundle.outputFiles[0].text}`);
 await wait('document.querySelectorAll("[data-tool-id]").length===7');
 await test('scroll arrows and tabs share one row at all supported sizes',async()=>{
  for(const style of ['classic','studio'])for(const scale of [1,1.5])for(const width of [820,1120,1440]){
   await send('Emulation.setDeviceMetricsOverride',{width,height:700,deviceScaleFactor:1,mobile:false});
   await evaluate(`document.querySelector('main').className='app-shell desktop-app ${style}-shell';document.querySelectorAll('[data-tool-id]').forEach(el=>el.style.fontSize='${12*scale}px');document.querySelector('.brand strong').style.fontSize='${18*scale}px';document.querySelector('.brand small').style.fontSize='${11*scale}px';document.querySelector('.brand-version').style.fontSize='${9*scale}px';new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
   const geometry=await evaluate(`(()=>{const nav=document.querySelector('.tool-tabs'),rail=document.querySelector('.tool-navigation');const rect=el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,w:r.width,h:r.height,cy:r.y+r.height/2}};return{viewport:innerWidth,brand:rect(document.querySelector('.brand')),rail:rect(rail),nav:rect(nav),arrows:[...rail.querySelectorAll('.nav-scroll')].map(el=>({...rect(el),disabled:el.disabled,hidden:el.hidden,display:getComputedStyle(el).display})),tabs:[...nav.children].map(rect),overflow:nav.scrollWidth>nav.clientWidth+1,statusPosition:getComputedStyle(rail.querySelector('[role=status]')).position}})()`);
   assert.equal(geometry.viewport,width);
   assert.ok(geometry.brand.right<=geometry.rail.x+1,'scaled brand does not overlap navigation');
   const visible=geometry.arrows.filter(a=>!a.hidden&&a.display!=='none');
   for(const arrow of visible)assert.ok(Math.abs(arrow.cy-geometry.tabs[0].cy)<=1,`${style}/${scale}/${width}: arrows and tabs must share a centre: ${JSON.stringify(geometry)}`);
   assert.ok(geometry.tabs.every(t=>Math.abs(t.cy-geometry.tabs[0].cy)<=1),'tabs remain on one row');
   assert.ok(geometry.nav.y>=geometry.rail.y&&geometry.nav.bottom<=geometry.rail.bottom+1,'navigation stays inside its rail');
   assert.ok(geometry.overflow?visible.length===2:visible.length===0,'only overflowing tabs expose scroll arrows');
   if(geometry.overflow)assert.equal(visible[0].disabled,true,'left edge cannot scroll farther left');
   assert.equal(geometry.statusPosition,'absolute','accessible status must not become a layout child');
  }
 });
 await test('scroll limits update after resize, content changes and scrolling',async()=>{
  await send('Emulation.setDeviceMetricsOverride',{width:820,height:700,deviceScaleFactor:1,mobile:false});
  await evaluate("window.renderTools(7);document.querySelectorAll('[data-tool-id]').forEach(el=>el.style.fontSize='18px')");
  await wait("document.querySelector('.nav-scroll:last-of-type')?.disabled===false");
  await evaluate("document.querySelector('.tool-tabs').scrollLeft=10000");
  await wait("document.querySelector('.nav-scroll:last-of-type')?.disabled===true");
  assert.equal(await evaluate("document.querySelector('.nav-scroll').disabled"),false);
  await evaluate('window.renderTools(1)');
  await wait("[...document.querySelectorAll('.nav-scroll')].every(el=>el.hidden||getComputedStyle(el).display==='none')");
  await evaluate('window.renderTools(7)');
  await wait("[...document.querySelectorAll('.nav-scroll')].every(el=>!el.hidden&&getComputedStyle(el).display!=='none')");
 });
 await test('keyboard ordering and selection still work',async()=>{
  await evaluate("document.querySelector('[data-tool-id=workspace]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',altKey:true,bubbles:true}))");
  await wait("document.querySelector('[data-tool-id]').dataset.toolId==='banner'");
  await evaluate("document.querySelector('[data-tool-id=banner]').click()");
  assert.equal(await evaluate('window.selectedTool'),'banner');
 });
 await test('pointer drag still persists order on the stable navigation container',async()=>{
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:700,deviceScaleFactor:1,mobile:false});
  await evaluate("document.querySelectorAll('[data-tool-id]').forEach(el=>el.style.fontSize='12px');document.querySelector('.tool-tabs').scrollLeft=0");
  const boxes=await evaluate("[...document.querySelectorAll('[data-tool-id]')].map(el=>{const r=el.getBoundingClientRect();return{id:el.dataset.toolId,x:r.x+r.width/2,y:r.y+r.height/2}})");
  const from=boxes.find(b=>b.id==='banner'),to=boxes.find(b=>b.id==='resize');
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:from.x,y:from.y,button:'left',buttons:1,clickCount:1});
  for(let i=1;i<=12;i++)await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:from.x+(to.x-from.x)*i/12,y:from.y,button:'left',buttons:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:to.x,y:to.y,button:'left',buttons:0});
  const order=await evaluate("JSON.parse(localStorage.getItem('piclite.toolOrder.v1'))");
  assert.ok(order.indexOf('banner')>order.indexOf('resize'),'real pointer drag reorders tabs');
  assert.deepEqual(await evaluate("[...document.querySelectorAll('[data-tool-id]')].map(el=>el.dataset.toolId)"),order);
 });
} finally {ws.close();await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`);}
