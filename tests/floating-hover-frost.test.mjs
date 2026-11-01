import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const css=['desktop/clop-desktop.css','desktop/floating-result-editor.css','desktop/floating-adaptive.css'].map(p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')).join('\n');
const endpoint='http://127.0.0.1:'+(process.env.CDP||9443);
test('hover uses opaque light controls, a full preview frost and always two rows',async()=>{
 const target=await(await fetch(endpoint+'/json/new?about:blank',{method:'PUT'})).json();const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);let seq=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);pending.get(m.id)?.(m.result);pending.delete(m.id)};const send=(method,params={})=>new Promise(r=>{const id=++seq;pending.set(id,r);ws.send(JSON.stringify({id,method,params}))});const ev=async expression=>(await send('Runtime.evaluate',{expression,returnByValue:true})).result.value;
 try{
  await send('DOM.enable');await send('CSS.enable');
  for(const style of ['immersive'])for(const theme of ['light','dark'])for(const height of [188,326]){
   const integrated=style==='immersive';
   const markup=`<main class="floating-results ${integrated?'has-image':'has-classic-image'} display-stack" data-floating-style="${style}" data-image-tone="dark" style="width:380px;height:${height}px"><div class="floating-window-image"></div><article class="result-card ${integrated?'integrated':'classic'}-result-card"><div class="floating-card-content has-preview"><div class="floating-card-body"><div class="result-preview"><div class="result-hover-actions"><div class="result-actions">${'<button><svg/></button>'.repeat(6)}</div></div></div></div></div></article><footer class="floating-footer ${integrated?'':'classic-floating-footer'}"><button class="automatic-badge">Smart</button><button>Menu</button></footer></main>`;
   await ev(`(()=>{document.documentElement.dataset.theme='${theme}';document.head.innerHTML='';const s=document.createElement('style');s.textContent=${JSON.stringify(css+'\n*{transition:none!important}html,body{margin:0} .result-card{height:100%}')};document.head.append(s);document.body.innerHTML=${JSON.stringify(markup)}})()`);
   const {root}=await send('DOM.getDocument');const {nodeId}=await send('DOM.querySelector',{nodeId:root.nodeId,selector:'.result-card'});await send('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:['hover']});
   const state=await ev(`(()=>{const q=s=>document.querySelector(s),b=q('.result-actions button'),grid=getComputedStyle(q('.result-actions')),f=getComputedStyle(q('${integrated?'.floating-window-image':'.result-preview'}'),'${integrated?'::after':'::before'}');return{bg:getComputedStyle(b).backgroundColor,ink:getComputedStyle(b).color,rows:grid.gridTemplateRows.split(' ').length,cols:grid.gridTemplateColumns.split(' ').length,frost:f.backdropFilter,mask:f.maskImage,top:f.top,footer:getComputedStyle(q('.floating-footer button')).color,match:q('.result-preview').matches('.classic-result-card:is(:hover,:focus-within) .result-preview'),card:q('.result-card').className,styleCount:document.styleSheets[0].cssRules.length}})()`);
   assert.equal(state.bg,'rgb(239, 236, 230)',JSON.stringify({style,theme,height,state}));assert.equal(state.ink,'rgb(45, 46, 49)');assert.equal(state.rows,2);assert.equal(state.cols,3);assert.match(state.frost,/blur\(18px\)/,JSON.stringify({style,theme,height,state}));assert.equal(state.mask,'none');assert.equal(state.top,'0px');if(!integrated)assert.equal(state.footer,'rgb(244, 242, 238)');
  }
 }finally{ws.close();await fetch(endpoint+'/json/close/'+target.id)}
});
