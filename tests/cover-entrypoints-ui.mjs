import assert from 'node:assert/strict';
import {floatingBrowser} from './helpers/floating-test-browser.mjs';
import {coverFixture,inspectCoverExport} from './helpers/cover-export.mjs';
const origin=process.env.ORIGIN||'http://127.0.0.1:1551';
await floatingBrowser(async({send,evaluate,wait})=>{
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('piclite.cover-preset.v1',${JSON.stringify(JSON.stringify(coverFixture))});`});
 await send('Page.navigate',{url:origin});await wait(`!!document.querySelector('[data-tool-id=banner]') && !!document.documentElement.dataset.density`);
 await evaluate(`document.querySelector('[data-tool-id=banner]').click()`);await wait(`!!document.querySelector('.banner-page iframe')?.contentWindow.picLiteCover`);
 const result=await evaluate(`(${inspectCoverExport.toString()})()`);
 assert.deepEqual([result.width,result.height],[200,200]);assert.equal(result.type,'image/png');
 assert.ok(result.partial>40);assert.ok(result.maxError<.06,JSON.stringify(result));
 console.log('PASS cover entry point',origin,result);
});
