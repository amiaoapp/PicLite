import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const binary = process.env.PICLITE_BINARY;
test('HTTP bridge advertises the repository version', { skip: !binary, timeout: 15000 }, async () => {
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const bridge = spawn(process.execPath, ['scripts/mcp-http.mjs'], {
    env: { ...process.env, PICLITE_BINARY: binary, PICLITE_MCP_PORT: String(port), PICLITE_MCP_TOKEN: '' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const client = new Client({ name: 'metadata-regression', version: '1.0.0' });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('bridge startup timeout')), 10000);
      bridge.stderr.on('data', data => {
        if (data.toString().includes('PicLite MCP:')) { clearTimeout(timer); resolve(); }
      });
      bridge.once('exit', code => { clearTimeout(timer); reject(new Error(`bridge exited: ${code}`)); });
    });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    assert.equal(client.getServerVersion().version, version);
    assert.equal((await client.listTools()).tools.length, 3);
  } finally {
    await client.close();
    bridge.kill();
    await once(bridge, 'exit');
  }
});
