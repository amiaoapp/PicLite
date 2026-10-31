import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const styles = await Promise.all(['desktop/clop-desktop.css', 'desktop/floating-result-editor.css', 'desktop/floating-adaptive.css', 'app/browser-floating-result.css'].map(file => readFile(new URL('../' + file, import.meta.url), 'utf8')));
const endpoint = `http://127.0.0.1:${process.env.CDP || 9443}`;

async function withStyles(run) {
  const target = await fetch(endpoint + '/json/new?about:blank', { method: 'PUT' }).then(response => response.json());
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve => { socket.onopen = resolve; });
  let sequence = 0;
  const pending = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    const job = pending.get(message.id);
    if (!job) return;
    pending.delete(message.id);
    if (message.error) job.reject(Error(JSON.stringify(message.error)));
    else job.resolve(message.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  try { await send('DOM.enable'); await send('CSS.enable'); await run({ send, evaluate }); } finally { socket.close(); await fetch(endpoint + '/json/close/' + target.id); }
}

const desktopButtons = '.floating-card-icon,.result-close,.result-actions button,.floating-card-formats button,.format-bar button,.crop-window-trigger,.floating-footer button,.floating-editor-footer button,.floating-overflow-menu button';
const browserButtons = '.browser-floating-result button';
const fixtures = `
<main class="floating-results has-image display-stack" data-image-tone="light" data-floating-style="immersive">
 <article class="result-card integrated-result-card" data-image-tone="light">
  <div class="floating-card-content has-preview">
   <header class="floating-card-header"><button class="floating-card-icon">Close</button></header>
   <div class="floating-card-body"><div class="result-preview"><img alt=""/></div><div class="result-overlay"><strong class="result-name">image.png</strong><div class="result-metrics"><b>10 KB</b><span>→</span><b>2 KB</b><em>−80%</em><em class="bad">+5%</em></div><div class="result-dimensions">1000 × 600</div></div><div class="result-hover-actions"><div class="result-actions"><button>Copy</button><button disabled>Save</button></div></div></div>
   <div class="floating-card-bottom"><button class="crop-window-trigger">Crop</button><div class="floating-card-formats"><button>PNG</button><button class="active">Auto</button></div></div>
  </div>
  <button class="result-close">Close</button><div class="format-bar"><button>JPEG</button><button class="active">WebP</button></div>
  <div class="floating-overflow-menu"><button>Open image</button></div>
  <section class="floating-editor-panel"><div class="floating-editor-quality"><span>Quality<output>80%</output></span></div><footer class="floating-editor-footer"><button>Cancel</button><button class="primary">Apply</button></footer></section>
 </article>
 <footer class="floating-footer"><button class="automatic-badge"><span>Smart</span><svg/></button><div><button>Settings</button><button class="floating-result-next">Next 1/2</button><button class="click-through-toggle active">Pin</button></div></footer>
</main>
<aside class="browser-floating-result style-immersive" data-tone="light"><img class="browser-floating-image" alt=""/><header class="browser-floating-header"><span>Optimised · 2</span><button>×</button></header><div class="browser-floating-bottom"><div class="browser-floating-metrics"><span>10 KB → <strong>2 KB</strong></span><small>1000 × 600</small></div><div class="browser-floating-actions"><button><span>⧉</span><small>Copy image</small></button><button disabled>Next</button></div></div></aside>`;

async function mount(evaluate, order) {
  await evaluate(`document.documentElement.innerHTML = '<head></head><body></body>'; document.head.innerHTML = ${JSON.stringify(order.map(index => '<style>' + styles[index] + '</style>').join('') + '<style>*{transition:none!important;animation:none!important}</style>')}; document.body.innerHTML = ${JSON.stringify(fixtures)};`);
}

