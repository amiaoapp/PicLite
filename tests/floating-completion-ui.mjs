// The native output can be ready while preview loading is still pending.
// Completion and copy must use the native result without waiting for a preview.
import assert from 'node:assert/strict';
import { floatingBrowser } from './helpers/floating-test-browser.mjs';

await floatingBrowser(async ({ send, evaluate, wait }) => {
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    localStorage.clear();
    localStorage.setItem('piclite.desktop.clop-settings.v1', JSON.stringify({
      language:'en',autoHideResults:false,updateCheckFrequency:'never'
    }));
    let api;
    window.nativeRequests=[];
    window.resultMode='success';
    Object.defineProperty(window,'picLite',{configurable:true,get(){return api},set(value){
      api={...value,windowLabel:'dropzone',
        onFileDrop:callback=>{window.dropImage=callback;return()=>{}},
        quickCompressPaths:async(paths,settings)=>{
          nativeRequests.push({paths,settings});
          if(resultMode==='error')throw Error('Native compression failed');
          if(resultMode==='empty')return [];
          return paths.map(source=>({source,output:source+'.webp',originalBytes:2000000,outputBytes:206512,width:2636,height:1252,keptOriginal:false}));
        },
        readImagesFromPaths:()=>new Promise(resolve=>{window.finishPreview=()=>resolve([])}),
      };
    }});
  ` });
  await send('Page.navigate', { url: (process.env.ORIGIN || 'http://127.0.0.1:1551') + '/?window=dropzone' });
  await wait('typeof dropImage === "function"');
  await evaluate(`dropImage({type:'drop',paths:['/test/source.png']})`);
  await wait('typeof finishPreview === "function"');
  assert.ok(await evaluate(`!!document.querySelector('.result-metrics')?.textContent.includes('202 KB')`),
    'Native completion must be visible even when the preview has not returned');
  assert.equal(await evaluate(`!!document.querySelector('.result-state')`), false,
    'A finished compression must not keep showing the compression spinner');
  const request = await evaluate('nativeRequests[0]');
  assert.deepEqual(request.paths, ['/test/source.png']);
  assert.equal(request.settings.mode, 'auto');
  await evaluate('finishPreview()');
  for (const mode of ['error', 'empty']) {
    await evaluate(`resultMode='${mode}';dropImage({type:'drop',paths:['/test/${mode}.png']})`);
    const message = mode === 'error' ? 'Native compression failed' : 'No optimised result was created';
    await wait(`document.querySelector('.result-error')?.textContent === ${JSON.stringify(message)}`);
    assert.equal(await evaluate(`!!document.querySelector('.result-state')`), false,
      'Native failure or missing result must leave the working state');
  }
  assert.deepEqual(await evaluate('nativeRequests.map(request=>request.settings)'),
    [request.settings, request.settings, request.settings], 'Preview state must not alter compression parameters');
  console.log('PASS floating native completion remains usable during delayed preview; errors leave the spinner');
});
