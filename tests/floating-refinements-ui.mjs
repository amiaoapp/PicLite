// Production renderer regression for user-reported surface/focus bugs and covers.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { floatingBrowser } from './helpers/floating-test-browser.mjs';
const origin=process.env.ORIGIN||'http://127.0.0.1:1551';
const artifacts=process.env.ARTIFACTS||'/tmp/piclite-floating-refinements';mkdirSync(artifacts,{recursive:true});
await floatingBrowser(async({send,evaluate:ev,wait,click})=>{
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`
  if(window===top) { localStorage.clear();localStorage.setItem('piclite.desktopPreferences.v1',JSON.stringify({language:'en',theme:'dark',floatingStyle:'classic'}));
  localStorage.setItem('piclite.desktop.clop-settings.v1',JSON.stringify({floatingCornerRadius:10,autoHideResults:false,updateCheckFrequency:'never',preset:{mode:'manual',quality:73,scale:80,format:'webp',stripMetadata:false,preventLarger:false,targetSizeKb:0}}));
  let api;window.calls=[];window.cache=new Map();
  const imageData=()=>{const c=document.createElement('canvas');c.width=1000;c.height=600;const x=c.getContext('2d');x.fillStyle='#d56d55';x.fillRect(0,0,1000,600);x.fillStyle='#2787be';x.fillRect(250,150,500,300);return Uint8Array.from(atob(c.toDataURL().split(',')[1]),c=>c.charCodeAt(0))};
  Object.defineProperty(window,'picLite',{configurable:true,get(){return api},set(value){api={...value,windowLabel:'dropzone',getFloatingCollapsed:async()=>false,takePendingClipboard:async()=>null,onWatcherEvent:cb=>{window.publishResult=cb;return()=>{}},onTrayAction:()=>()=>{},loadImportedFonts:async()=>[],
   readImagesFromPaths:async paths=>{calls.push(['read',paths]);return Promise.all(paths.map(async path=>{const data=cache.get(path)||imageData();return{path,type:'image/png',data}}))},
   cacheImageData:async(data,name)=>{const path='/cached/'+name;cache.set(path,data);calls.push(['cache',path]);return path},
   quickCompressPaths:async(paths,settings)=>{calls.push(['compress',paths,settings]);if(window.failCompression)throw Error('intentional encoder failure');const source=paths[0],output=source.replace(/\\.png$/,'-encoded.'+settings.format.split('/').pop());cache.set(output,cache.get(source)||imageData());return[{source,output,originalBytes:10000,outputBytes:2000}]},
   configureFloatingBehavior:async()=>{},configureDropzoneWindow:async()=>{},setFloatingCollapsed:async()=>{},setFloatingToggleRegion:async()=>{},
  }}}); }
 `});
 await send('Emulation.setDeviceMetricsOverride',{width:392,height:330,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:origin+'/?window=dropzone'});await wait('typeof publishResult==="function"');
 for(let n=1;n<=3;n++){await ev(`publishResult({type:'success',file:'/source-${n}.png',output:'/source-${n}.png',time:${n},originalBytes:10000,outputBytes:${n*2000}})`);await wait(`document.querySelector('.floating-result-next')?.textContent==='1/${n}'`);}
 assert.equal(await ev('document.querySelector("main").dataset.floatingStyle'),'immersive','classic selection migrates');
 assert.equal(await ev('getComputedStyle(document.querySelector("main")).borderRadius'),'24px','old default radius migrates');
 const preset=await ev('JSON.parse(localStorage.getItem("piclite.desktop.clop-settings.v1")).preset');
 await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:500,y:400});
 const metrics=await ev(`(()=>{const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}};return{metric:rect(document.querySelector('.result-metrics')),saving:rect(document.querySelector('.result-saving')),page:rect(document.querySelector('.floating-result-next')),root:rect(document.querySelector('main')),image:getComputedStyle(document.querySelector('main')).backgroundImage}})()`);
 assert.ok(Math.abs(metrics.metric.x+metrics.metric.w/2-196)<1);assert.ok(metrics.saving.y+metrics.saving.h<=metrics.metric.y);assert.ok(Math.abs(metrics.page.x+metrics.page.w/2-196)<1);assert.equal(metrics.image,'none');
 let shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(`${artifacts}/idle.png`,Buffer.from(shot.data,'base64'));
 await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:320,y:120});await wait(`getComputedStyle(document.querySelector('.result-hover-actions')).opacity==='1'`);
 await click('[data-action="more"]');await wait('!!document.querySelector(".floating-overflow-menu")');
 await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:500,y:400});
 await wait('!document.querySelector(".floating-overflow-menu")');await wait(`getComputedStyle(document.querySelector('.result-hover-actions')).opacity==='0'`);
 assert.equal(await ev('getComputedStyle(document.querySelector(".result-metrics")).visibility'),'visible','mouse click focus does not pin overlay');
 // Keyboard users retain visible controls until focus leaves the window.
 await ev(`document.activeElement?.blur()`);await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
 await wait(`!!document.querySelector(':focus-visible')`);assert.equal(await ev('getComputedStyle(document.querySelector(".floating-card-header .floating-card-icon")).opacity'),'1');await ev('document.activeElement.blur()');
 await click('.floating-footer button[title="Expand results"]');await wait('!!document.querySelector(".floating-list.list")');
 assert.equal(await ev('getComputedStyle(document.querySelector("main")).backgroundImage'),'none');assert.equal(await ev('!!document.querySelector(".floating-window-image")'),false);
 const cards=await ev(`[...document.querySelectorAll('.floating-result-slot')].map(e=>({src:e.querySelector('img').src,radius:getComputedStyle(e.querySelector('.result-card')).borderRadius}))`);assert.equal(cards.length,3);assert.equal(new Set(cards.map(c=>c.src)).size,3);assert.ok(cards.every(c=>c.radius==='24px'));
 shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(`${artifacts}/expanded.png`,Buffer.from(shot.data,'base64'));
 await click('.floating-footer button[title="Stack results"]');await wait('!!document.querySelector(".floating-list.stack")');
 await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:320,y:120});
 await click('.cover-window-trigger');await wait(`document.querySelector('.automatic-badge').textContent.includes('封面制作')`);assert.equal(await ev('calls.filter(c=>c[0]==="compress").length'),0);
 await ev(`window.notices=[];new MutationObserver(()=>notices.push(document.querySelector('.automatic-badge')?.textContent)).observe(document.querySelector('.automatic-badge'),{childList:true,subtree:true,characterData:true});`);
 for(const format of ['webp','jpeg','png']) {
  await ev(`localStorage.setItem('piclite.cover-preset.v1',JSON.stringify({version:1,ui:{canvasW:'640',canvasH:'360',bgColor:'#1555aa',transparent:false,bgPadding:'0',bgRadius:'0',innerSize:'200',textContent:'Quick cover',format:'image/${format}',qualityNum:'77'},pos:{iconPos:{x:320,y:180},textPos:{x:320,y:300}},images:{bg:null}}));`);
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:320,y:120});await click('.cover-window-trigger');

