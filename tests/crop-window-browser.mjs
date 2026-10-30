import assert from 'node:assert/strict';
const origin=process.env.PICLITE_TEST_ORIGIN||'http://127.0.0.1:1429';
const port=process.env.PICLITE_CDP_PORT||9439;
const pages=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());
const ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener('open',r,{once:true}));
let sequence=0;const pending=new Map();
ws.addEventListener('message',({data})=>{const m=JSON.parse(data);const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}});
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
const settle=()=>new Promise(r=>setTimeout(r,120));
try{
 await send('Page.enable');
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__cropCalls=[];window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'crop-test'},currentWebview:{label:'crop-test'}},invoke:async(command,args)=>{window.__cropCalls.push({command,args});if(command==='get_crop_editor_source'){const c=document.createElement('canvas');c.width=120;c.height=80;const ctx=c.getContext('2d');ctx.fillStyle='#2d749e';ctx.fillRect(0,0,120,80);return {path:'/real/source.png',name:'source.png',width:6000,height:4000,preview:c.toDataURL()};}return null;}};`});
 await send('Emulation.setDeviceMetricsOverride',{width:960,height:660,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:`${origin}/?window=crop&request=test`});
 for(let i=0;i<50;i++){await settle();if(await evaluate('document.querySelectorAll(".crop-handle").length===8'))break;}
 assert.equal(await evaluate('document.querySelectorAll(".crop-handle").length'),8);
 assert.equal(await evaluate('document.querySelector("input[aria-label=宽度]").value'),'6000');
 await evaluate(`(()=>{const e=document.querySelector('select[aria-label=尺寸预设]');e.value='512';e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await settle();
 assert.equal(await evaluate('document.querySelector("input[aria-label=宽度]").value'),'512');
 await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='重置').click()`);await settle();
 assert.equal(await evaluate('document.querySelector("input[aria-label=宽度]").value'),'6000');
 await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='1:1').click()`);await settle();
 assert.equal(await evaluate('document.querySelector("input[aria-label=宽度]").value'),'4000');
 const rect=await evaluate(`(()=>{const r=document.querySelector('.crop-stage').getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()`);
 assert.ok(Math.abs(rect.w/rect.h-1.5)<.01);
 // Real CDP pointer drag on the right edge reduces selection in source pixels.
 const handle=await evaluate(`(()=>{const r=document.querySelector('.crop-handle-e').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
 await send('Input.dispatchMouseEvent',{type:'mousePressed',x:handle.x,y:handle.y,button:'left',clickCount:1});
 await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:handle.x-30,y:handle.y,button:'left',buttons:1});
 await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:handle.x-30,y:handle.y,button:'left'});await settle();
 const width=Number(await evaluate('document.querySelector("input[aria-label=宽度]").value'));assert.ok(width<4000&&width>0);
 await evaluate(`(()=>{const e=document.querySelector('input[aria-label=宽度]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'1234');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await settle();
 assert.equal(await evaluate('document.querySelector("input[aria-label=宽度]").value'),'1234');
 const selection=await evaluate(`(()=>{const r=document.querySelector('.crop-selection').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
 await send('Input.dispatchMouseEvent',{type:'mousePressed',x:selection.x,y:selection.y,button:'left',clickCount:1});
 await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:selection.x+20,y:selection.y+20,button:'left',buttons:1});
 await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:selection.x+20,y:selection.y+20,button:'left'});await settle();
 const expected=await evaluate(`(()=>{const s=document.querySelector('.crop-selection');return {x:Math.round(parseFloat(s.style.left)*60),y:Math.round(parseFloat(s.style.top)*40),width:1234,height:1234,outputWidth:1234,outputHeight:1234}})()`);
 assert.ok(expected.x>1000&&expected.y>0);
 for(const [w,h] of [[700,480],[960,660]]){
 await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:false});await settle();
 const fit=await evaluate(`(()=>{const f=document.querySelector('.crop-footer').getBoundingClientRect(),s=document.querySelector('.crop-stage').getBoundingClientRect(),a=document.querySelector('.crop-canvas-area').getBoundingClientRect();return {w:innerWidth,h:innerHeight,footer:f.bottom<=innerHeight,stage:s.left>=a.left&&s.right<=a.right&&s.top>=a.top&&s.bottom<=a.bottom,overflow:document.documentElement.scrollWidth>innerWidth}})()`);
 assert.deepEqual(fit,{w,h,footer:true,stage:true,overflow:false});
 }
 await evaluate(`document.querySelector('.crop-apply').click()`);await settle();
 let calls=await evaluate('window.__cropCalls');let finish=calls.find(c=>c.command==='finish_crop_editor');
 assert.deepEqual(finish.args,{request:'test',edit:expected});
 await send('Page.reload');await settle();await settle();
 await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='取消').click()`);await settle();
 calls=await evaluate('window.__cropCalls');finish=calls.find(c=>c.command==='finish_crop_editor');assert.deepEqual(finish.args,{request:'test',edit:null});
 console.log('PASS crop browser: 8 handles, full-resolution coordinates, aspect, real edge drag, precision dimensions, 700×480/960×660 fit, native apply/cancel token payloads');
}finally{ws.close();}
