import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {floatingBrowser} from './helpers/floating-test-browser.mjs';
const bytes=[...readFileSync('public/studio-coast.webp')];
await floatingBrowser(async({send,evaluate,wait})=>{
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`
 localStorage.clear();localStorage.setItem('piclite.desktopPreferences.v1',JSON.stringify({language:'en',theme:'light'}));
 let api;Object.defineProperty(window,'picLite',{configurable:true,get(){return api},set(value){api={...value,readClipboardImage:async()=>({name:'copied-compressed.webp',type:'image/webp',data:new Uint8Array(${JSON.stringify(bytes)})})}}});`});
 await send('Page.navigate',{url:process.env.ORIGIN||'http://127.0.0.1:1551'});
 await wait(`!!document.querySelector('.app-shell') && !!window.picLite`);
 // WebView/Chromium offers a new image.png even for a copied WebP. Native
 // ingress must replace this representation before the app adds it to the queue.
 await evaluate(`(()=>{const transfer=new DataTransfer();transfer.items.add(new File([new Uint8Array([137,80,78,71])],'image.png',{type:'image/png'}));dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}))})()`);
 await wait(`!!document.querySelector('.queue-item')`);
 const result=await evaluate(`(async()=>{const item=document.querySelector('.queue-item');const blob=await fetch(item.querySelector('img').src).then(r=>r.blob());const data=new Uint8Array(await blob.arrayBuffer());return{name:item.querySelector('strong').textContent,bytes:[...data],label:item.querySelector('small').textContent}})()`);
 assert.equal(result.name,'copied-compressed.webp');assert.deepEqual(result.bytes,bytes);
 assert.ok(!result.label.includes('MB'),result.label);
 console.log('PASS actual workbench paste uses original WebP bytes and filename instead of synthetic image.png:',{name:result.name,bytes:bytes.length,label:result.label});
});
