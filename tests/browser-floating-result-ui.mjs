import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
const origin = process.env.ORIGIN || 'http://localhost:1542';
const cdp = process.env.CDP || '9443';
const version = await fetch(`http://127.0.0.1:${cdp}/json/version`).then(r => r.json());
const connect = async url => {
 const ws = new WebSocket(url); await new Promise(r => ws.onopen = r);
 let seq=0; const jobs=new Map();
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(jobs.has(m.id)){jobs.get(m.id)(m);jobs.delete(m.id);}};
 return {ws,send:(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;jobs.set(id,m=>m.error?reject(Error(JSON.stringify(m.error))):resolve(m.result));ws.send(JSON.stringify({id,method,params}));})};
};
const browser=await connect(version.webSocketDebuggerUrl);
const {browserContextId}=await browser.send('Target.createBrowserContext');
const {targetId}=await browser.send('Target.createTarget',{url:'about:blank',browserContextId});
const target=await fetch(`http://127.0.0.1:${cdp}/json/list`).then(r=>r.json()).then(ts=>ts.find(t=>t.id===targetId));
const {ws,send}=await connect(target.webSocketDebuggerUrl);
const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value;};
const wait=async expression=>{for(let i=0;i<150;i++){if(await ev(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error(`Timed out: ${expression}`);};
const move=async (x,y)=>{await send('Page.bringToFront');await send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});};
const click=async label=>{const p=await ev(`(()=>{const e=document.querySelector('.browser-floating-result [aria-label='+JSON.stringify(${JSON.stringify(label)})+']');if(!e)throw Error('Missing '+${JSON.stringify(label)});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await move(p.x,p.y);await send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});};
const add=async(name,color)=>ev(`(async()=>{const c=document.createElement('canvas');c.width=800;c.height=500;const x=c.getContext('2d');x.fillStyle=${JSON.stringify(color==='pattern'?'#20304a':color)};x.fillRect(0,0,800,500);${color==='pattern'?"for(let p=0;p<800;p+=24){x.fillStyle='#f3df8c';x.fillRect(p,0,12,500);}":''}const blob=await new Promise(r=>c.toBlob(r,'image/png'));const d=new DataTransfer();d.items.add(new File([blob],${JSON.stringify(name)},{type:'image/png'}));const i=document.querySelector('input[type=file][multiple]:not([webkitdirectory])');i.files=d.files;i.dispatchEvent(new Event('change',{bubbles:true}));})()`);
const seed=async(style,theme)=>{
 await move(0,0);
 await ev(`(()=>{const p={floatingResultSeconds:0,language:'en',floatingStyle:${JSON.stringify(style)},theme:${JSON.stringify(theme)},dockTheme:${JSON.stringify(theme)},interfaceFontScale:150,colorTheme:'graphite'};localStorage.setItem('piclite.desktopPreferences.v1',JSON.stringify(p));localStorage.setItem('piclite.desktop.clop-settings.v1',JSON.stringify({...p,floatingAutoHideSeconds:0}));location.reload()})()`);
 await wait(`!!document.querySelector('.app-shell')&&document.documentElement.lang==='en'&&document.documentElement.dataset.theme===${JSON.stringify(theme)}`);
};
const view=()=>ev(`(()=>{const e=document.querySelector('.browser-floating-result'),a=e.querySelector('.browser-floating-actions'),b=a.querySelector('button'),r=e.getBoundingClientRect(),s=getComputedStyle(e),f=getComputedStyle(e,'::before');return{id:e.dataset.resultId,tone:e.dataset.tone,width:r.width,height:r.height,ink:s.color,paper:s.backgroundColor,fit:getComputedStyle(e.querySelector('img')).objectFit,columns:getComputedStyle(a).gridTemplateColumns.split(' ').length,opacity:getComputedStyle(a).opacity,metricsOpacity:getComputedStyle(e.querySelector('.browser-floating-metrics')).opacity,metricsSize:getComputedStyle(e.querySelector('.browser-floating-metrics')).fontSize,buttonInk:getComputedStyle(b).color,buttonFill:getComputedStyle(b).backgroundColor,frost:{opacity:f.opacity,blur:f.backdropFilter,inset:[f.top,f.right,f.bottom,f.left]},buttons:[...a.querySelectorAll('button')].map(b=>{const r=b.getBoundingClientRect(),i=b.querySelector('svg'),ir=i?.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{x:r.x,y:r.y,w:r.width,h:r.height,icon:ir&&{w:ir.width,h:ir.height,dx:ir.x+ir.width/2-r.x-r.width/2,dy:ir.y+ir.height/2-r.y-r.height/2},hit:b===hit||b.contains(hit)}}),metrics:[...e.querySelectorAll('.browser-floating-metrics span,.browser-floating-metrics strong,.browser-floating-metrics small')].map(n=>getComputedStyle(n).color)}})()`);
const rgb=color=>color.match(/[\d.]+/g).slice(0,3).map(Number);
const luminance=color=>rgb(color).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
const artifacts=process.env.ARTIFACTS;
const capture=async name=>{if(!artifacts)return;mkdirSync(artifacts,{recursive:true});const r=await ev(`(()=>{const r=document.querySelector('.browser-floating-result').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()`);const {data}=await send('Page.captureScreenshot',{format:'png',clip:r});writeFileSync(`${artifacts}/${name}.png`,Buffer.from(data,'base64'));};
const results=[];
try {
 await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});
 await send('Emulation.setDeviceMetricsOverride',{width:1100,height:800,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:origin});await wait(`!!document.querySelector('.app-shell')`);
 for(const style of ['immersive','classic'])for(const theme of ['light','dark'])for(const [tone,color] of [['light','#fafafa'],['dark','#080808']]){
  await seed(style,theme);await add(`${style}-${theme}-${tone}.png`,color);
  await wait(`document.querySelector('.browser-floating-result')?.dataset.tone===${JSON.stringify(tone)}`);
  await wait(`getComputedStyle(document.querySelector('.browser-floating-actions')).opacity==='0'`);
  const idle=await view();assert.equal(idle.buttons.length,6);assert.equal(idle.columns,3,'Six actions always use three columns');assert.equal(idle.fit,style==='classic'?'contain':'cover');assert.equal(idle.metricsOpacity,'1');assert.equal(idle.frost.opacity,'0');assert.equal(idle.metricsSize,'14px','Floating typography ignores main scale');
  await capture(`${style}-${theme}-${tone}-idle`);
  const rect=await ev(`(()=>{const r=document.querySelector('.browser-floating-result').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await move(rect.x,rect.y);await wait(`getComputedStyle(document.querySelector('.browser-floating-actions')).opacity==='1'&&getComputedStyle(document.querySelector('.browser-floating-result'),'::before').opacity==='1'`);
  const hover=await view();assert.equal(hover.metricsOpacity,'0');assert.equal(hover.columns,3);assert.ok(hover.frost.blur.includes('blur('));assert.deepEqual(hover.frost.inset,['0px','0px','0px','0px']);assert.ok(contrast(hover.buttonInk,hover.buttonFill)>=7,'Dark glyphs contrast with light filled buttons');
  hover.buttons.forEach((b,i)=>{assert.equal(b.w,68);assert.equal(b.h,68);assert.ok(b.icon,'Real vector icon');assert.equal(b.icon.w,20);assert.equal(b.icon.h,20);assert.ok(Math.abs(b.icon.dx)<.6&&Math.abs(b.icon.dy)<.6);assert.equal(b.hit,true);if(i%3)assert.equal(b.x-hover.buttons[i-1].x,84);if(i>=3)assert.equal(b.y-hover.buttons[i-3].y,84);});
  await capture(`${style}-${theme}-${tone}-hover`);
  if(style==='classic'){assert.ok(contrast(idle.ink,idle.paper)>=4.5);idle.metrics.forEach(c=>assert.ok(contrast(c,idle.paper)>=4.5,`Classic metric ${c} readable on ${idle.paper}`));}
  await click('More actions');await wait(`!!document.querySelector('.browser-floating-menu')`);
  const menu=await ev(`(()=>{const e=document.querySelector('.browser-floating-menu'),s=getComputedStyle(e);return{color:s.color,fill:s.backgroundColor,items:[...e.querySelectorAll('button')].map(b=>getComputedStyle(b).color)}})()`);assert.ok(contrast(menu.color,menu.fill)>=4.5);menu.items.forEach(c=>assert.ok(contrast(c,menu.fill)>=4.5));
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await wait(`!document.querySelector('.browser-floating-menu')`);
  await move(0,0);await ev(`document.querySelector('.browser-floating-actions button').focus()`);await wait(`getComputedStyle(document.querySelector('.browser-floating-actions')).opacity==='1'&&getComputedStyle(document.querySelector('.browser-floating-result'),'::before').opacity==='1'`);
  await ev(`document.activeElement.blur()`);await wait(`getComputedStyle(document.querySelector('.browser-floating-actions')).opacity==='0'`);
  await send('Emulation.setDeviceMetricsOverride',{width:820,height:540,deviceScaleFactor:1,mobile:false});assert.equal((await view()).columns,3,'Short viewport retains two rows');
  await send('Emulation.setDeviceMetricsOverride',{width:1100,height:800,deviceScaleFactor:1,mobile:false});
  results.push({style,theme,tone,button:[hover.buttons[0].w,hover.buttons[0].h],menuContrast:contrast(menu.color,menu.fill)});
 }
 if(artifacts){await seed('immersive','light');await add('frost-pattern.png','pattern');await wait(`!!document.querySelector('.browser-floating-result')`);await capture('frost-pattern-idle');const r=await ev(`(()=>{const r=document.querySelector('.browser-floating-result').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await move(r.x,r.y);await wait(`getComputedStyle(document.querySelector('.browser-floating-result'),'::before').opacity==='1'`);await capture('frost-pattern-hover');}
 await seed('immersive','light');await add('light.png','#fafafa');await wait(`document.querySelector('.browser-floating-result')?.dataset.tone==='light'`);const light=await view();
 await click('Dismiss floating result');await add('dark.png','#080808');await wait(`document.body.innerText.includes('dark.png')`);await ev(`document.querySelector('button.compress-button').click()`);await wait(`document.querySelector('.browser-floating-result')?.dataset.tone==='dark'&&document.querySelector('.browser-floating-result')?.dataset.resultId!==${JSON.stringify(light.id)}`);
 assert.equal(await ev(`document.querySelectorAll('.browser-floating-result').length`),1);
 await browser.send('Browser.grantPermissions',{origin,browserContextId,permissions:['clipboardReadWrite','clipboardSanitizedWrite']});
 await click('Copy image');await wait(`document.body.innerText.includes('Result copied and ready to paste')`);assert.ok(await ev(`(async()=>{const items=await navigator.clipboard.read();return items.some(item=>item.types.includes('image/png'))})()`));
 const dir=`/Users/amiao/.hermes/cache/scratch/piclite-web-floating-downloads-${Date.now()}`;mkdirSync(dir,{recursive:true});await send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:dir});await click('Save image');
 for(let i=0;i<100&&!readdirSync(dir).some(n=>n.startsWith('dark-piclite.')&&!n.endsWith('.crdownload'));i++)await new Promise(r=>setTimeout(r,100));
 const file=readdirSync(dir).find(n=>n.startsWith('dark-piclite.')&&!n.endsWith('.crdownload'));assert.ok(file);assert.ok(readFileSync(`${dir}/${file}`).length>0);
 await click('Next result');await wait(`document.querySelector('.browser-floating-result')?.dataset.resultId===${JSON.stringify(light.id)}`);
 await click('Optimise again');await wait(`document.querySelector('.browser-floating-result')?.dataset.resultId===${JSON.stringify(light.id)}&&!document.querySelector('.browser-floating-actions button').disabled`);
 await click('Compare');await wait(`!document.querySelector('.browser-floating-result')&&!!document.querySelector('.compare-canvas')`);
 await ev(`document.querySelector('button.compress-button').click()`);await wait(`!!document.querySelector('.browser-floating-result')`);await click('Floating settings');await wait(`!!document.querySelector('[role=switch][aria-label="New floating window"]')`);
 await ev(`document.querySelector('[role=switch][aria-label="New floating window"]').click()`);await wait(`JSON.parse(localStorage.getItem('piclite.desktopPreferences.v1')).floatingStyle==='classic'`);assert.equal(await ev(`JSON.parse(localStorage.getItem('piclite.desktop.clop-settings.v1')).floatingStyle`),'classic');
 console.log('PASS production browser: 8 style/theme/image-tone combinations, 68px 3×2 actions/16px gaps/20px SVGs, hover+keyboard full frost, classic text/menu contrast, fixed typography, compact layout, real import/compress/copy/download/next/reprocess/compare/settings.',JSON.stringify({results,download:file}));
} catch(error){console.error(await ev(`({url:location.href,body:document.body.innerText.slice(-600),floating:document.querySelector('.browser-floating-result')?.outerHTML.slice(0,400),hover:[...document.querySelectorAll(':hover')].map(e=>e.className),hit:document.elementFromPoint(innerWidth-210,innerHeight-183)?.outerHTML.slice(0,300)})`));console.error(await view());throw error;}
finally{ws.close();await browser.send('Target.disposeBrowserContext',{browserContextId});browser.ws.close();}
