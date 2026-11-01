import assert from 'node:assert/strict';
import {writeFileSync, mkdirSync} from 'node:fs';
const origin=process.env.ORIGIN||'http://127.0.0.1:1545';
const endpoint=`http://127.0.0.1:${process.env.CDP||9457}`;
const connect=async url=>{const ws=new WebSocket(url);await new Promise(r=>ws.onopen=r);let seq=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);const p=pending.get(m.id);if(p){pending.delete(m.id);if(m.error)p.reject(Error(JSON.stringify(m.error)));else p.resolve(m.result)}};return{ws,send:(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))})}};
const browser=await connect((await(await fetch(endpoint+'/json/version')).json()).webSocketDebuggerUrl);
const {browserContextId}=await browser.send('Target.createBrowserContext');
const {targetId}=await browser.send('Target.createTarget',{url:'about:blank',browserContextId});
const target=(await(await fetch(endpoint+'/json/list')).json()).find(t=>t.id===targetId);
const {ws,send}=await connect(target.webSocketDebuggerUrl);
const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value};
const wait=async expression=>{for(let i=0;i<150;i++){if(await ev(expression))return;await new Promise(r=>setTimeout(r,100))}throw Error('Timed out '+expression)};
const results=[];
try{
 await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});await send('Page.navigate',{url:origin});await wait(`!!document.querySelector('.app-shell')`);
 for(const layout of ['classic','studio'])for(const scale of [90,110,150])for(const width of [820,1120,1440]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});
  await ev(`(()=>{localStorage.setItem('piclite.interfaceStyle.v1',${JSON.stringify(layout)});const p={language:'en',theme:'light',interfaceFontScale:${scale},floatingResultSeconds:0};for(const key of ['piclite.desktopPreferences.v1','piclite.desktop.clop-settings.v1'])localStorage.setItem(key,JSON.stringify(p));location.reload()})()`);
  await wait(`document.querySelector('.web-app.${layout}-shell')&&document.documentElement.lang==='en'`);
  for(const populated of [false,true]){
   if(populated){await ev(`(async()=>{const c=document.createElement('canvas');c.width=800;c.height=500;const x=c.getContext('2d');x.fillStyle='#244863';x.fillRect(0,0,800,500);const blob=await new Promise(r=>c.toBlob(r));const d=new DataTransfer();d.items.add(new File([blob],'workspace-regression.png',{type:'image/png'}));const i=document.querySelector('input[type=file][multiple]:not([webkitdirectory])');i.files=d.files;i.dispatchEvent(new Event('change',{bubbles:true}))})()`);await wait(`!!document.querySelector('.compare-canvas')`);await ev(`document.querySelector('.browser-floating-header button')?.click()`)}
   await wait(`!document.querySelector('.toast')`);
   await ev(`Promise.all(document.getAnimations().filter(a=>a.playState==='running'&&a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))`);
   const state=await ev(`(()=>{const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}},t=document.querySelector('.preview-toolbar'),s=document.querySelector('.preview-stage'),p=document.querySelector('.preview-panel'),c=s.querySelector('.compare-canvas,.hero-dropzone,.studio-welcome'),heading=t.querySelector('strong');const range=document.createRange();range.selectNodeContents(heading);return{toolbar:rect(t),stage:rect(s),panel:rect(p),canvas:c&&rect(c),heading:rect(heading),glyphs:[...range.getClientRects()].map(r=>({y:r.y,bottom:r.bottom})),headingDisplay:getComputedStyle(heading.parentElement).display,rows:getComputedStyle(p).gridTemplateRows,buttons:[...t.querySelectorAll('button')].map(b=>{const r=b.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{label:b.textContent,rect:rect(b),hit:hit===b||b.contains(hit)}})}})()`);
   const errors=[];const check=(ok,message)=>{if(!ok)errors.push(message)};
   check(state.headingDisplay!=='none','heading hidden');
   for(const r of state.glyphs)check(r.y>=state.toolbar.y-1&&r.bottom<=state.toolbar.bottom+1,'heading glyphs outside toolbar');
   check(state.stage.y>=state.toolbar.bottom-1,'stage overlaps toolbar');
   if(state.canvas){check(state.canvas.y>=state.stage.y-1,'canvas escapes above stage');check(state.canvas.bottom<=state.stage.bottom+1,'canvas escapes below stage');check(state.canvas.h>=180,'preview area too small')}
   for(const b of state.buttons){check(b.rect.y>=state.toolbar.y-1&&b.rect.bottom<=state.toolbar.bottom+1,`${b.label} outside toolbar`);check(b.hit,`${b.label} occluded`)}
   const entry={layout,scale,width,populated,...state,errors};results.push(entry);
   if(errors.length&&process.env.ARTIFACTS){mkdirSync(process.env.ARTIFACTS,{recursive:true});const {data}=await send('Page.captureScreenshot',{format:'png'});writeFileSync(`${process.env.ARTIFACTS}/${layout}-${scale}-${width}-${populated?'image':'empty'}.png`,Buffer.from(data,'base64'))}
  }
 }
 if(process.env.ARTIFACTS){mkdirSync(process.env.ARTIFACTS,{recursive:true});writeFileSync(`${process.env.ARTIFACTS}/workspace-results.json`,JSON.stringify(results,null,2));}
 const failures=results.filter(r=>r.errors.length);console.log(JSON.stringify({origin,states:results.length,failures:failures.map(({layout,scale,width,populated,errors,rows,toolbar,stage,canvas})=>({layout,scale,width,populated,errors,rows,toolbar,stage,canvas}))},null,2));assert.equal(failures.length,0,'Browser preview heading, controls and canvas remain contained');
}finally{ws.close();await browser.send('Target.disposeBrowserContext',{browserContextId});browser.ws.close()}
