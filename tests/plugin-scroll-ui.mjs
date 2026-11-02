// Production desktop entry with isolated native I/O. Exercise real wheel scroll,
// bottom hit targets, populated queues and conversion callbacks in both layouts.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {floatingBrowser} from './helpers/floating-test-browser.mjs';
const origin=process.env.ORIGIN||'http://127.0.0.1:1551';
const artifacts=process.env.ARTIFACTS||'/tmp/piclite-plugin-scroll';mkdirSync(artifacts,{recursive:true});
await floatingBrowser(async({send,evaluate:ev,wait})=>{
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`
 if(window===top){
  localStorage.clear();localStorage.setItem('piclite.interfaceStyle.v1','studio');
  localStorage.setItem('piclite.desktopPreferences.v1',JSON.stringify({language:'zh',theme:'light',interfaceFontScale:110,updateCheckFrequency:'never'}));
  localStorage.setItem('piclite.workspacePlugins.v2',JSON.stringify(['watcher','rename','convert','resize','gallery'].map(id=>({id,kind:'builtin',enabled:true}))));
  addEventListener('DOMContentLoaded',()=>{document.documentElement.classList.add('desktop-root');document.documentElement.dataset.platform='darwin';});
  window.nativeCalls=[];window.errors=[];addEventListener('error',e=>errors.push(e.message));addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
  const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5XcAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
  const entries=()=>Array.from({length:24},(_,i)=>({name:'image-'+i+'.png',path:'/source/image-'+i+'.png',type:'image/png',originalBytes:123456,width:1600,height:1000,thumbnailType:'image/png',thumbnailData:png}));
  const fixtureApi=new Proxy({platform:'darwin',windowLabel:'main',loadAppProfile:async()=>null,loadUploadProfile:async()=>null,loadImportedFonts:async()=>[],listSystemFonts:async()=>[],getWatcherState:async()=>({active:false}),selectImageEntries:async()=>entries(),selectImageFolderEntries:async()=>entries(),selectFolder:async()=>'/output',checkForUpdates:async()=>({available:false}),quickCompressPaths:async(paths,settings)=>{nativeCalls.push({paths,settings});return paths.map(source=>({source,output:'/output/'+source.split('/').pop()+'.webp',originalBytes:123456,outputBytes:23456,keptOriginal:false}));}}, {get(target,key){if(key in target)return target[key];if(String(key).startsWith('on'))return()=>()=>{};return async()=>null;}});Object.defineProperty(window,'picLite',{configurable:true,get(){return fixtureApi},set(){}});
 }
 `});
 await send('Emulation.setDeviceMetricsOverride',{width:1120,height:700,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:origin});await wait(`!!document.querySelector('.desktop-app [data-tool-id=convert]')`);
 const report=[];
 for(const layout of ['classic','studio'])for(const scale of [110,150])for(const [width,height] of [[820,540],[1120,700],[1440,900]]){
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  await ev(`localStorage.setItem('piclite.interfaceStyle.v1','${layout}');dispatchEvent(new Event('piclite:interface-style'));for(const key of ['piclite.desktopPreferences.v1','piclite.desktop.clop-settings.v1'])localStorage.setItem(key,JSON.stringify({...JSON.parse(localStorage.getItem(key)||'{}'),interfaceFontScale:${scale}}));dispatchEvent(new Event('piclite:interface-typography'));`);
  await wait(`!!document.querySelector('.${layout}-shell')`);
  for(const [tool,selector] of [['banner','.banner-page'],['watcher','.watcher-page'],['rename','.rename-page'],['convert','.converter-page'],['resize','.resize-page'],['gallery','.gallery-page']]){
   await ev(`document.querySelector('[data-tool-id=${tool}]').click()`);await wait(`!!document.querySelector('${selector}')`);
   if(tool==='banner'){
    await wait(`!!document.querySelector('.banner-page iframe').contentDocument?.querySelector('.controls-scroll')`);
    const geometry=await ev(`(()=>{const f=document.querySelector('.banner-page iframe'),p=f.contentDocument.querySelector('.controls-scroll'),r=f.getBoundingClientRect(),s=p.getBoundingClientRect();return{y:r.y,bottom:r.bottom,h:r.height,scroll:p.scrollHeight,client:p.clientHeight,x:r.x+s.x+s.width-16,wheelY:r.y+s.y+s.height/2}})()`);
    assert.ok(geometry.bottom<=height+1&&geometry.h>200,JSON.stringify({layout,scale,width,tool,geometry}));
    assert.ok(geometry.scroll>geometry.client&&geometry.client>40,'cover settings have their own bounded scroll area');
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:geometry.x,y:geometry.wheelY});
    await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:geometry.x,y:geometry.wheelY,deltaX:0,deltaY:3000});
    await wait(`document.querySelector('.banner-page iframe').contentDocument.querySelector('.controls-scroll').scrollTop>0`);
    report.push({layout,scale,width,height,tool,...geometry});continue;
   }
   if(tool==='convert'){
    await ev(`document.querySelector('.tool-queue header button')?.click();document.querySelector('.tool-import-actions button').click()`);try{await wait(`document.querySelectorAll('.tool-queue-list article').length===24`);}catch(error){console.log(await ev(`({count:document.querySelectorAll('.tool-queue-list article').length,notice:document.querySelector('.tool-actions')?.textContent,errors:window.errors,url:location.href,bridge:window.picLite?.windowLabel})`));throw error;}
    await ev(`document.querySelector('.conversion-format-grid button:nth-child(2)').click()`);
    assert.equal(await ev(`document.querySelector('.conversion-all-formats select').value`),'image/jpeg');
   }
   // Long plugin content must remain reachable, including imported HTML plugins.
   await ev(`(()=>{const page=document.querySelector('${selector}');page.scrollTop=0;const content=document.createElement('div');content.className='scroll-regression-tail';content.style.height='900px';const button=document.createElement('button');button.textContent='End of plugin';button.id='plugin-end';button.style.cssText='height:40px;width:150px';content.append(button);page.append(content);content.style.display='flex';content.style.alignItems='flex-end';})()`);
   await ev(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
   const geometry=await ev(`(()=>{const p=document.querySelector('${selector}'),r=p.getBoundingClientRect(),s=getComputedStyle(p);return{y:r.y,bottom:r.bottom,h:r.height,scroll:p.scrollHeight,client:p.clientHeight,overflow:s.overflowY,gutter:s.scrollbarGutter,docOverflow:document.documentElement.scrollWidth>innerWidth+1}})()`);
   assert.equal(geometry.docOverflow,false,JSON.stringify({layout,scale,width,tool,geometry}));
   assert.ok(geometry.bottom<=height+1&&geometry.y>=0,JSON.stringify({layout,scale,width,tool,geometry}));
   assert.ok(geometry.scroll>geometry.client&&geometry.client>100,tool+': bounded long content');
   assert.match(geometry.overflow,/auto|scroll/);
   await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:width-30,y:Math.min(height-40,geometry.bottom-20)});
   await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:width-30,y:Math.min(height-40,geometry.bottom-20),deltaX:0,deltaY:3000});
   await wait(`document.querySelector('${selector}').scrollTop>0`);
   await ev(`document.querySelector('${selector}').scrollTop=100000`);
   const reached=await ev(`(()=>{const b=document.querySelector('#plugin-end'),r=b.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{hit:hit===b||b.contains(hit),bottom:r.bottom}})()`);
   assert.ok(reached.hit&&reached.bottom<=height,tool+': final button visible and hit-testable');
   await ev(`document.querySelector('.scroll-regression-tail').remove()`);
   report.push({layout,scale,width,height,tool,...geometry});
   if(tool==='convert'&&layout==='studio'&&scale===110&&width===1120){
    await ev(`document.querySelector('.converter-page').scrollTop=0`);await ev(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
    const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(artifacts+'/converter.png',Buffer.from(shot.data,'base64'));
    await ev(`document.querySelector('.tool-actions .primary').click()`);await wait(`document.querySelectorAll('.converter-result-list article.done').length===24`);
    assert.ok((await ev('nativeCalls')).every(c=>c.settings.format==='image/jpeg'));
   }
  }
 }
 assert.deepEqual(await ev('errors'),[]);
 writeFileSync(artifacts+'/report.json',JSON.stringify({status:'passed',cases:report},null,2));
 console.log('PASS '+report.length+' production desktop plugin scroll cases: cover editor and five plugins, both layouts,110/150%,540/700/900px; real wheel input, bottom hit targets, populated converter, format selection and conversion callbacks');
});
