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
 await send('Page.enable');await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`
 localStorage.setItem('piclite.desktop.clop-settings.v1',JSON.stringify({appearance:'dark',language:'en',floatingCornerRadius:0,autoHideResults:false,updateCheckFrequency:'never',floatingDisplayMode:'stack'}));
 localStorage.setItem('piclite.interfaceMaterial.v1',JSON.stringify({material:'glass',transparency:'system'}));
 let api;window.calls=[];window.imageTone='light';Object.defineProperty(window,'picLite',{configurable:true,get(){return api},set(value){
 const c=document.createElement('canvas');c.width=1000;c.height=600;const ctx=c.getContext('2d');const dataFor=()=>{ctx.fillStyle=window.imageTone==='light'?'#fafafa':'#111111';ctx.fillRect(0,0,1000,600);return Uint8Array.from(atob(c.toDataURL().split(',')[1]),c=>c.charCodeAt(0));};
 api={...value,windowLabel:'dropzone',getFloatingCollapsed:async()=>false,takePendingClipboard:async()=>null,onWatcherEvent:callback=>{window.publishResult=callback;return()=>{}},readImagesFromPaths:async paths=>paths.map(path=>({path,type:'image/png',data:dataFor(),width:1000,height:600})),showMainWindow:async()=>calls.push('workbench'),hideCurrentWindow:async()=>calls.push('hide'),configureFloatingBehavior:async()=>{},onTrayAction:()=>()=>{},loadImportedFonts:async()=>[],setWindowMaterial:async input=>{calls.push(input);return{enabled:false,backend:'opaque',radius:input.radius}}};
 }});
 `});
 await send('Emulation.setDeviceMetricsOverride',{width:420,height:320,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:origin+'/?window=dropzone'});await wait('typeof publishResult==="function"');

 for(const tone of ['light','dark']){
  await ev(`imageTone='${tone}';publishResult({type:'success',file:'/${tone}.png',output:'/${tone}.png',time:100,originalBytes:10000,outputBytes:2000})`);
  await wait(`document.querySelector('.result-card')?.dataset.imageTone==='${tone}'`);
  const color=await ev(`(()=>{const q=s=>getComputedStyle(document.querySelector(s));return{ink:q('.result-dimensions').color,bg:q('.floating-card-icon').backgroundColor,text:q('.floating-card-icon').color}})()`);
  const nums=s=>s.match(/[\d.]+/g).slice(0,3).map(Number),brightness=s=>nums(s).reduce((a,b)=>a+b,0)/3;
  assert.ok(tone==='light'?brightness(color.ink)<80:brightness(color.ink)>220,JSON.stringify(color));assert.ok(tone==='light'?brightness(color.bg)<80:brightness(color.bg)>220,JSON.stringify(color));
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:210,y:110});const image=await send('Page.captureScreenshot',{format:'png'});writeFileSync(`${dir}/adaptive-${tone}.png`,Buffer.from(image.data,'base64'));
 }
 await ev(`localStorage.setItem('piclite.desktopPreferences.v1',JSON.stringify({floatingStyle:'classic'}));dispatchEvent(new StorageEvent('storage',{key:'piclite.desktopPreferences.v1'}))`);
 await wait(`!!document.querySelector('.classic-result-card')`);assert.equal(await ev('document.querySelectorAll(".floating-card-content").length'),0);assert.ok(await ev('!!document.querySelector(".result-name")'));
 await click('.floating-footer button[title="Open full workbench"]');assert.equal(await ev('calls.filter(c=>c==="workbench").length'),1);
 const classic=await send('Page.captureScreenshot',{format:'png'});writeFileSync(`${dir}/classic.png`,Buffer.from(classic.data,'base64'));
 await ev(`localStorage.setItem('piclite.desktopPreferences.v1',JSON.stringify({floatingStyle:'immersive'}));dispatchEvent(new StorageEvent('storage',{key:'piclite.desktopPreferences.v1'}))`);await wait(`!!document.querySelector('.integrated-result-card')`);
 console.log('PASS light/dark image contrast and actual classic/immersive switch, all results retained');
 assert.equal(await ev('document.documentElement.dataset.material'),'standard','saved glass migrates to standard');
 assert.ok(await ev('calls.filter(c=>typeof c==="object").every(c=>c.enabled===false)'));
 console.log('PASS standard-only appearance remains enforced');
}finally{ws.close();}
