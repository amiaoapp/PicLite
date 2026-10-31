import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import sharp from 'sharp';
const port=process.env.PICLITE_CDP_PORT||9442,origin=process.env.PICLITE_TEST_ORIGIN||'http://127.0.0.1:1432';
const targets=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());
const ws=new WebSocket(targets.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
let sequence=0;const pending=new Map();
ws.addEventListener('message',({data})=>{const m=JSON.parse(data);if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}});
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
const pause=()=>new Promise(r=>setTimeout(r,130));
const click=async selector=>{await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await pause();};
const dir='/Users/amiao/.hermes/cache/scratch/piclite-ui-v6';mkdirSync(dir,{recursive:true});
try{
 await send('Emulation.setDeviceMetricsOverride',{width:900,height:760,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:origin});
 for(let i=0;i<60;i++){try{if(await evaluate('!!document.querySelector(".topbar")'))break;}catch{}await pause();}
 await evaluate(`(async()=>{
  document.querySelectorAll('style[data-vite-dev-id]').forEach(s=>s.remove());await import('/clop-desktop.css');
  const text=await fetch('/floating-result-editor.tsx').then(r=>r.text()),reactUrl=text.split('"').find(s=>s.includes('deps/react.js'));
  const React=(await import(reactUrl)).default;
  const renderer=await fetch('/renderer.tsx').then(r=>r.text()),clientUrl=renderer.split('"').find(s=>s.includes('deps/react-dom_client.js'));
  const {createRoot}=(await import(clientUrl)).default;
  const {ResultCard}=await import('/clop-desktop-app.tsx');
  const {DEFAULT_SETTINGS}=await import('/clop-store.ts');
  document.body.innerHTML='<div id="fixture" style="width:380px;height:330px"></div>';window.calls=[];window.cancelCrop=false;
  const api={openCropEditor:async path=>{calls.push({kind:'openCrop',path});return window.cancelCrop?null:'/cropped.png'},copyImagePath:async()=>calls.push({kind:'copy'}),selectFolder:async()=>'/exports',saveFloatingResult:async()=>'/exports/saved.png',startDragging:async()=>calls.push({kind:'drag'}),revealPath:async()=>{},openImage:async()=>{}};
  const root=createRoot(document.getElementById('fixture'));
  window.renderCard=(w,h,iw,ih,theme='light',radius=10)=>{
   const c=document.createElement('canvas');c.width=iw;c.height=ih;const ctx=c.getContext('2d');ctx.fillStyle='#929ba3';ctx.fillRect(0,0,iw,ih);
   const hw=iw/2,hh=ih/2;ctx.fillStyle='#ff0000';ctx.fillRect(0,0,hw,hh);ctx.fillStyle='#00ff00';ctx.fillRect(hw,0,hw,hh);ctx.fillStyle='#0000ff';ctx.fillRect(0,hh,hw,hh);ctx.fillStyle='#ffff00';ctx.fillRect(hw,hh,hw,hh);
   document.documentElement.dataset.theme=theme;document.getElementById('fixture').style.cssText='width:'+w+'px;height:'+h+'px';
   root.render(React.createElement('main',{className:'floating-results'},React.createElement('div',{className:'floating-list stack'},React.createElement('div',{className:'floating-result-slot'},React.createElement(ResultCard,{
    item:{id:'fixture',source:'/source.png',output:'/source.png',preview:c.toDataURL(),width:iw,height:ih,status:'done',originalBytes:51000,outputBytes:10000,history:[{}]},api,settings:{...DEFAULT_SETTINGS,language:'zh',floatingLayout:'compact',floatingCornerRadius:radius},active:true,allowWindowDrag:true,
    remove:()=>{},select:()=>{},downscale:()=>calls.push({kind:'half'}),undo:()=>calls.push({kind:'undo'}),watermark:()=>{},upload:()=>calls.push({kind:'upload'}),updateFormat:f=>calls.push({kind:'format',format:f}),process:async(settings,source)=>calls.push({kind:'process',settings,source}),notify:()=>{}
   }))),React.createElement('footer',{className:'floating-footer'},'PicLite')));
  };
  renderCard(380,330,922,454);
 })()`);await pause();
 for(const [w,h,iw,ih] of [[380,330,922,454],[246,188,554,396],[280,220,454,922],[460,300,1800,300],[320,230,300,1800]]){
  await evaluate(`renderCard(${w},${h},${iw},${ih})`);await pause();
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:800,y:700});await pause();
  const g=await evaluate(`(()=>{const r=e=>{const b=e.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height,right:b.right,bottom:b.bottom}};const image=document.querySelector('.floating-image-slot img'),slot=document.querySelector('.floating-image-slot'),card=document.querySelector('.result-card'),formats=document.querySelector('.format-bar');return {image:r(image),slot:r(slot),card:r(card),formats:r(formats),fileRow:!!document.querySelector('.floating-card-file'),font:getComputedStyle(formats.querySelector('button')).fontSize,weight:getComputedStyle(formats.querySelector('button')).fontWeight,columns:getComputedStyle(document.querySelector('.result-actions')).gridTemplateColumns.split(' ').length}})()`);
  assert.equal(g.fileRow,false);assert.equal(g.columns,3);assert.ok(parseFloat(g.font)<=10);assert.ok(Number(g.weight)<=500);
  assert.ok(g.image.width>0&&g.image.height>0);assert.ok(Math.abs(g.image.width/g.image.height-iw/ih)<.002);
  assert.ok(g.image.x<=g.slot.x+1&&g.image.y<=g.slot.y+1&&g.image.right>=g.slot.right-1&&g.image.bottom>=g.slot.bottom-1,'cover image must extend beneath the whole preview slot');assert.ok(g.formats.bottom<=g.card.bottom+1);
  await evaluate(`document.querySelector('.floating-card-header').style.visibility='hidden';document.querySelector('.floating-card-bottom').style.visibility='hidden';document.querySelector('.result-overlay').style.visibility='hidden'`);
  const shot=await send('Page.captureScreenshot',{format:'png'}),png=Buffer.from(shot.data,'base64');writeFileSync(`${dir}/fit-${w}-${h}-${iw}-${ih}.png`,png);
  const {data,info}=await sharp(png).raw().toBuffer({resolveWithObject:true});
    const sample=(x,y)=>{const i=(Math.round(y)*info.width+Math.round(x))*info.channels;return [...data.subarray(i,i+3)]};
    const insetX=Math.max(4,g.slot.width*.04),insetY=Math.max(4,g.slot.height*.04);
    for(const [name,x,y,color] of [['top-left',g.slot.x+insetX,g.slot.y+insetY,[255,0,0]],['top-right',g.slot.right-insetX,g.slot.y+insetY,[0,255,0]],['bottom-left',g.slot.x+insetX,g.slot.bottom-insetY,[0,0,255]],['bottom-right',g.slot.right-insetX,g.slot.bottom-insetY,[255,255,0]]]){
   const rgb=sample(x,y);assert.ok(rgb.every((v,i)=>Math.abs(v-color[i])<20),`actual painted ${name} missing at ${w}×${h}: ${rgb}`);
  }
  await evaluate(`document.querySelector('.floating-card-header').style.visibility='';document.querySelector('.floating-card-bottom').style.visibility='';document.querySelector('.result-overlay').style.visibility=''`);
  console.log(`PASS ${w}×${h}: ${iw}×${ih} all four preview corners filled by the cover image, 3-column action grid, small regular-weight formats, no filename`);
 }
 await evaluate('renderCard(380,330,922,454)');await pause();
 const sizes=[];
 for(const [w,h] of [[246,188],[380,330],[700,560]]){await evaluate(`renderCard(${w},${h},922,454)`);await pause();sizes.push(await evaluate('document.querySelector(".result-actions button").getBoundingClientRect().width'));}
 assert.ok(sizes[1]>sizes[0]&&sizes[2]>sizes[1]*1.3,JSON.stringify(sizes));
 await evaluate('renderCard(380,330,922,454)');await pause();
 const occupancy=await evaluate(`(()=>{const i=document.querySelector('.floating-image-slot img').getBoundingClientRect(),b=document.querySelector('.floating-card-body').getBoundingClientRect();return{w:i.width/b.width,h:i.height/b.height}})()`);assert.ok(occupancy.w>.99&&occupancy.h>.99,'image must cover both axes');
 const alignment=await evaluate(`(()=>{const result=[...document.querySelectorAll('.result-actions button')].map(b=>{const r=b.getBoundingClientRect(),i=b.querySelector('svg').getBoundingClientRect();return {dx:Math.abs((r.left+r.right-i.left-i.right)/2),dy:Math.abs((r.top+r.bottom-i.top-i.bottom)/2),icon:i.width}});return result})()`);
 for(const x of alignment){assert.ok(x.dx<.6&&x.dy<.6,JSON.stringify(x));assert.ok(x.icon>=19);}
 for(const radius of [0,10,24]){await evaluate(`document.documentElement.classList.add('dropzone-root');document.documentElement.style.setProperty('--floating-radius','${radius}px');renderCard(380,330,922,454,'light',${radius})`);await pause();assert.equal(await evaluate('getComputedStyle(document.querySelector(".result-card")).borderTopLeftRadius'),radius+'px');assert.equal(await evaluate('getComputedStyle(document.documentElement).borderTopLeftRadius'),radius+'px');assert.equal(await evaluate('getComputedStyle(document.querySelector(".floating-results")).borderTopLeftRadius'),radius+'px');}
 const surfaces=await evaluate(`['.result-overlay','.floating-card-bottom','.result-hover-actions','.result-preview'].map(s=>getComputedStyle(document.querySelector(s)).backgroundColor)`);
 assert.ok(surfaces.every(x=>x==='rgba(0, 0, 0, 0)'),JSON.stringify(surfaces));
 console.log('action sizes',sizes,'image occupancy',occupancy);
 console.log('PASS transparent result/format/image surfaces, 6 centred larger icons, 0/10/24px corners');
 const oldDrag=await evaluate('calls.filter(c=>c.kind==="drag").length');
 await evaluate(`document.querySelector('.result-preview').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0}))`);await pause();assert.equal(await evaluate('calls.filter(c=>c.kind==="drag").length'),oldDrag+1);
 const afterDrag=await evaluate('calls.filter(c=>c.kind==="drag").length');await evaluate(`document.querySelector('[data-action="copy"]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0}))`);await pause();assert.equal(await evaluate('calls.filter(c=>c.kind==="drag").length'),afterDrag,'controls must not drag');
 await click('[data-action="crop"]');assert.equal(await evaluate('!!document.querySelector(".floating-crop-stage")'),false,'crop must open separately');
 assert.equal(await evaluate('calls.filter(c=>c.kind==="openCrop").at(-1).path'),'/source.png');assert.equal(await evaluate('calls.filter(c=>c.kind==="process").at(-1).source'),'/cropped.png');
 const before=await evaluate('calls.filter(c=>c.kind==="process").length');await evaluate('window.cancelCrop=true');await click('[data-action="crop"]');assert.equal(await evaluate('calls.filter(c=>c.kind==="process").length'),before);
 await click('[data-action="quality"]');await evaluate(`(()=>{const i=document.querySelector('input[type=range]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'47');i.dispatchEvent(new Event('input',{bubbles:true}));})()`);await pause();
 await click('[data-format="webp"]');await click('[data-action="apply-edit"]');assert.equal(await evaluate('calls.filter(c=>c.kind==="process").at(-1).settings.quality'),47);
 const c=await evaluate(`(()=>{const r=document.querySelector('.result-card').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})()`);await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:c.x+c.width/2,y:c.y+c.height/2});await pause();
 const hover=await send('Page.captureScreenshot',{format:'png',clip:{...c,scale:2}});writeFileSync(`${dir}/floating-actions-v6.png`,Buffer.from(hover.data,'base64'));
 console.log('PASS separate crop launch, apply output pipeline, cancellation and quality changes');
}finally{ws.close();}
