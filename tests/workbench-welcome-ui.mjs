// Browser zoom reduces the CSS viewport. Exercise those effective dimensions
// together with PicLite's independent text scaling in the production renderer.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {floatingBrowser} from './helpers/floating-test-browser.mjs';
const origin=process.env.ORIGIN||'http://127.0.0.1:1552';
const artifacts=process.env.ARTIFACTS||'/tmp/piclite-welcome-layout';
mkdirSync(artifacts,{recursive:true});
await floatingBrowser(async({send,evaluate:ev,wait,click})=>{
 await send('Page.navigate',{url:origin});
 await wait(`!!document.querySelector('.app-shell.web-app .preview-stage')&&!!document.documentElement.dataset.density`);
 await ev(`localStorage.setItem('piclite.interfaceStyle.v1','studio');dispatchEvent(new Event('piclite:interface-style'));`);
 await wait(`!!document.querySelector('.studio-welcome')`);
 const report=[];
 for(const language of ['zh','en'])for(const scale of [100,150])for(const [screenWidth,screenHeight] of [[1386,792],[1920,1080],[1280,720]])for(const zoom of [1,1.25,1.5,2]){
  const width=Math.round(screenWidth/zoom),height=Math.round(screenHeight/zoom);
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:zoom,mobile:false});
  await ev(`(()=>{for(const key of ['piclite.desktopPreferences.v1','piclite.desktop.clop-settings.v1'])localStorage.setItem(key,JSON.stringify({...JSON.parse(localStorage.getItem(key)||'{}'),language:'${language}',interfaceFontScale:${scale}}));dispatchEvent(new Event('piclite:interface-typography'));dispatchEvent(new StorageEvent('storage',{key:'piclite.desktopPreferences.v1'}));})()`);
  await wait(`Number(getComputedStyle(document.documentElement).getPropertyValue('--interface-font-scale'))===${scale/100}`);
  await ev(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
  const geometry=await ev(`(()=>{const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,w:r.width,h:r.height}};const welcome=document.querySelector('.studio-welcome'),stage=document.querySelector('.preview-stage'),panel=document.querySelector('.preview-panel');return{stage:rect(stage),panel:rect(panel),welcome:{...rect(welcome),overflow:getComputedStyle(welcome).overflowY,scroll:welcome.scrollHeight,client:welcome.clientHeight},actions:[...welcome.querySelectorAll('.studio-import button')].map(b=>{const r=rect(b);return{...r,hit:document.elementFromPoint(r.x+r.w/2,r.y+r.h/2)?.closest('button')===b}}),settingsOverflow:getComputedStyle(document.querySelector('.settings-panel')).overflowY}})()`);
  const label=JSON.stringify({screenWidth,screenHeight,width,height,zoom,scale,language,geometry});
  assert.notEqual(geometry.welcome.overflow,'auto',label);assert.notEqual(geometry.welcome.overflow,'scroll',label);
  assert.ok(geometry.welcome.scroll<=geometry.welcome.client+1,label);
  assert.equal(geometry.actions.length,2,label);
  for(const action of geometry.actions){assert.ok(action.w>0&&action.h>0&&action.y>=geometry.stage.y-1&&action.bottom<=geometry.stage.bottom+1&&action.x>=geometry.stage.x-1&&action.right<=geometry.stage.right+1,label);}
  if(width>800){assert.ok(geometry.actions.every(a=>a.hit),label);assert.equal(geometry.settingsOverflow,'auto',label);}
  if(language==='zh'&&scale===150&&screenWidth===1386&&zoom===1){const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(artifacts+'/zoomed-workbench.png',Buffer.from(shot.data,'base64'));}
  report.push({screenWidth,screenHeight,width,height,zoom,scale,language,...geometry});
 }
 // On a phone the whole document may scroll, while the preview itself must not.
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:false});
 await ev(`document.querySelector('.studio-import button').scrollIntoView({block:'center'})`);
 await ev(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
 const phone=await ev(`(()=>{const w=document.querySelector('.studio-welcome');return{overflow:getComputedStyle(w).overflowY,scroll:w.scrollHeight,client:w.clientHeight}})()`);assert.equal(phone.overflow,'visible');assert.ok(phone.scroll<=phone.client+1,JSON.stringify(phone));
 await send('Emulation.setDeviceMetricsOverride',{width:1386,height:792,deviceScaleFactor:1,mobile:false});
 await ev(`scrollTo(0,0)`);await click('.studio-demo-link');await wait(`!!document.querySelector('.compare-canvas img')`);
 const image=await ev(`(()=>{const stage=document.querySelector('.preview-stage'),canvas=document.querySelector('.compare-canvas');return{overflow:getComputedStyle(stage).overflowY,stageHeight:stage.clientHeight,canvasHeight:canvas.getBoundingClientRect().height}})()`);
 assert.equal(image.overflow,'hidden');assert.ok(image.canvasHeight<=image.stageHeight+1,JSON.stringify(image));
 writeFileSync(artifacts+'/report.json',JSON.stringify({status:'passed',cases:report,phone,image},null,2));
 console.log('PASS 48 production welcome layouts: 100–200% browser zoom, 100/150% text, zh/en; no nested scrolling, visible import controls, settings scrolling preserved; phone and actual demo import');
});
