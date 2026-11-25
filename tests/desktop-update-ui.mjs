import assert from 'node:assert/strict';
import { floatingBrowser } from './helpers/floating-test-browser.mjs';

await floatingBrowser(async ({ send, evaluate, wait }) => {
  const origin = process.env.ORIGIN || 'http://127.0.0.1:1551';
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    localStorage.setItem('piclite.desktop.clop-settings.v1', JSON.stringify({language:'en',updateCheckFrequency:'never'}));
    localStorage.setItem('piclite.desktopPreferences.v1', JSON.stringify({language:'en',updateCheckFrequency:'never'}));
    localStorage.setItem('piclite.preferences.requested-section','about');
    window.updateAttempts = 0;
    window.openedUrls = [];
    let api;
    Object.defineProperty(window,'picLite',{configurable:true,get(){return api},set(value){
      api={...value,
        checkForUpdates:async()=>({currentVersion:'2.2.2',latestVersion:'99.0.0',available:true,
          inApp:!location.search.includes('manual=1'),releaseUrl:'https://example.test/download'}),
        openExternal:async url=>openedUrls.push(url),
        installUpdate: async progress => {
          updateAttempts++;
          progress({stage:'downloading',percent:42});
          await new Promise((resolve,reject)=>{window.finishUpdate=resolve;window.failUpdate=()=>reject(Error('Installer unavailable'));});
          progress({stage:'installing'});
          await new Promise(()=>{});
        },
      };
    }});
  ` });
  const findButton = label => `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)})`;
  const click = async label => {
    const button = findButton(label);
    await wait(`${button} && !${button}.disabled`);
    await evaluate(`${button}.click()`);
  };

  await send('Page.navigate', { url: `${origin}/?window=preferences` });
  await click('Update and restart');
  await wait(`${findButton('Downloading 42%…')}?.disabled`);
  await evaluate('failUpdate()');
  await wait(`document.body.textContent.includes('Installer unavailable')`);
  await click('Retry update');
  await wait(`${findButton('Downloading 42%…')}?.disabled`);
  await evaluate('finishUpdate()');
  await wait(`${findButton('Installing and restarting…')}?.disabled`);
  assert.equal(await evaluate('updateAttempts'), 2);
  assert.deepEqual(await evaluate('openedUrls'), []);

  await send('Page.navigate', { url: `${origin}/?window=preferences&manual=1` });
  await click('Download update');
  assert.deepEqual(await evaluate('openedUrls'), ['https://example.test/download']);
  assert.equal(await evaluate('updateAttempts'), 0);

  await send('Page.navigate', { url: `${origin}/` });
  await wait(`!!document.querySelector('.brand-version')`);
  await evaluate(`document.querySelector('.brand-version').click()`);
  await wait(`!!document.querySelector('.update-notice')`);
  await click('Update and restart');
  await wait(`${findButton('Downloading 42%…')}?.disabled`);
  assert.deepEqual(await evaluate('openedUrls'), []);
  console.log('PASS desktop update actions open an update, show progress, support retry and preserve manual package downloads');
});
