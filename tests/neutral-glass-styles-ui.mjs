// Isolated CDP document: check actual CSS cascade without changing the app tab.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const port = process.env.PICLITE_CDP_PORT || 9442;
const endpoint = `http://127.0.0.1:${port}`;
const tab = await fetch(`${endpoint}/json/new?about:blank`, { method:'PUT' }).then(r=>r.json());
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener('open',r,{once:true}));
let id=0; const waiting=new Map();
ws.addEventListener('message',({data})=>{const m=JSON.parse(data); const p=waiting.get(m.id); if(p){waiting.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}});
const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;waiting.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description);return r.result.value;};
try {
  // Material first deliberately exercises the worst ordering of legacy styles.
  const css=['app/liquid-glass.css','desktop/clop-desktop.css','app/globals.css','app/studio.css','app/workspace-chrome.css'].map(p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')).join('\n');
  await send('Page.enable');
  await send('Page.setDocumentContent',{frameId:(await send('Page.getFrameTree')).frameTree.frame.id,html:`<!doctype html><html><head><style>${css}</style></head><body><div id="root"><main class="app-shell desktop-app"><header class="topbar"></header><div class="workspace"><section class="queue-panel"></section><section class="preview-panel"><div class="preview-stage"></div></section><section class="settings-panel"></section></div></main></div></body></html>`});
  const inspect=()=>evaluate(`(()=>{const s=q=>getComputedStyle(document.querySelector(q));const shell=s('.app-shell'),panel=s('.queue-panel');return {root:s('html').backgroundColor,body:s('body').backgroundColor,mount:s('#root').backgroundColor,shell:shell.backgroundColor,image:shell.backgroundImage,panel:panel.backgroundColor,blur:panel.backdropFilter,ink:shell.color,accent:shell.getPropertyValue('--deep').trim(),top:s('.topbar').backgroundColor}})()`);
  let cases=0;
  for(const theme of ['light','dark']) for(const layout of ['classic','studio']) {
    let baseline;
    for(const palette of ['white','graphite','mist','violet','green']) {
      await evaluate(`Object.assign(document.documentElement.dataset,{theme:${JSON.stringify(theme)},palette:${JSON.stringify(palette)},material:'glass',transparency:'full',nativeMaterial:'glass',platform:'darwin'});document.querySelector('main').className='app-shell desktop-app ${layout}-shell'`);
      const result=await inspect();
      assert.deepEqual([result.root,result.body,result.mount,result.shell],Array(4).fill('rgba(0, 0, 0, 0)'));
      assert.equal(result.image,'none'); assert.equal(result.blur,'none');
      const stage=await evaluate(`({bg:getComputedStyle(document.querySelector('.preview-stage')).backgroundColor,image:getComputedStyle(document.querySelector('.preview-stage')).backgroundImage})`);
      assert.deepEqual(stage,{bg:'rgba(0, 0, 0, 0)',image:'none'},'preview must not retain a legacy palette gradient');
      assert.match(result.panel,/rgba\((\d+), \1, \1, 0\.(46|5)\)/);
      if(baseline)assert.deepEqual(result,baseline,'glass changes with palette');baseline=result;cases++;
    }
    await evaluate(`document.documentElement.dataset.nativeMaterial='vibrancy'`);
    assert.deepEqual(await inspect(),baseline,'native vibrancy must retain the clear chain');cases++;
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-transparency',value:'reduce'}]});
    const accessible=await inspect();assert.match(accessible.panel,/^rgb\(/);assert.notEqual(accessible.shell,'rgba(0, 0, 0, 0)');cases++;
    await send('Emulation.setEmulatedMedia',{features:[]});
    await evaluate(`document.documentElement.dataset.nativeMaterial='none'`);
    const fallback=await inspect();assert.equal(fallback.image,'none');assert.equal(fallback.shell,theme==='light'?'rgb(244, 244, 244)':'rgb(32, 32, 32)');cases++;
    await evaluate(`document.documentElement.dataset.transparency='reduce'`);
    const reduced=await inspect(); assert.match(reduced.panel,/^rgb\(/); assert.notEqual(reduced.shell,'rgba(0, 0, 0, 0)');cases++;
    await evaluate(`Object.assign(document.documentElement.dataset,{material:'standard',palette:'white',transparency:'full',nativeMaterial:'none'})`);
    const white=await inspect(); assert.equal(white.shell,theme==='light'?'rgb(255, 255, 255)':'rgb(24, 24, 24)');
    assert.equal(white.panel,theme==='light'?'rgb(255, 255, 255)':'rgb(36, 36, 36)');cases++;
  }
  console.log(`PASS: ${cases} computed-style cases: palette independence, native transparency, unfiltered panels, reduced transparency and pure white.`);
} finally { ws.close(); await fetch(`${endpoint}/json/close/${tab.id}`); }
