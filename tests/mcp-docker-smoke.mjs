import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { apngFixture, verifyCompressedApng } from './apng-fixture.mjs';
import { animatedWebpFixture, verifyWebpToGif } from './animated-webp-fixture.mjs';

const localBinary = process.env.PICLITE_MCP_BINARY;
const localRoot = localBinary ? await mkdtemp(join(tmpdir(), 'piclite-docker-mcp-test-')) : null;
const workspace = process.env.PICLITE_MCP_TEST_WORKSPACE || join(localRoot || '', 'workspace');
const token = process.env.PICLITE_MCP_TOKEN || randomBytes(32).toString('hex');
assert.ok(workspace, 'PICLITE_MCP_TEST_WORKSPACE is required unless PICLITE_MCP_BINARY starts a local service');
let bridge;
let endpoint = process.env.PICLITE_MCP_URL || 'http://127.0.0.1:3210/mcp';
await mkdir(join(workspace, 'input'), { recursive: true });
await mkdir(join(workspace, 'output'), { recursive: true });
const source = join(workspace, 'input', 'vector.svg');
await copyFile(new URL('./fixtures/vector-features.svg', import.meta.url), source);
const sourceBytes = await readFile(source);

if (localBinary) {
  bridge = spawn(process.execPath, ['scripts/mcp-docker.mjs'], { env: {
    ...process.env,
    PICLITE_BINARY: localBinary,
    PICLITE_MCP_HOST: '127.0.0.1',
    PICLITE_MCP_PORT: '0',
    PICLITE_MCP_TOKEN: token,
    PICLITE_MCP_WORKSPACE: workspace,
  }, stdio: ['ignore', 'ignore', 'pipe'] });
  endpoint = await new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error('Timed out starting the Docker MCP bridge')), 15_000);
    bridge.stderr.on('data', chunk => {
      stderr += chunk.toString();
      const match = stderr.match(/listening on port (\d+)/);
      if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}/mcp`); }
    });
    bridge.once('error', reject);
    bridge.once('exit', code => reject(new Error(`Docker MCP bridge exited with ${code}: ${stderr}`)));
  });
}

try {
  const denied = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(denied.status, 401, 'MCP endpoint must reject missing bearer credentials');
  const weakToken = await fetch(endpoint, { method: 'POST', headers: {
    authorization: 'Bearer short-token', 'content-type': 'application/json',
  }, body: '{}' });
  assert.equal(weakToken.status, 401, 'MCP endpoint must reject a weak token');
  const originRejected = await fetch(endpoint, { method: 'POST', headers: {
    authorization: `Bearer ${token}`, origin: 'https://untrusted.example', 'content-type': 'application/json',
  }, body: '{}' });
  assert.equal(originRejected.status, 403, 'MCP endpoint must reject browser origins');
  const oversized = await fetch(endpoint, { method: 'POST', headers: {
    authorization: `Bearer ${token}`, 'content-type': 'application/json',
  }, body: `{"oversized":"${'x'.repeat(1024 * 1024)}"}` });
  assert.equal(oversized.status, 413, 'MCP requests must have a bounded body size');

  const client = new Client({ name: 'piclite-docker-smoke', version: '1.0.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }));
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(tool => tool.name).sort(), [
      'piclite_compress', 'piclite_convert', 'piclite_create_cover', 'piclite_inspect',
    ]);
    assert.equal(tools.find(tool => tool.name === 'piclite_compress').inputSchema.properties.outputDirectory, undefined);
    assert.match(tools.find(tool => tool.name === 'piclite_compress').inputSchema.properties.paths.items.description, /relative/);

    const animation = apngFixture();
    await writeFile(join(workspace, 'input', 'animation.apng'), animation);
    const apng = await client.callTool({ name: 'piclite_compress', arguments: { paths: ['input/animation.apng'] } });
    assert.notEqual(apng.isError, true, JSON.stringify(apng));
    const [apngOutput] = apng.structuredContent.result;
    assert.match(apngOutput.output, /^output\/job-[^/]+\/animation-piclite\.png$/);
    verifyCompressedApng(animation, await readFile(join(workspace, apngOutput.output)));
    await writeFile(join(workspace, 'input', 'animated.webp'), animatedWebpFixture());
    const conversion = await client.callTool({ name: 'piclite_convert', arguments: { paths: ['input/animated.webp'], format: 'image/gif' } });
    const [gifOutput] = conversion.structuredContent.result;
    assert.ok(gifOutput.output?.endsWith('.gif'), JSON.stringify(gifOutput));
    await verifyWebpToGif(await readFile(join(workspace, gifOutput.output)));

    const inspected = await client.callTool({ name: 'piclite_inspect', arguments: { path: 'input/vector.svg' } });
    assert.notEqual(inspected.isError, true, JSON.stringify(inspected));
    assert.equal(inspected.structuredContent.result.format, 'Svg');
    const compressed = await client.callTool({ name: 'piclite_compress', arguments: {
      paths: ['input/vector.svg'], format: 'image/svg+xml',
    } });
    assert.notEqual(compressed.isError, true, JSON.stringify(compressed));
    assert.match(compressed.structuredContent.result[0].output, /^output\/job-[^/]+\/vector-piclite\.svg$/);
    const converted = await client.callTool({ name: 'piclite_convert', arguments: {
      paths: ['input/vector.svg'], format: 'image/png', scale: 50,
    } });
    assert.notEqual(converted.isError, true, JSON.stringify(converted));
    const output = converted.structuredContent.result[0].output;
    assert.match(output, /^output\/job-[^/]+\/vector-piclite\.png$/);
    const png = await readFile(join(workspace, output));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    const cover = await client.callTool({ name: 'piclite_create_cover', arguments: {
      imagePath: 'input/vector.svg',
      config: { canvasW: 120, canvasH: 80, innerSize: 40, enableShadow: false },
    } });
    assert.notEqual(cover.isError, true, JSON.stringify(cover));
    assert.match(cover.structuredContent.result.path, /^output\/job-[^/]+\/vector-cover\.png$/);
    assert.equal((await readFile(join(workspace, cover.structuredContent.result.path))).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.deepEqual(await readFile(source), sourceBytes, 'compression must preserve the source file');

    const escaped = await client.callTool({ name: 'piclite_inspect', arguments: { path: '../etc/passwd' } });
    assert.equal(escaped.isError, true, 'workspace paths must not escape the mounted directory');
    console.log('PASS remote MCP auth, bounded HTTP, workspace isolation, SVG compression/conversion, cover creation and source preservation');
  } finally {
    await client.close();
  }
} finally {
  if (bridge) {
    bridge.kill('SIGTERM');
    await new Promise(resolve => bridge.once('exit', resolve));
  }
  if (localRoot) await rm(localRoot, { recursive: true, force: true });
}
