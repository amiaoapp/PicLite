// Exercise the actual browser/Docker product at phone, desktop and wide sizes.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { floatingBrowser } from './helpers/floating-test-browser.mjs';
const origin = process.env.ORIGIN || 'http://127.0.0.1:1551';
const artifacts = process.env.ARTIFACTS || '/tmp/piclite-responsive';
mkdirSync(artifacts,{recursive:true});
await floatingBrowser(async ({send,evaluate:ev,wait})=>{
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.clear();localStorage.setItem('piclite.desktopPreferences.v1',JSON.stringify({language:'en',theme:'light',interfaceFontScale:110}));`});
 await send('Page.navigate',{url:origin});
 await wait('!!document.querySelector(".web-app") && document.querySelector(".settings-entry-button")?.title==="Open settings"');
 for (const layout of ['classic','studio']) {
  await ev(`localStorage.setItem('piclite.interfaceStyle.v1','${layout}');dispatchEvent(new Event('piclite:interface-style'))`);
  await wait(`!!document.querySelector('.${layout}-shell')`);
  for(const [width,height] of [[390,844],[768,1024],[1440,900],[2560,1440]]) {
   await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
   await ev(`document.querySelector('.settings-entry-button').click()`);
   await wait('!!document.querySelector(".clop-preferences")');
   const geometry=await ev(`(()=>{const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,w:r.width,h:r.height}};const page=document.querySelector('.clop-preferences'),nav=page.querySelector('aside'),content=page.querySelector('.clop-preferences-content');return {page:rect(page),nav:rect(nav),content:rect(content),navButtons:[...nav.querySelectorAll('button')].map(rect),overflow:document.documentElement.scrollWidth>innerWidth+1,contentOverflow:content.scrollWidth>content.clientWidth+1,oldStyleSwitch:[...page.querySelectorAll('button')].some(b=>/New floating window|新版悬浮窗/.test(b.getAttribute('aria-label')||''))}})()`);
   assert.equal(geometry.overflow,false,JSON.stringify({layout,width,geometry}));
   assert.equal(geometry.contentOverflow,false,JSON.stringify({layout,width,geometry}));
   assert.equal(geometry.oldStyleSwitch,false);
   assert.ok(geometry.content.w>Math.min(width*.65,500));
   if(width<=720) {assert.ok(geometry.nav.h<85);assert.ok(geometry.content.y>=geometry.nav.bottom-1);assert.ok(geometry.navButtons.every(b=>b.h>=38));}
   else {assert.ok(geometry.content.x>=geometry.nav.right-1);assert.ok(geometry.nav.w<230);}
   assert.ok(geometry.content.bottom<=height+1);
   const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(`${artifacts}/${layout}-${width}.png`,Buffer.from(shot.data,'base64'));
   await ev(`document.querySelector('.preferences-sidebar nav button:last-child').click()`);
   await wait('!!document.querySelector(".about-product")');
   await ev(`document.querySelector('.preferences-sidebar nav button:first-child').click()`);
   await wait('!!document.querySelector(".interface-typography-controls")');
   await ev(`document.querySelector('.main-nav button').click()`);
   await wait('!!document.querySelector(".workspace")');
   const workspace=await ev(`(()=>{const p=document.querySelector('.preview-panel').getBoundingClientRect();return{overflow:document.documentElement.scrollWidth>innerWidth+1,w:p.width,h:p.height,body:document.body.clientWidth}})()`);
   assert.equal(workspace.overflow,false,JSON.stringify({layout,width,workspace}));
   assert.ok(workspace.w>=Math.min(width-40,300)&&workspace.h>150,JSON.stringify({layout,width,workspace}));
   console.log(`PASS ${layout} browser preferences, category changes and workspace ${width}x${height}`);
  }
 }
 // Save through the real editor; the floating action must reuse these values.
 await ev(`document.querySelectorAll('.main-nav button')[1].click()`);
 await wait('!!document.querySelector("iframe")?.contentWindow?.picLiteCover');
 await ev(`(()=>{const d=document.querySelector('iframe').contentDocument;for(const [id,value] of Object.entries({canvasW:'640',canvasH:'360',bgColor:'#1555aa',innerSize:'200',textContent:'Quick cover',format:'image/webp',qualityNum:'77'})){const el=d.getElementById(id);el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));}d.getElementById('canvasW').dispatchEvent(new Event('change',{bubbles:true}));})()`);
 const preset=await ev(`JSON.parse(localStorage.getItem('piclite.cover-preset.v1'))`);
 assert.equal(preset.ui.canvasW,'640');assert.equal(preset.ui.canvasH,'360');assert.equal(preset.ui.qualityNum,'77');assert.equal(preset.images.main,undefined);
 await ev(`document.querySelector('.main-nav button').click();document.querySelectorAll('.main-nav button')[1].click()`);
 await wait(`document.querySelector('iframe')?.contentDocument?.getElementById('canvasW')?.value==='640'`);
 console.log('PASS cover preset auto-save, restore and foreground photo exclusion');
});
