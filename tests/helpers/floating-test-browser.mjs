export async function floatingBrowser(run, options = {}) {
  const endpoint = options.endpoint || `http://127.0.0.1:${process.env.CDP || 9443}`;
  const target = options.target || await fetch(endpoint + '/json/new?about:blank', { method: 'PUT' }).then(r => r.json());
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve => { socket.onopen = resolve; });
  let sequence = 0;
  const pending = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data), job = pending.get(message.id);
    if (!job) return;
    pending.delete(message.id);
    if (message.error) job.reject(Error(JSON.stringify(message.error)));
    else job.resolve(message.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const wait = async expression => {
    for (let attempt = 0; attempt < 120; attempt++) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw Error('Timeout: ' + expression + ' ' + JSON.stringify(await evaluate(`({root:document.querySelector('main')?.dataset,card:document.querySelector('.result-card')?.dataset,hover:document.querySelector('.result-card')?.matches(':hover'),focus:document.activeElement?.outerHTML.slice(0,120)})`)));
  };
  const click = async selector => {
    const point = await evaluate(`(() => {
      const button = document.querySelector(${JSON.stringify(selector)}), r = button.getBoundingClientRect();
      if (document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('button') !== button) throw Error('Button is covered: ' + button.title);
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, button: 'left', clickCount: 1, ...point });
  };
  try { await send('Page.enable'); await run({ send, evaluate, wait, click }); }
  finally { socket.close(); if (!options.target) await fetch(endpoint + '/json/close/' + target.id); }
}
