// Production floating entry. Empty state must fill the window in both result
// modes, with its real controls reachable at the bottom at every supported size.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {floatingBrowser} from './helpers/floating-test-browser.mjs';
const origin=process.env.ORIGIN||'http://127.0.0.1:1551';
const artifacts=process.env.ARTIFACTS||'/tmp/piclite-floating-empty';
mkdirSync(artifacts,{recursive:true});
await floatingBrowser(async({send,evaluate:ev,wait,click})=>{
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`
  localStorage.clear();localStorage.setItem('piclite.desktopPreferences.v1',JSON.stringify({language:'zh',theme:'light'}));
  localStorage.setItem('piclite.desktop.clop-settings.v1',JSON.stringify({autoHideResults:false,updateCheckFrequency:'never'}));
  let api;window.calls=[];
  Object.defineProperty(window,'picLite',{configurable:true,get(){return api},set(value){api={...value,windowLabel:'dropzone',getFloatingCollapsed:async()=>false,takePendingClipboard:async()=>null,onWatcherEvent:()=>()=>{},onTrayAction:()=>()=>{},loadImportedFonts:async()=>[],configureFloatingBehavior:async()=>{},configureDropzoneWindow:async()=>{},setFloatingToggleRegion:async()=>{},showMainWindow:async()=>calls.push('workbench'),selectImageEntries:async()=>{calls.push('choose');return[]},hideCurrentWindow:async()=>calls.push('hide')}}});
 `});
 await send('Page.navigate',{url:origin+'/?window=dropzone'});
 await wait(`!!document.querySelector('.floating-empty-footer')`);
 const report=[];
 for(const mode of ['stack','list'])for(const theme of ['light','dark'])for(const language of ['zh','en'])for(const [width,height] of [[246,188],[280,220],[320,230],[392,300],[556,436]]){
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:2,mobile:false});
  await ev(`(()=>{localStorage.setItem('piclite.desktopPreferences.v1',JSON.stringify({language:'${language}',theme:'${theme}'}));const key='piclite.desktop.clop-settings.v1';localStorage.setItem(key,JSON.stringify({...JSON.parse(localStorage.getItem(key)),floatingDisplayMode:'${mode}',language:'${language}',appearance:'${theme}'}));dispatchEvent(new StorageEvent('storage',{key}));})()`);
  await wait(`document.querySelector('main').classList.contains('display-${mode}')&&document.documentElement.dataset.theme==='${theme}'`);
  await ev('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const geometry=await ev(`(()=>{const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,bottom:r.bottom,right:r.right}};const f=document.querySelector('.floating-empty-footer'),hint=f.querySelector('span');return{footer:rect(f),hint:{...rect(hint),scroll:hint.scrollWidth,client:hint.clientWidth},drop:rect(document.querySelector('.drop-surface')),buttons:[...f.querySelectorAll('button')].map(b=>{const r=rect(b);return{...r,hit:document.elementFromPoint(r.x+r.w/2,r.y+r.h/2)?.closest('button')===b}}),scroll:document.documentElement.scrollHeight}})()`);
  const label=JSON.stringify({mode,theme,language,width,height,geometry});
  assert.equal(geometry.buttons.length,5,label);
  assert.ok(Math.abs(height-geometry.footer.bottom-16)<2,label);
  assert.ok(geometry.drop.bottom<=geometry.footer.y+1&&geometry.drop.h>60,label);
  assert.ok(geometry.hint.scroll<=geometry.hint.client+1,label);
  assert.ok(geometry.scroll<=height,label);
  for(const b of geometry.buttons)assert.ok(b.hit&&b.w>=18&&b.x>=0&&b.right<=width&&b.bottom<=height-12,label);
  report.push({mode,theme,language,width,height,...geometry});
  if(mode==='list'&&theme==='light'&&language==='zh'&&width===392){
   const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(artifacts+'/empty-bottom-toolbar.png',Buffer.from(shot.data,'base64'));
   await click('.floating-empty-footer button[title="打开工作台"]');
   assert.ok((await ev('calls')).includes('workbench'));
  }
 }
 writeFileSync(artifacts+'/report.json',JSON.stringify({status:'passed',cases:report},null,2));
 console.log('PASS '+report.length+' empty floating layouts: bottom toolbar, readable drag hint, five hit targets, both list modes/themes/languages, 246–556px');
});