test('floating labels, filesize, dimensions and percentages render at weight 400', async () => {
 await withStyles(async ({ evaluate }) => {
  for (const order of [[0, 1, 2, 3], [1, 2, 0, 3]]) {
   await mount(evaluate, order);
   await evaluate(`document.body.style.fontWeight='600'`);
   for (const theme of ['light', 'dark']) for (const style of ['immersive', 'classic']) {
    await evaluate(`document.documentElement.dataset.theme='${theme}';document.querySelector('main').dataset.floatingStyle='${style}';document.querySelector('.result-card').className='result-card ${style === 'classic' ? 'classic' : 'integrated'}-result-card';`);
    const labels = await evaluate(`Array.from(document.querySelectorAll('.floating-results button,.floating-results button span,.result-metrics :is(b,span,em),.result-dimensions,.floating-card-header>span,.floating-editor-quality output,.browser-floating-result button,.browser-floating-result button small,.browser-floating-metrics :is(span,strong,small)')).map(e=>({label:e.className+' '+e.textContent,weight:getComputedStyle(e).fontWeight}))`);
    for (const label of labels) assert.equal(label.weight, '400', `${order}/${theme}/${style}/${label.label}`);
   }
  }
 });
});

const rgba = color => color.match(/[\d.]+/g).map(Number);
const luminance = rgb => rgb.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);

test('floating controls keep idle backgrounds absent and hover readable in both themes', async () => {
 await withStyles(async ({ send, evaluate }) => {
  // CSS import order can differ between direct desktop and bundled entrypoints.
  for (const order of [[0, 1, 2, 3], [1, 2, 0, 3]]) {
   await mount(evaluate, order);
   for (const theme of ['light', 'dark']) for (const tone of ['light', 'dark']) for (const style of ['immersive', 'classic']) {
    const context = `${order}/${theme}/${tone}/${style}`;
    await evaluate(`(()=>{document.documentElement.dataset.theme='${theme}'; for(const e of document.querySelectorAll('[data-image-tone]'))e.dataset.imageTone='${tone}';document.querySelector('main').dataset.floatingStyle='${style}';const card=document.querySelector('.result-card');card.className='result-card ${style === 'classic' ? 'classic' : 'integrated'}-result-card';document.querySelector('.floating-footer').classList.toggle('classic-floating-footer','${style}'==='classic');const browser=document.querySelector('aside');browser.dataset.tone='${tone}';browser.className='browser-floating-result style-${style}';})()`);
    const { root } = await send('DOM.getDocument');
    const { nodeIds } = await send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: desktopButtons + ',' + browserButtons });
    for (const state of [[], ['hover'], ['active'], ['focus-visible']]) {
     for (const nodeId of nodeIds) await send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: state });
     const buttons = await evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(desktopButtons + ',' + browserButtons)})).filter(e=>!e.closest('.result-card') || (document.querySelector('main').dataset.floatingStyle==='classic' ? !e.matches('.floating-card-icon,.floating-card-formats button,.crop-window-trigger,.floating-editor-footer button,.floating-overflow-menu button') : !e.matches('.result-close,.format-bar button'))).map(e=>{const s=getComputedStyle(e);return{label:e.className+' '+e.textContent,background:s.backgroundColor,ink:s.color,outline:s.outlineWidth,outlineStyle:s.outlineStyle,shadow:s.boxShadow,filter:s.filter,blur:s.backdropFilter,disabled:e.disabled}})`);
     for (const button of buttons) {
      const label = `${context}/${state}/${button.label}`;
      const bg = rgba(button.background), ink = rgba(button.ink);
      if (!state.length && !button.label.includes('primary') && !button.label.includes('Apply') && !button.label.includes('Cancel') && !button.label.includes('Save copy') && !button.label.includes('Open image')) assert.ok(bg.length===4 && bg[3]===0, `${label}: no idle button fill, got ${button.background}`);
      if(state.includes('hover') && !button.disabled && bg[3]>0 && !button.label.includes('Open image') && !button.label.includes('Cancel') && !button.label.includes('Apply')) {
       const composite=bg.slice(0,3).map(value=>value*bg[3]+32*(1-bg[3]));
       assert.ok(contrast(ink,composite)>=3, `${label}: hover text remains readable`);
      }
      assert.ok(button.outlineStyle === 'none' || parseFloat(button.outline) <= 1, `${label}: no thick outlines`);
      assert.doesNotMatch(button.shadow, /inset.* 2px/, `${label}: no heavy inset ring`);
      assert.equal(button.filter, 'none', `${label}: no brightness filter`);
      assert.equal(button.blur, 'none', `${label}: no glass blur`);
     }
    }
   }
  }
 });
});
