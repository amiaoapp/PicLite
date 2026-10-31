import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
const artwork=process.env.ARTWORK?readFileSync('public/studio-coast.webp').toString('base64'):'';
const origin=process.env.ORIGIN||'http://127.0.0.1:1439',endpoint='http://127.0.0.1:'+(process.env.CDP||9443);
const target=await fetch(endpoint+'/json/new?about:blank',{method:'PUT'}).then(r=>r.json());const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);let seq=0;const jobs=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(jobs.has(m.id)){jobs.get(m.id)(m.result);jobs.delete(m.id)}};const send=(method,params={})=>new Promise(r=>{let id=++seq;jobs.set(id,r);ws.send(JSON.stringify({id,method,params}))});const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value};const wait=async condition=>{for(let i=0;i<120;i++){if(await ev(condition))return;await new Promise(r=>setTimeout(r,60))}throw Error('Timeout '+condition)};
const dir='/Users/amiao/.hermes/cache/scratch/piclite-ui-v13';mkdirSync(dir,{recursive:true});
try{
 await send('Page.enable');await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`
 localStorage.setItem('piclite.desktopPreferences.v1',JSON.stringify({theme:'dark',language:'en',floatingStyle:'immersive',interfaceFontScale:150}));
 localStorage.setItem('piclite.desktop.clop-settings.v1',JSON.stringify({appearance:'dark',language:'en',floatingCornerRadius:18,autoHideResults:false,updateCheckFrequency:'never',floatingDisplayMode:'stack'}));
 let api;window.fixtureArtwork=${JSON.stringify(artwork)};window.imageTone='light';Object.defineProperty(window,'picLite',{configurable:true,get(){return api},set(value){
 const c=document.createElement('canvas');c.width=1000;c.height=600;const ctx=c.getContext('2d');const dataFor=()=>{if(window.fixtureArtwork)return Uint8Array.from(atob(window.fixtureArtwork),c=>c.charCodeAt(0));ctx.fillStyle=window.imageTone==='light'?'#e7e8da':'#162028';ctx.fillRect(0,0,1000,600);for(let x=0;x<1000;x+=20){ctx.fillStyle=x%40===0?'#bda36a':'#506d7b';ctx.fillRect(x,0,8,600)}return Uint8Array.from(atob(c.toDataURL().split(',')[1]),c=>c.charCodeAt(0))};
 api={...value,windowLabel:'dropzone',getFloatingCollapsed:async()=>false,takePendingClipboard:async()=>null,onWatcherEvent:callback=>{window.publishResult=callback;return()=>{}},readImagesFromPaths:async paths=>paths.map(path=>({path,type:'image/png',data:dataFor(),width:1000,height:600})),showMainWindow:async()=>{window.workbenchOpened=(window.workbenchOpened||0)+1},configureFloatingBehavior:async()=>{},onTrayAction:()=>()=>{},loadImportedFonts:async()=>[]};}});`});
 await send('Emulation.setDeviceMetricsOverride',{width:420,height:320,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:origin+'/?window=dropzone'});await wait('typeof publishResult==="function"');
 for(const [width,height] of [[380,326],[246,188],[320,230],[680,480]]) for(const style of ['immersive','classic']) for(const tone of ['light','dark']){
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  await ev(`localStorage.setItem('piclite.desktopPreferences.v1',JSON.stringify({theme:'dark',language:'en',floatingStyle:'${style}',interfaceFontScale:150}));dispatchEvent(new StorageEvent('storage',{key:'piclite.desktopPreferences.v1'}));imageTone='${tone}';publishResult({type:'success',file:'/${style}-${tone}.png',output:'/${style}-${tone}.png',time:100,originalBytes:10000,outputBytes:2000})`);
  await wait(`!!document.querySelector('.${style==='classic'?'classic':'integrated'}-result-card')`);await wait('!!document.querySelector(".result-dimensions")');
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:width+5,y:height+5});await wait(`getComputedStyle(document.querySelector('.result-metrics')).display!=='none'`);await wait(`getComputedStyle(document.querySelector('.result-hover-actions')).opacity==='0'`);
  const idle=await ev(`(()=>{const q=s=>document.querySelector(s),g=s=>getComputedStyle(q(s));return{metric:parseFloat(g('.result-metrics').fontSize),dimension:parseFloat(g('.result-dimensions').fontSize),format:parseFloat(g('.format-bar button').fontSize),fill:g('.format-bar button:not(.active)').backgroundColor,weight:g('.result-metrics b').fontWeight,filename:g('.result-name').display,blur:getComputedStyle(q('${style==='classic'?'.classic-result-card .result-preview':'.floating-window-image'}'),'${style==='classic'?'::before':'::after'}').backdropFilter}})()`);
  assert.ok(idle.metric<=18.1,JSON.stringify(idle));assert.ok(idle.dimension<=10.1);assert.ok(idle.format<=10.1);assert.equal(idle.fill,'rgba(0, 0, 0, 0)');assert.equal(idle.weight,'400');assert.equal(idle.filename,'none');assert.match(idle.blur,/blur\(/);
  const snap=await send('Page.captureScreenshot',{format:'png'});writeFileSync(`${dir}/${style}-${tone}-${width}-idle.png`,Buffer.from(snap.data,'base64'));
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:width-25,y:height*.35});await wait(`getComputedStyle(document.querySelector('.result-metrics')).display==='none'&&getComputedStyle(document.querySelector('.result-hover-actions')).opacity==='1'`);
  await wait(`getComputedStyle(document.querySelector('.result-actions button')).backgroundColor==='rgb(239, 236, 230)'`);
  const hover=await ev(`(()=>{const q=s=>document.querySelector(s),name=(q('.floating-filename-badge')||q('.format-bar')).getBoundingClientRect();return{name:getComputedStyle(q('.floating-filename-badge')||q('.result-overlay')).display,nameY:name.top,actions:[...document.querySelectorAll('.result-actions button')].map(b=>{const r=b.getBoundingClientRect(),i=b.querySelector('svg').getBoundingClientRect();return{w:r.width,icon:i.width,bottom:r.bottom,top:r.top,left:r.left,bg:getComputedStyle(b).backgroundColor,ink:getComputedStyle(b).color,hit:document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('button')===b}})}})()`);
  assert.ok(hover.actions.every(a=>a.w>=26&&a.w<=69&&a.icon<=23&&a.top>=28&&a.bg==='rgb(239, 236, 230)'&&a.ink==='rgb(45, 46, 49)'&&a.hit),JSON.stringify({style,tone,hover}));assert.ok(hover.actions.every(a=>a.bottom<=hover.nameY+1),JSON.stringify({width,height,style,hover}));assert.equal(new Set(hover.actions.map(a=>Math.round(a.top))).size,2);assert.equal(new Set(hover.actions.map(a=>Math.round(a.left))).size,3);
  const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(`${dir}/${style}-${tone}-${width}-hover.png`,Buffer.from(shot.data,'base64'));console.log('PASS Clop idle/hover',style,tone,JSON.stringify({idle,hover}));
  if(style==='immersive'&&width===380){
   const more=await ev(`(()=>{const r=document.querySelector('[data-action=more]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
   for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...more,button:'left',clickCount:1});
   await wait(`!!document.querySelector('.floating-overflow-menu')`);
   const target=await ev(`(()=>{const b=document.querySelector('.floating-window-menu-actions button[title="Open full workbench"]'),r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===b}})()`);
   assert.equal(target.hit,true,'More menu workbench action must remain reachable');
   for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,x:target.x,y:target.y,button:'left',clickCount:1});
   assert.ok(await ev('window.workbenchOpened>0'));
   await ev('document.activeElement?.blur()');
   console.log('PASS real More menu pointer and native workbench callback',tone);
  }
 }
}finally{ws.close();}
