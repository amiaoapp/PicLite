import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../desktop/clop-desktop-app.tsx',import.meta.url),'utf8');
const editor=readFileSync(new URL('../desktop/floating-result-editor.tsx',import.meta.url),'utf8');
const css=['desktop/clop-desktop.css','desktop/floating-result-editor.css','desktop/floating-adaptive.css','desktop/floating-classic.css'].map(p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')).join('\n');
test('floating previews omit filenames and new footer and original classic corner expose collapse',()=>{
 assert.doesNotMatch(editor,/className="floating-filename-badge"/);
 const card=app.slice(app.indexOf('export function ResultCard'),app.indexOf('export function FloatingResults'));
 assert.doesNotMatch(card,/className="result-name"/);
 const footer=app.slice(app.indexOf('<footer className={`floating-footer'),app.indexOf('<button className="floating-resize-handle"'));
 const classic=footer.slice(footer.indexOf('settings.floatingStyle === "classic" ? <div>'),footer.indexOf('</div> : <div>'));
 assert.doesNotMatch(classic,/<FloatingCollapseButton/);
 assert.match(app,/settings.floatingStyle === "classic" && results.length > 0 && <FloatingCollapseButton/);
});
test('visible footer, original classic toolbar and reference-sized 3x2 targets',async()=>{
 const endpoint='http://127.0.0.1:'+(process.env.CDP||9443),target=await(await fetch(endpoint+'/json/new?about:blank',{method:'PUT'})).json();const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);let seq=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);pending.get(m.id)?.(m.result);pending.delete(m.id)};const send=(method,params={})=>new Promise(r=>{const id=++seq;pending.set(id,r);ws.send(JSON.stringify({id,method,params}))});const ev=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value};
 try{
  for(const style of ['immersive','classic'])for(const tone of ['light','dark']){
   const markup=`<main class="floating-results display-stack ${style==='classic'?'has-classic-image':'has-image'}" data-floating-style="${style}" data-image-tone="${tone}" style="width:380px;height:326px"><article class="result-card ${style==='classic'?'classic':'integrated'}-result-card"><div class="floating-card-content has-preview"><div class="floating-card-body" style="width:380px;height:326px"><div class="result-preview" style="height:326px"><div class="result-actions">${'<button><svg/></button>'.repeat(6)}</div></div></div></div></article><footer class="floating-footer ${style==='classic'?'classic-floating-footer':''}"><button class="automatic-badge">Smart</button><div><button class="floating-collapse-button">Collapse</button><button>Workbench</button><button>Close</button></div></footer></main>`;
   await ev(`(()=>{document.documentElement.dataset.theme='light';document.head.innerHTML='';const s=document.createElement('style');s.textContent=${JSON.stringify(css+'\n*{transition:none!important}body{margin:0}')};document.head.append(s);document.body.innerHTML=${JSON.stringify(markup)}})()`);
   const state=await ev(`(()=>{const f=document.querySelector('.floating-footer'),b=f.querySelector('.floating-collapse-button'),a=document.querySelector('.result-actions button'),grid=getComputedStyle(a.parentElement);return{display:getComputedStyle(b).display,ink:getComputedStyle(b).color,paper:getComputedStyle(f).backgroundColor,size:a.getBoundingClientRect().width,rows:grid.gridTemplateRows.split(' ').length,cols:grid.gridTemplateColumns.split(' ').length}})()`);
   assert.notEqual(state.display,'none',JSON.stringify({style,tone,state}));assert.equal(state.rows,2);assert.equal(state.cols,3);assert.ok(state.size>=32&&state.size<=(style==='classic'?44:69),JSON.stringify({style,tone,state}));
   if(style==='classic'){assert.equal(state.size,42);assert.equal(state.paper,'rgba(0, 0, 0, 0)');}
  }
 }finally{ws.close();await fetch(endpoint+'/json/close/'+target.id)}
});
