import assert from 'node:assert/strict';
const origin=process.env.ORIGIN||'http://127.0.0.1:1545';
const endpoint='http://127.0.0.1:'+(process.env.CDP||9455);
async function connect(url){const ws=new WebSocket(url);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});let seq=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}};return{ws,send:(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))})}}
const browser=await connect((await(await fetch(endpoint+'/json/version')).json()).webSocketDebuggerUrl);
const {browserContextId}=await browser.send('Target.createBrowserContext');
const {targetId}=await browser.send('Target.createTarget',{url:'about:blank',browserContextId});
const target=(await(await fetch(endpoint+'/json/list')).json()).find(t=>t.id===targetId);
const {ws,send}=await connect(target.webSocketDebuggerUrl);
const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value};
const wait=async expression=>{for(let i=0;i<160;i++){if(await ev(expression))return;await new Promise(r=>setTimeout(r,50))}throw Error('Timeout '+expression)};
const click=async selector=>{await ev(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'nearest',inline:'nearest'})`);await ev('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');const p=await ev(`(()=>{const b=document.querySelector(${JSON.stringify(selector)});if(!b||b.disabled)throw Error('Missing/disabled '+${JSON.stringify(selector)});const r=b.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);if(!b.contains(hit))throw Error('Occluded '+${JSON.stringify(selector)});return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await send('Input.dispatchMouseEvent',{type:'mouseMoved',...p});for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1})};
const set=async(selector,value)=>ev(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))})()`);
try{
 await send('Page.enable');await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});await send('Emulation.setDeviceMetricsOverride',{width:1120,height:800,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:origin});await wait(`!!document.querySelector('.app-shell.web-app')&&!!document.documentElement.dataset.density`);await ev('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
 await ev(`(()=>{const plugins=['convert','resize','gallery'].map(id=>({id,kind:'builtin',enabled:true}));localStorage.setItem('piclite.workspacePlugins.v2',JSON.stringify(plugins));dispatchEvent(new StorageEvent('storage',{key:'piclite.workspacePlugins.v2'}));localStorage.setItem('piclite.desktopDownloadGuide.dismissed','1');})()`);
 await wait(`!!document.querySelector('[data-tool-id=convert]')`);
 for(const id of ['convert','resize','gallery']){
  await click('[data-tool-id='+id+']');await wait(`document.querySelector('[data-tool-id=${id}]')?.getAttribute('aria-current')==='page'`);
  const panel=await ev(`({workspace:!!document.querySelector('section.workspace'),tool:document.querySelector('.browser-image-tool')?.dataset.tool,gallery:!!document.querySelector('.gallery-page')})`);
  assert.equal(panel.workspace,false,JSON.stringify({id,panel}));assert.equal(id==='gallery'?panel.gallery:panel.tool===id,true,JSON.stringify({id,panel}));
 }
 console.log('PASS real pointer navigation: format, resize and gallery each open their own page');
 await click('[data-tool-id=convert]');
 await ev(`(async()=>{const c=document.createElement('canvas');c.width=160;c.height=100;const x=c.getContext('2d');x.fillStyle='#367fa0';x.fillRect(0,0,160,100);const blob=await new Promise(r=>c.toBlob(r));const d=new DataTransfer();d.items.add(new File([blob],'tool-source.png',{type:'image/png'}));const i=document.querySelector('.browser-image-tool input[type=file]');i.files=d.files;i.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 await wait(`document.querySelectorAll('.browser-image-tool .web-tool-item').length===1`);
 await set('#web-tool-format','image/jpeg');await click('.browser-image-tool .web-tool-run');await wait(`!!document.querySelector('.browser-image-tool .web-tool-item.done')`);
 let converted=await ev(`(async()=>{const blob=await fetch(document.querySelector('.web-tool-result img').src).then(r=>r.blob());const b=await createImageBitmap(blob);return{type:blob.type,width:b.width,height:b.height,bytes:blob.size}})()`);assert.equal(converted.type,'image/jpeg');assert.deepEqual([converted.width,converted.height],[160,100]);
 const globalBefore=await ev(`localStorage.getItem('piclite.compressionSettings.v2')`);
 await click('[data-tool-id=resize]');await set('#web-resize-scale','50');await click('.browser-image-tool .web-tool-run');await wait(`document.querySelector('.web-tool-result img')?.naturalWidth===80`);
 const resized=await ev(`(async()=>{const blob=await fetch(document.querySelector('.web-tool-result img').src).then(r=>r.blob());const b=await createImageBitmap(blob);return{type:blob.type,width:b.width,height:b.height,bytes:blob.size}})()`);assert.deepEqual([resized.width,resized.height],[80,50]);assert.equal(await ev(`localStorage.getItem('piclite.compressionSettings.v2')`),globalBefore,'tool inputs do not overwrite workbench settings');
 await click('[data-tool-id=gallery]');await wait(`document.querySelectorAll('.gallery-card').length>0`);assert.equal(await ev(`!!document.querySelector('section.workspace')`),false);
 console.log('PASS independent tools produce real JPEG160x100 and resize80x50, gallery opens stored results',JSON.stringify({converted,resized}));
 await click('[data-tool-id=workspace]');await wait(`!!document.querySelector('section.workspace')`);console.log('PASS return to unchanged workspace');
}finally{ws.close();await browser.send('Target.disposeBrowserContext',{browserContextId});browser.ws.close()}
