// Run against the Vite desktop dev server and a disposable Chrome CDP target.
import assert from 'node:assert/strict';
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
try {
  await send('Page.navigate', {url: origin});
  for(let i=0; i<40; i++) {try {if(await evaluate('document.readyState === "complete"')) break;} catch {} await new Promise(r => setTimeout(r, 100));}
  await evaluate(`(async () => {
    const moduleText = await fetch('/floating-result-editor.tsx').then(r => r.text());
    const reactUrl = moduleText.split('"').find(s => s.includes('deps/react.js'));
    const React = (await import(reactUrl)).default;
    const clientText = await fetch('/renderer.tsx').then(r => r.text());
    const clientUrl = clientText.split('"').find(s => s.includes('deps/react-dom_client.js'));
    const {createRoot} = (await import(clientUrl)).default;
    const {FloatingResultEditor} = await import('/floating-result-editor.tsx');
    document.body.innerHTML = '<div id="test" style="width:360px;color:black"></div>';
    const canvas = document.createElement('canvas'); canvas.width = 200; canvas.height = 100;
    canvas.getContext('2d').fillRect(0,0,200,100);
    window.calls=[];
    const api = {
      editFloatingImage: async (path, edit) => {calls.push({kind:'crop',path,edit});return '/edited.png';},
      copyImagePath: async path => calls.push({kind:'copy',path}),
      selectFolder: async () => '/exports',
      saveFloatingResult: async (path, folder) => {calls.push({kind:'save',path,folder});return '/exports/result.png';},
      openImage: async path => calls.push({kind:'preview',path}),
      revealPath: async path => calls.push({kind:'reveal',path})
    };
    createRoot(document.getElementById('test')).render(React.createElement(FloatingResultEditor, {
      api,path:'/source.png',preview:canvas.toDataURL(),width:200,height:100,language:'en',format:'png',quality:86,canUndo:true,
      process:async (settings,source)=>calls.push({kind:'process',settings,source}),undo:()=>calls.push({kind:'undo'}),notify:()=>{}
    }));
  })()`);
  await new Promise(r => setTimeout(r, 200));
  await evaluate('document.querySelector(".floating-editor-toolbar button").click()');
  await new Promise(r => setTimeout(r, 100));
  const rect = await evaluate('(()=>{const r=document.querySelector(".floating-crop-stage").getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()');
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:rect.x+rect.width*.25,y:rect.y+rect.height*.2,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:rect.x+rect.width*.75,y:rect.y+rect.height*.8,button:'left',buttons:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:rect.x+rect.width*.75,y:rect.y+rect.height*.8,button:'left',clickCount:1});
  await evaluate('document.querySelector(".floating-editor-panel footer button").click()');
  await new Promise(r => setTimeout(r, 100));
  const calls = await evaluate('window.calls');
  assert.deepEqual(calls[0],{kind:'crop',path:'/source.png',edit:{x:50,y:20,width:100,height:60,outputWidth:100,outputHeight:60}});
  assert.equal(calls[1].source,'/edited.png');
  assert.equal(calls[1].settings.quality,86);
  assert.equal(calls[1].settings.format,'png');
  await evaluate('document.querySelectorAll(".floating-editor-toolbar button")[2].click();document.querySelectorAll(".floating-editor-toolbar button")[3].click();document.querySelectorAll(".floating-editor-toolbar button")[4].click()');
  await new Promise(r => setTimeout(r, 100));
  const actions = await evaluate('window.calls');
  assert(actions.some(c => c.kind === 'copy'));
  assert(actions.some(c => c.kind === 'save' && c.folder === '/exports'));
  assert(actions.some(c => c.kind === 'undo'));
  console.log('PASS: real browser pointer drag maps to exact native crop payload; apply, copy, save-copy and undo are wired. Native file output is covered by Rust artifact tests.');
} finally { socket.close(); }
