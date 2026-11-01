import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
const origin=process.env.ORIGIN||'https://amiaoapp.github.io/PicLite/';
const endpoint='http://127.0.0.1:'+(process.env.CDP||9443);
async function connect(url){const ws=new WebSocket(url);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});let seq=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}};return{ws,send:(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))})}}
const browser=await connect((await(await fetch(endpoint+'/json/version')).json()).webSocketDebuggerUrl);
const {browserContextId}=await browser.send('Target.createBrowserContext');
const {targetId}=await browser.send('Target.createTarget',{url:'about:blank',browserContextId});
const target=(await(await fetch(endpoint+'/json/list')).json()).find(t=>t.id===targetId);
const {ws,send}=await connect(target.webSocketDebuggerUrl);
const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value};
const wait=async expression=>{for(let i=0;i<200;i++){if(await ev(expression))return;await new Promise(r=>setTimeout(r,50))}throw Error('Timeout '+expression)};
const click=async selector=>{await ev(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'center',inline:'nearest'})`);await ev('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');const p=await ev(`(()=>{const b=document.querySelector(${JSON.stringify(selector)});if(!b||b.disabled)throw Error('Missing target');const r=b.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);if(!b.contains(hit))throw Error('Occluded '+${JSON.stringify(selector)});return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await send('Input.dispatchMouseEvent',{type:'mouseMoved',...p});for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1})};
let cases=0;
try{
 await send('Page.enable');await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});await send('Emulation.setDeviceMetricsOverride',{width:1120,height:800,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:origin});await wait(`!!document.querySelector('.settings-entry-button')&&!!document.documentElement.dataset.density`);
 await click('.settings-entry-button');await wait(`!!document.querySelector('.preferences-sidebar')`);
 await ev(`[...document.querySelectorAll('.preferences-sidebar nav button')].find(b=>/插件|Plugins/.test(b.textContent)).click()`);await wait(`!!document.querySelector('.plugin-import-panel')`);
 for(const layout of ['classic','studio'])for(const language of ['zh','en'])for(const scale of [110,150])for(const width of [820,1120,1440]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});
  await ev(`(()=>{localStorage.setItem('piclite.interfaceStyle.v1','${layout}');localStorage.setItem('piclite.desktopPreferences.v1',JSON.stringify({...JSON.parse(localStorage.getItem('piclite.desktopPreferences.v1')||'{}'),language:'${language}',interfaceFontScale:${scale}}));dispatchEvent(new StorageEvent('storage',{key:'piclite.desktopPreferences.v1'}));dispatchEvent(new Event('piclite:interface-style'));dispatchEvent(new Event('piclite:interface-typography'));})()`);
  await wait(`document.querySelector('.app-shell.${layout}-shell')&&document.documentElement.lang==='${language==='zh'?'zh-CN':'en'}'&&Number(getComputedStyle(document.documentElement).getPropertyValue('--interface-font-scale'))===${scale/100}`);
  await ev(`document.querySelector('.plugin-import-panel').scrollIntoView({block:'center'});document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))`);
  const state=await ev(`(()=>{const r=e=>{const b=e.getBoundingClientRect();return{x:b.x,y:b.y,right:b.right,bottom:b.bottom,w:b.width,h:b.height}},p=document.querySelector('.plugin-import-panel'),card=p.closest('.plugin-preference-card'),label=p.querySelector('span'),range=document.createRange();range.selectNodeContents(label);return{panel:r(p),card:r(card),label:{...r(label),lines:[...range.getClientRects()].map(b=>({w:b.width,h:b.height}))},children:[...p.children].map(e=>({...r(e),tag:e.tagName,text:e.textContent,scroll:e.scrollWidth,client:e.clientWidth})),overflow:p.scrollWidth-p.clientWidth,documentOverflow:document.documentElement.scrollWidth-innerWidth}})()`);
  const context=JSON.stringify({layout,language,scale,width,state});
  assert.ok(state.overflow<=1,context);assert.ok(state.documentOverflow<=1,context);assert.ok(state.label.lines.length<=2,'separator must not wrap one character per line '+context);assert.ok(state.label.w>=120,context);
  for(const child of state.children){assert.ok(child.x>=state.panel.x-1&&child.right<=state.panel.right+1,context);if(child.tag==='INPUT')assert.ok(child.w>=160,context);if(child.tag==='BUTTON')assert.ok(child.scroll<=child.client+1,context);}
  for(let i=0;i<state.children.length;i++)for(let j=i+1;j<state.children.length;j++){const a=state.children[i],b=state.children[j];assert.ok(Math.min(a.right,b.right)-Math.max(a.x,b.x)<=1||Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)<=1,'overlap '+context)}
  if(process.env.ARTIFACTS&&width===820&&scale===150){mkdirSync(process.env.ARTIFACTS,{recursive:true});const {data}=await send('Page.captureScreenshot',{format:'png'});writeFileSync(`${process.env.ARTIFACTS}/${layout}-${language}-150.png`,Buffer.from(data,'base64'));}
  cases++;
 }
 await send('Emulation.setDeviceMetricsOverride',{width:1120,height:800,deviceScaleFactor:1,mobile:false});
 const before=await ev(`document.querySelector('.plugin-row [role=switch]').getAttribute('aria-checked')`);await click('.plugin-row [role=switch]');assert.equal(await ev(`document.querySelector('.plugin-row [role=switch]').getAttribute('aria-checked')`),before==='true'?'false':'true');await click('.plugin-row [role=switch]');
 const order=await ev(`JSON.parse(localStorage.getItem('piclite.workspacePlugins.v2')).map(p=>p.id)`);await click('.plugin-row:nth-of-type(2) .plugin-row-actions button:nth-child(2)');const moved=await ev(`JSON.parse(localStorage.getItem('piclite.workspacePlugins.v2')).map(p=>p.id)`);assert.notDeepEqual(moved,order,'ordering callback preserved');
 console.log(`PASS ${cases} production plugin layout cases; horizontal separator, readable inputs, full buttons, no overlaps; actual toggle and ordering preserved`);
}finally{ws.close();await browser.send('Target.disposeBrowserContext',{browserContextId});browser.ws.close()}
