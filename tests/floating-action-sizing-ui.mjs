// Exercise production bundle's real renderer entry and stylesheet import order.
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {mkdirSync,writeFileSync} from 'node:fs';
const endpoint='http://127.0.0.1:'+(process.env.CDP||9443),origin=process.env.ORIGIN||'http://127.0.0.1:1439';
const target=await fetch(endpoint+'/json/new?about:blank',{method:'PUT'}).then(r=>r.json());
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);let id=0;const pending=new Map();
ws.onmessage=e=>{const x=JSON.parse(e.data);if(pending.has(x.id)){pending.get(x.id)(x.result);pending.delete(x.id);}};
const send=(method,params={})=>new Promise(r=>{const n=++id;pending.set(n,r);ws.send(JSON.stringify({id:n,method,params}));});
const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
const wait=async condition=>{for(let i=0;i<80;i++){if(await ev(condition))return;await new Promise(r=>setTimeout(r,50));}throw Error('timeout '+condition);};
const click=async selector=>{const p=await ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await send('Input.dispatchMouseEvent',{type:'mouseMoved',...p});await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p});};
const dir='/Users/amiao/.hermes/cache/scratch/piclite-ui-v8';mkdirSync(dir,{recursive:true});
try{
 await send('Page.enable');
 await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`
 localStorage.setItem('piclite.desktop.clop-settings.v1',JSON.stringify({appearance:'dark',language:'en',floatingCornerRadius:0,autoHideResults:false,updateCheckFrequency:'never',floatingDisplayMode:'stack'}));
 localStorage.setItem('piclite.interfaceMaterial.v1',JSON.stringify({material:'glass',transparency:'system'}));
 let api;window.calls=[];Object.defineProperty(window,'picLite',{configurable:true,get(){return api},set(value){
 const c=document.createElement('canvas');c.width=1000;c.height=600;const ctx=c.getContext('2d');ctx.fillStyle='#23a5ff';ctx.fillRect(0,0,1000,600);ctx.fillStyle='#ffe432';ctx.fillRect(700,0,300,600);const data=Uint8Array.from(atob(c.toDataURL().split(',')[1]),c=>c.charCodeAt(0));
 api={...value,windowLabel:'dropzone',getFloatingCollapsed:async()=>false,takePendingClipboard:async()=>null,onWatcherEvent:callback=>{window.publishResult=callback;return()=>{}},readImagesFromPaths:async paths=>paths.map(path=>({path,type:'image/png',data,width:1000,height:600})),showMainWindow:async()=>calls.push('workbench'),hideCurrentWindow:async()=>calls.push('hide'),configureFloatingBehavior:async()=>{},onTrayAction:()=>()=>{},loadImportedFonts:async()=>[],setWindowMaterial:async input=>{calls.push(input);return{enabled:false,backend:'opaque',radius:input.radius}}};
 }});
 `});
 await send('Emulation.setDeviceMetricsOverride',{width:420,height:320,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:origin+'/?window=dropzone'});await wait('typeof publishResult==="function"');
 for(let count=1;count<=6;count++){
  await ev(`publishResult({type:'success',file:'/image${count}.png',output:'/image${count}.png',time:${count},originalBytes:${count*10000},outputBytes:${count*2000}})`);
  await wait('!!document.querySelector(".floating-window-image img")?.naturalWidth');await new Promise(r=>setTimeout(r,100));
  assert.equal(await ev('document.querySelectorAll("[data-action=dismiss]").length'),1,'single controls layer');
  assert.equal(await ev('document.querySelectorAll(".result-metrics").length'),1);
  const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(`${dir}/production-${count}.png`,Buffer.from(shot.data,'base64'));
  const {data,info}=await sharp(Buffer.from(shot.data,'base64')).raw().toBuffer({resolveWithObject:true});
  for(const [x,y,expected] of [[50,75,[35,165,255]],[210,75,[35,165,255]],[375,75,[255,228,50]],[5,285,[35,165,255]]]){const k=(y*info.width+x)*info.channels,rgb=[...data.subarray(k,k+3)];assert.ok(rgb.every((v,i)=>Math.abs(v-expected[i])<12),'actual production image darkened: '+JSON.stringify({count,x,y,rgb}));}
  await click('.floating-footer button[title="Open full workbench"]');assert.equal(await ev('calls.filter(c=>c==="workbench").length'),count);
 }
 for(const [width,height,minButton,minIcon] of [[246,188,30,18],[320,230,40,24],[488,372,55,33],[680,480,55,33]]){
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await new Promise(r=>setTimeout(r,100));
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:width/2,y:height*.35});await new Promise(r=>setTimeout(r,100));
  const actions=await ev(`([...document.querySelectorAll('.result-actions button')].map(b=>{let r=b.getBoundingClientRect(),i=b.querySelector('svg').getBoundingClientRect(),s=getComputedStyle(b);return{w:r.width,h:r.height,icon:i.width,x:r.x,y:r.y,ix:i.x,iy:i.y,ih:i.height,variable:s.getPropertyValue('--action-size')}}))`);
  assert.equal(await ev(`getComputedStyle(document.querySelector('.result-actions')).gridTemplateColumns.split(' ').length`),height<=240?6:3);console.log('ACTION LAYOUT',width,height,height<=240?'one row':'two rows',actions[0]);assert.equal(actions.length,6);for(const a of actions){assert.ok(a.w>=minButton,'button too small '+JSON.stringify(a));assert.ok(a.icon>=minIcon,'icon too small '+JSON.stringify(a));assert.ok(Math.abs(a.x+a.w/2-a.ix-a.icon/2)<1);assert.ok(Math.abs(a.y+a.h/2-a.iy-a.ih/2)<1);}
  const image=await send('Page.captureScreenshot',{format:'png'});writeFileSync(`${dir}/large-actions-${width}.png`,Buffer.from(image.data,'base64'));

  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await new Promise(r=>setTimeout(r,100));
  const hits=await ev(`([...document.querySelectorAll('.floating-footer button,.floating-card-bottom button,.floating-card-header button')].filter(e=>!e.disabled).map(e=>{const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{label:e.title||e.textContent,hit:hit===e||e.contains(hit)}}))`);assert.ok(hits.every(h=>h.hit),JSON.stringify({width,hits}));
 }
 const beforeNext=await ev('document.querySelector(".result-metrics").textContent');
 await click('.floating-result-next');await new Promise(r=>setTimeout(r,100));assert.equal(await ev('document.querySelectorAll("[data-action=dismiss]").length'),1);assert.notEqual(await ev('document.querySelector(".result-metrics").textContent'),beforeNext,'next must change displayed result');
 await click('.floating-footer button[title="Expand results"]');await wait('!!document.querySelector(".floating-list.list")');assert.equal(await ev('document.querySelectorAll(".result-card").length'),6,'all results retained in list');
 await click('.floating-footer button[title="Stack results"]');await wait('!!document.querySelector(".floating-list.stack")');assert.equal(await ev('document.querySelectorAll(".result-card").length'),1);
 await click('[data-action=dismiss]');await wait('document.querySelector(".floating-result-next")?.textContent.endsWith("/5")');
 assert.equal(await ev('document.documentElement.dataset.material'),'standard','saved glass migrates to standard');
 assert.ok(await ev('calls.filter(c=>typeof c==="object").every(c=>c.enabled===false)'));
 console.log('PASS production bundle: 1–6 images undimmed, single controls, real footer click, 3 sizes all control hits, next/list/stack/dismiss, saved glass disabled');
}finally{ws.close();}
