// Expanded history must look like scaled copies of the stacked card, with
// identical crop and frost, independent hover and real scrolling to every card.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {floatingBrowser} from './helpers/floating-test-browser.mjs';
const origin=process.env.ORIGIN||'http://127.0.0.1:1551';
const artifacts=process.env.ARTIFACTS||'/tmp/piclite-expanded';mkdirSync(artifacts,{recursive:true});
await floatingBrowser(async({send,evaluate:ev,wait,click})=>{
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`
  localStorage.clear();localStorage.setItem('piclite.desktopPreferences.v1',JSON.stringify({language:'en',theme:'dark'}));localStorage.setItem('piclite.desktop.clop-settings.v1',JSON.stringify({autoHideResults:false,updateCheckFrequency:'never',floatingDisplayMode:'stack'}));
  let api;Object.defineProperty(window,'picLite',{configurable:true,get(){return api},set(value){api={...value,windowLabel:'dropzone',getFloatingCollapsed:async()=>false,takePendingClipboard:async()=>null,onWatcherEvent:cb=>{window.publishResult=cb;return()=>{}},onTrayAction:()=>()=>{},loadImportedFonts:async()=>[],configureFloatingBehavior:async()=>{},configureDropzoneWindow:async()=>{},setFloatingToggleRegion:async()=>{},readImagesFromPaths:async paths=>paths.map(path=>{const i=Number(path.match(/source-(\\d)/)[1]),c=document.createElement('canvas');c.width=i===1?1200:600;c.height=i===2?1000:600;const x=c.getContext('2d');x.fillStyle=['#237fa0','#c56845','#466b43'][i-1];x.fillRect(0,0,c.width,c.height);x.fillStyle='#f4ce63';x.fillRect(c.width*.2,c.height*.2,c.width*.6,c.height*.6);x.fillStyle='#f6ebe0';x.font='bold 70px sans-serif';x.fillText('0'+i,c.width*.35,c.height*.55);return{path,type:'image/png',data:Uint8Array.from(atob(c.toDataURL().split(',')[1]),s=>s.charCodeAt(0))}})}}});
 `});
 await send('Page.navigate',{url:origin+'/?window=dropzone'});await wait('typeof publishResult==="function"');
 for(let n=1;n<=3;n++){await ev(`publishResult({type:'success',file:'/source-${n}.png',output:'/source-${n}.png',time:${n},originalBytes:10000,outputBytes:${n*2000}})`);await wait(`document.querySelector('.floating-result-next')?.textContent==='1/${n}'`);}
 const report=[];
 for(const [width,height] of [[246,188],[320,230],[392,330],[520,420]]){
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:2,mobile:false});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:width+30,y:height+30});
  await ev('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const stack=await ev(`(()=>{const s=document.querySelector('.floating-window-image .floating-image-slot'),r=s.getBoundingClientRect(),i=s.querySelector('img').getBoundingClientRect();return{ratio:r.width/r.height,crop:[i.width/r.width,i.height/r.height,(i.x-r.x)/r.width,(i.y-r.y)/r.height],frost:getComputedStyle(s.parentElement,'::after').backgroundImage}})()`);
  await click('.floating-footer button[title="Expand results"]');await wait(`document.querySelectorAll('.floating-list.list .result-card').length===3`);
  await ev('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const expanded=await ev(`(()=>{const list=document.querySelector('.floating-list.list');return{scroll:list.scrollHeight,client:list.clientHeight,cards:[...list.querySelectorAll('.result-card')].map(c=>{const r=c.getBoundingClientRect(),s=c.querySelector('.floating-image-slot'),b=s.getBoundingClientRect(),im=s.querySelector('img'),i=im.getBoundingClientRect();return{w:r.width,h:r.height,ratio:r.width/r.height,crop:[i.width/b.width,i.height/b.height,(i.x-b.x)/b.width,(i.y-b.y)/b.height],imageRatio:im.naturalWidth/im.naturalHeight,displayRatio:i.width/i.height,frost:getComputedStyle(c.querySelector('.floating-card-image'),'::after').backgroundImage,radius:getComputedStyle(c).borderRadius}})}})()`);
  assert.ok(expanded.scroll>expanded.client);
  for(const c of expanded.cards){assert.ok(Math.abs(c.ratio-stack.ratio)<.005,JSON.stringify({width,height,stack,expanded}));assert.ok(Math.abs(c.imageRatio-c.displayRatio)<.005);assert.equal(c.frost,stack.frost);assert.equal(c.radius,'24px');}
  expanded.cards[0].crop.forEach((v,i)=>assert.ok(Math.abs(v-stack.crop[i])<.01));
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:width/2,y:80});
  await wait(`getComputedStyle(document.querySelector('.result-card .result-hover-actions')).opacity==='1'`);
  const hover=await ev(`[...document.querySelectorAll('.result-card')].map(c=>({actions:getComputedStyle(c.querySelector('.result-hover-actions')).opacity,metrics:getComputedStyle(c.querySelector('.result-metrics')).visibility}))`);
  assert.equal(hover[0].metrics,'hidden');assert.equal(hover[1].metrics,'visible');assert.equal(hover[1].actions,'0');
  if(width===392){const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(artifacts+'/expanded-hover.png',Buffer.from(shot.data,'base64'));}
  await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:width/2,y:80,deltaX:0,deltaY:1500});await wait(`document.querySelector('.floating-list.list').scrollTop>0`);
  await ev(`document.querySelector('.floating-list.list').scrollTop=100000`);
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:width+30,y:height+30});
  await wait(`getComputedStyle(document.querySelectorAll('.result-card')[2].querySelector('.result-hover-actions')).opacity==='0'`);
  const last=await ev(`(()=>{const c=document.querySelectorAll('.result-card')[2],b=c.querySelector('[data-action="more"]'),r=b.getBoundingClientRect();return{y:r.y,bottom:r.bottom,scroll:document.querySelector('.floating-list.list').scrollTop,visible:r.y>=0&&r.bottom<=innerHeight,metrics:getComputedStyle(c.querySelector('.result-metrics')).visibility}})()`);assert.ok(last.visible,JSON.stringify({width,height,last,expanded}));assert.equal(last.metrics,'visible');
  if(width===392){await ev('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(artifacts+'/expanded-last.png',Buffer.from(shot.data,'base64'));}
  report.push({width,height,stack,expanded,hover,last});
  await click('.floating-footer button[title="Stack results"]');await wait(`!!document.querySelector('.floating-list.stack')`);
 }
 writeFileSync(artifacts+'/report.json',JSON.stringify({status:'passed',cases:report},null,2));
 console.log('PASS expanded cards match stacked aspect, crop, gradient and radius; original image proportions, independent hover, real wheel scrolling and last card, four window sizes');
});