try { await wait(`calls.some(c=>c[0]==='compress'&&c[2].format==='image/${format}') && document.querySelector('.automatic-badge').textContent.includes('Cover made')`); } catch(error) { console.log(await ev(`({calls,notices,notice:document.querySelector('.automatic-badge')?.textContent,html:document.querySelector('main')?.outerHTML.slice(0,300),frames:[...document.querySelectorAll('iframe')].map(f=>({engine:!!f.contentWindow.picLiteCover,text:f.contentDocument.body.innerText.slice(-400)}))})`));throw error; }
  const output=await ev(`(async()=>{const compress=calls.filter(c=>c[0]==='compress').at(-1),data=cache.get(compress[1][0]),bitmap=await createImageBitmap(new Blob([data],{type:'image/png'}));const c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;const x=c.getContext('2d');x.drawImage(bitmap,0,0);return{settings:compress[2],w:bitmap.width,h:bitmap.height,background:[...x.getImageData(5,5,1,1).data],source:compress[1][0],dim:document.querySelector('.result-dimensions').textContent}})()`);
  assert.equal(output.w,640);assert.equal(output.h,360);assert.equal(output.settings.quality,77);assert.equal(output.settings.scale,100);assert.equal(output.settings.exportMode,'fixed-folder');assert.equal(output.settings.fixedFolder,'/');assert.equal(output.settings.preventLarger,false);assert.deepEqual(output.background,[21,85,170,255]);assert.match(output.dim,/640.*360/);
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:320,y:120});await click('.result-actions [data-action="undo"]');await wait(`document.querySelector('.result-dimensions').textContent.includes('1,000')`);
 }
 assert.deepEqual(await ev('JSON.parse(localStorage.getItem("piclite.desktop.clop-settings.v1")).preset'),preset,'cover does not overwrite compression preset');
 await ev('window.failCompression=true');await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:320,y:120});await click('.cover-window-trigger');await wait('!!document.querySelector(".result-error")');
 assert.match(await ev('document.querySelector(".automatic-badge").textContent'),/Cover compression failed/);
 console.log('PASS background isolation, smooth shared radius, centred readouts/page, mouse versus keyboard focus, real cover engine at three formats, dimensions/background/quality, undo, unchanged preset and errors');
});
