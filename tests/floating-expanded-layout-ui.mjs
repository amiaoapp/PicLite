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
  let api;Object.defineProperty(window,'picLite',{configurable:true,get(){return api},set(value){api={...value,windowLabel:'dropzone',getFloatingCollapsed:async()=>false,takePendingClipboard:async()=>null,onWatcherEvent:cb=>{window.publishResult=cb;return()=>{}},onTrayAction:()=>()=>{},loadImportedFonts:async()=>[],startDragging:async()=>{window.dragCalls=(window.dragCalls||0)+1},copyImagePath:async()=>{window.copyCalls=(window.copyCalls||0)+1},configureFloatingBehavior:async()=>{},configureDropzoneWindow:async()=>{},setFloatingToggleRegion:async()=>{},readImagesFromPaths:async paths=>paths.map(path=>{const i=Number(path.match(/source-(\\d)/)[1]),c=document.createElement('canvas');c.width=i===1?1200:600;c.height=i===2?1000:600;const x=c.getContext('2d');x.fillStyle=['#237fa0','#c56845','#466b43'][i-1];x.fillRect(0,0,c.width,c.height);x.fillStyle='#f4ce63';x.fillRect(c.width*.2,c.height*.2,c.width*.6,c.height*.6);x.fillStyle='#f6ebe0';x.font='bold 70px sans-serif';x.fillText('0'+i,c.width*.35,c.height*.55);return{path,type:'image/png',data:Uint8Array.from(atob(c.toDataURL().split(',')[1]),s=>s.charCodeAt(0))}})}}});
 `});
 await send('Page.navigate',{url:origin+'/?window=dropzone'});await wait('typeof publishResult==="function"');
 for(let n=1;n<=3;n++){await ev(`publishResult({type:'success',file:'/source-${n}.png',output:'/source-${n}.png',time:${n},originalBytes:10000,outputBytes:${n*2000}})`);await wait(`document.querySelector('.floating-result-next')?.textContent==='1/${n}'`);}
 const report=[];
 for(const [width,height] of [[246,188],[320,230],[392,330],[520,420]]){
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:2,mobile:false});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:width+30,y:height+30});
  await ev('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const stack=await ev(`(()=>{const s=document.querySelector('.floating-window-image .floating-image-slot'),r=s.getBoundingClientRect(),i=s.querySelector('img').getBoundingClientRect();return{ratio:r.width/r.height,crop:[i.width/r.width,i.height/r.height,(i.x-r.x)/r.width,(i.y-r.y)/r.height],frost:getComputedStyle(s.parentElement,'::after').backgroundImage}})()`);
  const stackedDrag=await ev('window.dragCalls||0');
  await ev(`document.querySelector('.result-card .result-preview').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,pointerType:'mouse'}))`);
  assert.equal(await ev('window.dragCalls'),stackedDrag+1,'stacked image must keep native dragging');
  await click('.floating-footer button[title="Expand results"]');await wait(`document.querySelectorAll('.floating-list.list .result-card').length===3`);
  await ev('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  // Both layouts must keep native window movement, without stealing control
  // clicks, right-clicks, touch scrolling, or editor-panel interaction.
  const beforeDrag=await ev('window.dragCalls||0');
  await ev(`document.querySelector('.result-card .result-preview').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,pointerType:'mouse'}))`);
  assert.equal(await ev('window.dragCalls'),beforeDrag+1,'expanded image must start native window dragging');
  const afterDrag=await ev('window.dragCalls');
  await ev(`for(const selector of ['.result-card .result-actions button','.result-card [data-action="more"]','.floating-footer button'])document.querySelector(selector).dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,pointerType:'mouse'}));
  for(const options of [{button:2,pointerType:'mouse'},{button:0,pointerType:'touch'}])document.querySelector('.result-card .result-preview').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,...options}));`);
  assert.equal(await ev('window.dragCalls'),afterDrag,'controls, right-click and touch must not drag the window');
  const expanded=await ev(`(()=>{const list=document.querySelector('.floating-list.list');return{scroll:list.scrollHeight,client:list.clientHeight,cards:[...list.querySelectorAll('.result-card')].map(c=>{const r=c.getBoundingClientRect(),s=c.querySelector('.floating-image-slot'),b=s.getBoundingClientRect(),im=s.querySelector('img'),i=im.getBoundingClientRect();const preview=c.querySelector('.result-preview').getBoundingClientRect(),overlay=c.querySelector('.result-overlay').getBoundingClientRect(),formats=c.querySelector('.floating-card-formats').getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,previewHeight:preview.height,overlayCentre:overlay.y+overlay.height/2-r.y,overlayBottom:overlay.bottom-r.y,formatsTop:formats.y-r.y,ratio:r.width/r.height,crop:[i.width/b.width,i.height/b.height,(i.x-b.x)/b.width,(i.y-b.y)/b.height],imageRatio:im.naturalWidth/im.naturalHeight,displayRatio:i.width/i.height,frost:getComputedStyle(c.querySelector('.floating-card-image'),'::after').backgroundImage,radius:getComputedStyle(c).borderRadius}})}})()`);
  assert.ok(expanded.scroll>expanded.client);
  for(const c of expanded.cards){assert.ok(c.x<1&&Math.abs(c.w-width)<1,JSON.stringify({width,height,c}));assert.ok(Math.abs(c.previewHeight-c.h)<1,JSON.stringify(c));assert.ok(Math.abs(c.overlayCentre-c.h/2)<2,JSON.stringify(c));assert.ok(c.overlayBottom<=c.formatsTop+1,JSON.stringify(c));}
  for(const c of expanded.cards){assert.ok(Math.abs(c.ratio-stack.ratio)<.005,JSON.stringify({width,height,stack,expanded}));assert.ok(Math.abs(c.imageRatio-c.displayRatio)<.005);assert.equal(c.frost,stack.frost);assert.equal(c.radius,'24px');}
  expanded.cards[0].crop.forEach((v,i)=>assert.ok(Math.abs(v-stack.crop[i])<.01));
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:width/2,y:80});
  await wait(`getComputedStyle(document.querySelector('.result-card .result-hover-actions')).opacity==='1'`);
  const hover=await ev(`[...document.querySelectorAll('.result-card')].map(c=>({actions:getComputedStyle(c.querySelector('.result-hover-actions')).opacity,metrics:getComputedStyle(c.querySelector('.result-metrics')).visibility}))`);
  const hits=await ev(`[...document.querySelector('.result-card').querySelectorAll('.result-actions button')].map(b=>{const r=b.getBoundingClientRect();return r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===b})`);assert.equal(hits.length,6);assert.ok(hits.every(Boolean),JSON.stringify({width,height,hits}));
  await click('.result-card [data-action="copy"]');
  await wait(`(window.copyCalls||0)>0`);
  assert.equal(await ev('window.dragCalls'),afterDrag,'copy click must not drag the window');
  assert.equal(hover[0].metrics,'hidden');assert.equal(hover[1].metrics,'visible');assert.equal(hover[1].actions,'0');
  if(width===392){const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(artifacts+'/expanded-hover.png',Buffer.from(shot.data,'base64'));}
  await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:width/2,y:80,deltaX:0,deltaY:1500});await wait(`document.querySelector('.floating-list.list').scrollTop>0`);
  await ev(`document.querySelector('.floating-list.list').scrollTop=100000`);
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:width+30,y:height+30});
  await wait(`getComputedStyle(document.querySelectorAll('.result-card')[2].querySelector('.result-hover-actions')).opacity==='0'`);
  const last=await ev(`(()=>{const c=document.querySelectorAll('.result-card')[2],b=c.querySelector('[data-action="more"]'),r=b.getBoundingClientRect();return{y:r.y,bottom:r.bottom,scroll:document.querySelector('.floating-list.list').scrollTop,visible:r.y>=0&&r.bottom<=innerHeight,metrics:getComputedStyle(c.querySelector('.result-metrics')).visibility}})()`);assert.ok(last.visible,JSON.stringify({width,height,last,expanded}));assert.equal(last.metrics,'visible');
  if(width===392){await ev('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(artifacts+'/expanded-last.png',Buffer.from(shot.data,'base64'));}
  // Quality panel padding is not a drag surface, and its slider remains usable.
  await ev(`document.querySelector('.floating-list.list').scrollTop=0`);
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:width/2,y:80});
  await wait(`getComputedStyle(document.querySelector('.result-card .result-hover-actions')).opacity==='1'`);
  await click('.result-card [data-action="quality"]');
  await wait(`!!document.querySelector('.result-card .floating-editor-panel')`);
  await ev(`for(const selector of ['.result-card .floating-editor-panel','.result-card .floating-editor-panel input'])document.querySelector(selector).dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,pointerType:'mouse'}))`);
  assert.equal(await ev('window.dragCalls'),afterDrag,'quality editor must not start native window dragging');
  await ev(`document.querySelector('.result-card .floating-editor-panel').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await wait(`!document.querySelector('.result-card .floating-editor-panel')`);
  report.push({width,height,stack,expanded,hover,last});
  await click('.floating-footer button[title="Stack results"]');await wait(`!!document.querySelector('.floating-list.stack')`);
 }
 writeFileSync(artifacts+'/report.json',JSON.stringify({status:'passed',cases:report},null,2));
 console.log('PASS expanded drag, control and editor isolation, touch and wheel scrolling; cards match stacked aspect, crop, gradient and radius; original image proportions, independent hover, real wheel scrolling and last card, four window sizes');
});
