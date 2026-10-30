// Run against the desktop Vite server and a disposable Chrome CDP target.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const port = process.env.PICLITE_CDP_PORT || 9437;
const origin = process.env.PICLITE_TEST_ORIGIN || 'http://127.0.0.1:1427';
const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
const socket = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
await new Promise(resolve => socket.addEventListener('open', resolve, {once: true}));
let sequence = 0;
const pending = new Map();
socket.addEventListener('message', ({data}) => { const m = JSON.parse(data); if (pending.has(m.id)) { const {resolve, reject} = pending.get(m.id); pending.delete(m.id); m.error ? reject(m.error) : resolve(m.result); } });
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, {resolve, reject}); socket.send(JSON.stringify({id, method, params})); });
const evaluate = async expression => {const r = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true}); if(r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value;};
const settle = () => new Promise(r => setTimeout(r, 100));
const click = async selector => { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await settle(); };
const fits = async () => {
  const bounds = await evaluate(`(() => {
    const card = document.querySelector('.result-card'); const r = card.getBoundingClientRect();
    const outside = [...card.querySelectorAll('button,input,.floating-crop-stage')].filter(e => {
      const b=e.getBoundingClientRect(); return b.width && b.height && (b.left < r.left-1 || b.right > r.right+1 || b.top < r.top-1 || b.bottom > r.bottom+1);
    }).map(e=>e.outerHTML);
    return {outside, scroll:card.scrollWidth > card.clientWidth+1, nested:!!card.querySelector('button button,button input'), toolbars:card.querySelectorAll('.floating-editor-toolbar').length};
  })()`);
  assert.deepEqual(bounds, {outside:[],scroll:false,nested:false,toolbars:0});
};
try {
  await send('Page.navigate', {url: origin});
  for(let i=0; i<40; i++) {try {if(await evaluate('document.readyState === "complete"')) break;} catch {} await settle();}
  await evaluate(`(async () => {
    // The real floating document loads only clop-desktop + editor styles.
    // Remove main-workbench sheets from this test page before importing it.
    document.querySelectorAll('style[data-vite-dev-id]').forEach(s=>s.remove());
    await import('/clop-desktop.css');
    const moduleText = await fetch('/floating-result-editor.tsx').then(r => r.text());
    const reactUrl = moduleText.split('"').find(s => s.includes('deps/react.js'));
    const React = (await import(reactUrl)).default;
    const clientText = await fetch('/renderer.tsx').then(r => r.text());
    const clientUrl = clientText.split('"').find(s => s.includes('deps/react-dom_client.js'));
    const {createRoot} = (await import(clientUrl)).default;
    const {ResultCard, FloatingResults} = await import('/clop-desktop-app.tsx');
    if (!ResultCard) throw Error('Integrated ResultCard is not available for acceptance testing');
    const {DEFAULT_SETTINGS} = await import('/clop-store.ts');
    document.body.innerHTML = '<div id="test"></div>';
    const canvas = document.createElement('canvas'); canvas.width=200;canvas.height=100;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#349681';ctx.fillRect(0,0,100,100);ctx.fillStyle='#e6b15a';ctx.fillRect(100,0,100,100);
    window.calls=[];
    const api={
      editFloatingImage: async(path,edit)=>{calls.push({kind:'crop',path,edit});return '/edited.png';},
      copyImagePath: async path=>calls.push({kind:'copy',path}), selectFolder:async()=>'/exports',
      saveFloatingResult:async(path,folder)=>{calls.push({kind:'save',path,folder});return '/exports/result.png';},
      openImage:async path=>calls.push({kind:'preview',path}), revealPath:async path=>calls.push({kind:'reveal',path}),
      startDragging:async()=>calls.push({kind:'drag'})
    };
    const root=createRoot(document.getElementById('test'));
    window.renderCard=(width,layout,theme,language='en')=>{
      document.documentElement.dataset.theme=theme;
      document.getElementById('test').style.cssText='width:'+width+'px;height:410px';
      root.render(React.createElement('div',{className:'floating-results '+layout},React.createElement('div',{className:'floating-list stack'},React.createElement('div',{className:'floating-result-slot'},React.createElement(ResultCard,{
        key:width+layout+theme+language,
        item:{id:'test',source:'/source.png',output:'/source.png',preview:canvas.toDataURL(),width:200,height:100,status:'done',originalBytes:12000,outputBytes:8000,history:[{}]},
        api,settings:{...DEFAULT_SETTINGS,language,floatingLayout:layout,floatingActions:['downscale','undo','quality','copy','upload','save']},active:true,allowWindowDrag:true,
        select:()=>calls.push({kind:'select'}),remove:()=>calls.push({kind:'dismiss'}),downscale:()=>calls.push({kind:'downscale'}),
        watermark:()=>calls.push({kind:'watermark'}),upload:()=>calls.push({kind:'upload'}),undo:()=>calls.push({kind:'undo'}),
        updateFormat:format=>calls.push({kind:'format',format}),process:async(settings,source)=>calls.push({kind:'process',settings,source}),notify:()=>{}
      })))));
    };
    window.mountWindow=()=>{
      localStorage.setItem('piclite.desktop.clop-settings.v1',JSON.stringify({...DEFAULT_SETTINGS,language:'en',updateCheckFrequency:'never',autoHideResults:true,autoHideSeconds:1}));
      window.hideCalls=0;
      const noop=()=>()=>{};
      const windowApi=new Proxy({...api,
        getFloatingCollapsed:async()=>false,configureDropzoneWindow:async()=>{},configureFloatingBehavior:async()=>{},setContentProtected:async()=>{},
        loadImportedFonts:async()=>[],listSystemFonts:async()=>[],setFloatingToggleRegion:async()=>{},takePendingClipboard:async()=>null,
        onWindowResized:noop,onClipboardPaths:noop,onClipboardImage:noop,onTrayAction:noop,onFileDrop:noop,
        onWatcherEvent:callback=>{window.watchResult=callback;return ()=>{};},hideCurrentWindow:async()=>{window.hideCalls++;},
        readImagesFromPaths:async()=>[{path:'/source.png',type:'image/png',data:new Uint8Array(),width:200,height:100}]
      },{get:(target,key)=>target[key] || (async()=>{})});
      document.getElementById('test').style.cssText='width:320px;height:230px';
      root.render(React.createElement(FloatingResults,{api:windowApi}));
    };
    window.renderCard(320,'full','light');
  })()`);
  await settle();
  // Regressions from the user's small floating window: never turn the 2×3
  // action grid into a six-wide row, and never let intrinsic image sizing crop.
  for (const height of [188,220,230,280,410]) for (const layout of ['full','compact']) for (const theme of ['light','dark']) {
    await evaluate(`renderCard(320,'${layout}','${theme}');document.getElementById('test').style.height='${height}px'`);await settle();
    const v=await evaluate(`(()=>{const grid=document.querySelector('.result-actions'),image=document.querySelector('.result-preview>img'),stage=document.querySelector('.result-preview'),bar=document.querySelector('.format-bar'),card=document.querySelector('.result-card');const r=e=>{const b=e.getBoundingClientRect();return{x:b.x,y:b.y,right:b.right,bottom:b.bottom,w:b.width,h:b.height}};return {columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,image:r(image),stage:r(stage),bar:r(bar),card:r(card),fit:getComputedStyle(image).objectFit,buttonColor:getComputedStyle(bar.querySelector('button')).color,buttonBackground:getComputedStyle(bar).backgroundColor,grid:r(grid),buttons:[...grid.querySelectorAll('button')].map(r),buttonFont:parseFloat(getComputedStyle(bar.querySelector('button')).fontSize),opacity:getComputedStyle(bar.querySelector('button')).opacity};})()`);
    assert.equal(v.columns,3,'small floating actions must remain two rows of three');
    assert.equal(v.opacity,'1');assert.ok(v.buttonFont>=11);assert.equal(v.buttonColor,'rgb(241, 244, 246)');assert.equal(v.buttonBackground,'rgb(53, 59, 64)');assert.ok(v.grid.bottom<=v.bar.y,'action grid clipped by formats');assert.ok(v.buttons.every(b=>b.y>=v.stage.y&&b.bottom<=v.stage.bottom),'action buttons outside preview at '+height+' '+layout);
    assert.equal(v.fit,'contain');assert.ok(v.image.bottom<=v.stage.bottom+1&&v.image.right<=v.stage.right+1,'image box overflows preview and gets cut off');
    assert.ok(v.bar.bottom<=v.card.bottom+1&&v.bar.h>=28,'format bar is clipped');
  }
  const screenshot=async(name)=>{const r=await evaluate('(()=>{const r=document.querySelector(".result-card").getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})()');const shot=await send('Page.captureScreenshot',{format:'png',clip:{...r,scale:2}});writeFileSync('/Users/amiao/.hermes/cache/scratch/piclite-ui-v2/'+name+'.png',Buffer.from(shot.data,'base64'));};
  await screenshot('floating-result');
  await click('[data-action="quality"]');await screenshot('floating-quality');await click('.floating-editor-footer button:not(.primary)');
  await click('[data-action="crop"]');await screenshot('floating-crop');await click('.floating-editor-footer button:not(.primary)');
  assert.equal(await evaluate('!!document.querySelector(".result-card .floating-card-header + .floating-card-body")'),true,'one integrated card');
  for (const width of [320,380]) for (const layout of ['full','compact']) for (const theme of ['light','dark']) {
    await evaluate(`renderCard(${width},'${layout}','${theme}')`); await settle(); await fits();
    assert.equal(await evaluate('document.querySelectorAll(".result-card .format-bar").length'),1);
    await click('[data-action="crop"]'); await fits();
    assert.equal(await evaluate('document.querySelectorAll(".result-preview").length'),0,'crop replaces preview');
    assert.equal(await evaluate('document.querySelector(".floating-card-content").dataset.interacting'),'true');
    const rect=await evaluate('(()=>{const r=document.querySelector(".floating-crop-stage").getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()');
    await send('Input.dispatchMouseEvent',{type:'mousePressed',x:rect.x+rect.width*.25,y:rect.y+rect.height*.2,button:'left',clickCount:1});
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:rect.x+rect.width*.75,y:rect.y+rect.height*.8,button:'left',buttons:1});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:rect.x+rect.width*.75,y:rect.y+rect.height*.8,button:'left',clickCount:1});
    await click('[data-action="apply-edit"]');
    const calls=await evaluate('window.calls');const crop=calls.filter(c=>c.kind==='crop').at(-1);
    assert.deepEqual(crop,{kind:'crop',path:'/source.png',edit:{x:50,y:20,width:100,height:60,outputWidth:100,outputHeight:60}});
    assert.equal(calls.filter(c=>c.kind==='process').at(-1).source,'/edited.png');
    await click('[data-action="quality"]'); await fits();
    await evaluate(`(()=>{const e=document.querySelector('input[type=range]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'43');e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await click('.format-bar button[data-format="webp"]'); await click('[data-action="apply-edit"]');
    const process=await evaluate('calls.filter(c=>c.kind==="process").at(-1)');
    assert.equal(process.settings.quality,43);assert.equal(process.settings.format,'webp');assert.equal(process.source,undefined);
    await click('[data-action="copy"]');
    await click('[data-action="more"]'); await fits();
    await click('[data-action="save"]');
    await click('[data-action="more"]'); await click('[data-action="undo"]');
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await settle();
    await click('[data-action="more"]');await click('[data-action="preview"]'); await click('[data-action="more"]');await click('[data-action="reveal"]');
    await click('[data-action="more"]');
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await settle();
    assert.equal(await evaluate('!!document.querySelector(".floating-overflow-menu")'),false);
    await click('[data-action="dismiss"]');
    await fits();
  }
  await evaluate("renderCard(380,'full','light','zh')");await settle();await click('[data-action="crop"]');
  assert.equal(await evaluate('document.querySelectorAll("[data-crop-handle]").length'),4);
  await evaluate(`(()=>{const e=document.querySelector('.floating-crop-aspect select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'1');e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await settle();
  let sel=await evaluate(`(()=>{const s=document.querySelector('.floating-crop-selection'),r=s.getBoundingClientRect();return {width:r.width,height:r.height};})()`);assert.ok(Math.abs(sel.width-sel.height)<1,'square preset keeps crop square');
  const handle=await evaluate(`(()=>{const r=document.querySelector('.handle-se').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:handle.x,y:handle.y,button:'left',buttons:1,clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:handle.x-18,y:handle.y-18,button:'left',buttons:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:handle.x-18,y:handle.y-18,button:'left'});await settle();
  const resized=await evaluate(`(()=>{const r=document.querySelector('.floating-crop-selection').getBoundingClientRect();return{width:r.width,height:r.height}})()`);assert.ok(resized.width<sel.width,'corner drag resizes crop');assert.ok(Math.abs(resized.width-resized.height)<1);
  const beforeMove=await evaluate(`(()=>{const r=document.querySelector('.floating-crop-selection').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})()`);
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:beforeMove.x+beforeMove.width/2,y:beforeMove.y+beforeMove.height/2,button:'left',buttons:1,clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:beforeMove.x+beforeMove.width/2+12,y:beforeMove.y+beforeMove.height/2+5,button:'left',buttons:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:beforeMove.x+beforeMove.width/2+12,y:beforeMove.y+beforeMove.height/2+5,button:'left'});await settle();
  const moved=await evaluate(`(()=>{const r=document.querySelector('.floating-crop-selection').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})()`);assert.ok(moved.x>beforeMove.x,'selection can be moved');assert.equal(moved.width,beforeMove.width);
  await screenshot('floating-crop-v3');await click('[data-action="apply-edit"]');assert.ok((await evaluate('calls.filter(c=>c.kind==="crop").at(-1).edit.width'))<100);
  await evaluate("renderCard(380,'full','light')");await settle();
  const card=await evaluate(`(()=>{const r=document.querySelector('.result-card').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:card.x+card.width/2,y:card.y+card.height/2});await settle();
  await screenshot('floating-actions-v3');
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:650,y:450});await settle();await screenshot('floating-preview-v3');
  const calls=await evaluate('window.calls');
  for(const kind of ['copy','save','undo','preview','reveal','dismiss']) assert(calls.some(c=>c.kind===kind),kind);
  assert(!calls.some(c=>c.kind==='drag'),'controls never start window dragging');
  await evaluate("renderCard(320,'compact','dark','zh')");await settle();await fits();
  await click('[data-action="crop"]');await fits();
  await evaluate("renderCard(320,'compact','light','zh');document.getElementById('test').style.height='230px'");await settle();
  await click('[data-action="crop"]');
  assert.equal(await evaluate(`(()=>{const card=document.querySelector('.result-card').getBoundingClientRect(); const footer=document.querySelector('.floating-editor-footer').getBoundingClientRect();const formats=document.querySelector('.format-bar').getBoundingClientRect();const params=document.querySelector('.floating-editor-parameters');return footer.bottom<=card.bottom && formats.bottom<=card.bottom && params.scrollHeight>params.clientHeight && params.clientHeight>30})()`),true,'230px window keeps apply and format visible with inner parameter scrolling');
  await evaluate("renderCard(380,'full','light')");await settle();await click('[data-action="more"]');
  await click('[data-action="preview"]');
  assert.equal(await evaluate('!!document.querySelector(".floating-overflow-menu")'),false,'menu action closes its menu');
  await evaluate('mountWindow()');await settle();
  await evaluate("watchResult({type:'success',file:'/source.png',output:'/source.png',time:1,originalBytes:12000,outputBytes:8000})");await settle();
  for(const [width,height] of [[246,188],[280,220],[320,230],[380,330]]){
    await evaluate(`document.getElementById('test').style.cssText='width:${width}px;height:${height}px'`);await settle();
    const geometry=await evaluate(`(()=>{const body=document.querySelector('.floating-card-body').getBoundingClientRect(),card=document.querySelector('.result-card').getBoundingClientRect(),bar=document.querySelector('.format-bar').getBoundingClientRect();return{columns:getComputedStyle(document.querySelector('.result-actions')).gridTemplateColumns.split(' ').length,buttonsFit:[...document.querySelectorAll('.result-actions button')].every(e=>{const r=e.getBoundingClientRect();return r.top>=body.top&&r.bottom<=body.bottom&&r.left>=body.left&&r.right<=body.right}),formatsFit:bar.bottom<=card.bottom&&bar.right<=card.right,previewHeight:body.height}})()`);
    assert.equal(geometry.columns,3);assert.equal(geometry.buttonsFit,true,'whole native window action clipping '+width+'x'+height+JSON.stringify(geometry));assert.equal(geometry.formatsFit,true);assert.ok(geometry.previewHeight>=50);
  }
  await evaluate("document.getElementById('test').style.cssText='width:320px;height:230px'");await settle();
  await click('[data-action="quality"]');
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:650,y:450});
  await evaluate('document.activeElement.blur()');
  await new Promise(r=>setTimeout(r,1200));
  assert.equal(await evaluate('hideCalls'),0,'open editor pauses window auto-hide');
  assert.equal(await evaluate(`(()=>{const a=document.querySelector('[data-action=more]').getBoundingClientRect(); const b=document.querySelector('.floating-footer .floating-collapse-button').getBoundingClientRect();return a.bottom<=b.top || b.bottom<=a.top || a.right<=b.left || b.right<=a.left})()`),true,'collapse never overlaps card overflow');
  await click('.floating-editor-footer button:not(.primary)');
  await evaluate('document.activeElement.blur()');
  await new Promise(r=>setTimeout(r,1200));
  assert.equal(await evaluate('hideCalls'),1,'closing editor restarts window auto-hide');
  console.log('PASS: integrated full/compact card at 320/380px in light/dark; exact pointer crop payload; quality + format recompression; copy/save/undo/preview/reveal/dismiss; Escape; no nested controls, duplicate toolbar, control overflow or accidental window dragging. Chinese compact edit fits; 230px height pins Apply and formats with inner scrolling. Auto-hide pauses while editing and resumes after close; collapse avoids overflow. Native artifacts verified separately in Rust.');
} finally {socket.close();}
