import { timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, mkdtemp, open, readFile, realpath, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { basename, extname, join, relative } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const token = process.env.PICLITE_MCP_TOKEN;
if (!token || !/^[A-Za-z0-9._~-]{32,256}$/.test(token)) {
  throw new Error('Set PICLITE_MCP_TOKEN to a random token of at least 32 URL-safe characters');
}
const expectedAuth = Buffer.from(`Bearer ${token}`);
const root = await realpath(process.env.PICLITE_MCP_WORKSPACE || '/workspace');
const folders = { input: join(root, 'input'), output: join(root, 'output') };
for (const folder of Object.values(folders)) {
  if (!(await lstat(folder)).isDirectory() || await realpath(folder) !== folder) {
    throw new Error('The workspace must have real input and output directories');
  }
}
await access(folders.input, constants.R_OK | constants.X_OK);
await access(folders.output, constants.W_OK | constants.X_OK);

const extensions = new Set('jpg jpeg jfif png apng webp gif avif bmp tif tiff ico qoi tga heic heif svg ppm pam'.split(' '));
const MiB = 1024 * 1024;
const maxBatch = 20;
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const client = new Client({ name: 'piclite-docker', version });
await client.connect(new StdioClientTransport({
  command: process.env.PICLITE_BINARY || '/usr/local/bin/piclite', args: ['--mcp'], stderr: 'inherit',
  env: { RAYON_NUM_THREADS: process.env.RAYON_NUM_THREADS || '2' },
}));
const { tools } = await client.listTools();
const fileDescription = 'Workspace-relative file path under input/ or output/. Do not use a URL or absolute path.';
const remoteTools = tools.map(tool => {
  const properties = { ...tool.inputSchema.properties };
  for (const name of ['path', 'imagePath', 'presetPath']) {
    if (properties[name]) properties[name] = { type: 'string', description: fileDescription };
  }
  if (properties.paths) properties.paths = {
    ...properties.paths,
    maxItems: maxBatch,
    description: 'Workspace-relative paths under input/ or output/.',
    items: { ...properties.paths.items, description: fileDescription },
  };
  delete properties.outputDirectory;
  delete properties.outputPath;
  return { ...tool, inputSchema: { ...tool.inputSchema, properties }, description:
    `${tool.description} Use workspace-relative paths. New files are written into a unique output/ subdirectory.` };
});

class WorkspaceError extends Error {}

async function workspaceFile(name, preset = false) {
  const parts = typeof name === 'string' && name.length <= 4096 ? name.split('/') : [];
  const [folder, ...segments] = parts;
  if (!Object.hasOwn(folders, folder) || !segments.length ||
      segments.some(part => !part || part.startsWith('.') || part.includes('\\') ||
        [...part].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))) {
    throw new WorkspaceError('Use a relative path under input/ or output/ without hidden components');
  }
  const extension = extname(name).slice(1).toLowerCase();
  if (preset ? extension !== 'json' : !extensions.has(extension)) {
    throw new WorkspaceError(preset ? 'The preset must be a JSON file' : 'Use a supported image file');
  }
  let path = folders[folder];
  let stat;
  for (const [index, part] of segments.entries()) {
    path = join(path, part);
    stat = await lstat(path).catch(() => null);
    if (index === segments.length - 1 ? !stat?.isFile() || stat.nlink !== 1 : !stat?.isDirectory()) {
      throw new WorkspaceError('File not found or link is not allowed in the workspace');
    }
  }
  if (stat.size > (preset ? MiB : 32 * MiB)) throw new WorkspaceError('Workspace file exceeds the size limit');
  return { path, size: stat.size };
}

async function coverConfig(args) {
  let preset = {};
  if (args.presetPath !== undefined) {
    const { path } = await workspaceFile(args.presetPath, true);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const buffer = Buffer.alloc(MiB + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > MiB) throw new WorkspaceError('Preset exceeds 1 MiB');
      const data = JSON.parse(buffer.toString('utf8', 0, bytesRead));
      if (data?.ui && typeof data.ui === 'object' && !Array.isArray(data.ui)) {
        preset = { ...data.ui, ...(data.crop && { crop: data.crop }) };
      }
    } catch (error) {
      if (error instanceof SyntaxError) throw new WorkspaceError('Invalid preset JSON');
      throw error;
    } finally { await handle.close(); }
  }
  if (args.config !== undefined && (!args.config || typeof args.config !== 'object' || Array.isArray(args.config))) {
    throw new WorkspaceError('config must be an object');
  }
  const config = { ...preset, ...args.config };
  if (Object.hasOwn(config, 'backgroundImagePath')) {
    config.backgroundImagePath = (await workspaceFile(config.backgroundImagePath)).path;
  }
  return config;
}

const errorResult = text => ({ isError: true, content: [{ type: 'text', text }] });
const toRelative = path => relative(root, path);
const sanitize = text => typeof text === 'string' ? text.replaceAll(`${root}/`, '') : text;
let busy = false;
async function parseHttpBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MiB) throw new WorkspaceError('MCP request exceeds 1 MiB');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new WorkspaceError('MCP request must contain valid JSON'); }
}

async function callTool({ name, arguments: args = {} }) {
  const tool = remoteTools.find(tool => tool.name === name);
  if (!tool || !['piclite_inspect', 'piclite_compress', 'piclite_convert', 'piclite_create_cover'].includes(name)) {
    return errorResult('Unknown tool');
  }
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
      Object.keys(args).some(key => !Object.hasOwn(tool.inputSchema.properties, key))) {
    return errorResult('Unsupported tool arguments; output paths are assigned by the service');
  }
  if (busy) return errorResult('PicLite is processing another request. Retry when it finishes.');
  busy = true;
  let job;
  let keep = false;
  try {
    let params;
    if (name === 'piclite_inspect') {
      params = { path: (await workspaceFile(args.path)).path };
    } else if (name === 'piclite_create_cover') {
      const imagePath = (await workspaceFile(args.imagePath)).path;
      const config = await coverConfig(args);
      job = await mkdtemp(join(folders.output, 'job-'));
      params = { imagePath, config, outputPath: join(job, `${basename(imagePath, extname(imagePath))}-cover.png`) };
    } else {
      if (!Array.isArray(args.paths) || !args.paths.length || args.paths.length > maxBatch) {
        throw new WorkspaceError(`Provide 1-${maxBatch} workspace-relative image paths`);
      }
      const files = await Promise.all(args.paths.map(path => workspaceFile(path)));
      if (files.reduce((total, file) => total + file.size, 0) > 64 * MiB) {
        throw new WorkspaceError('Batch exceeds 64 MiB');
      }
      job = await mkdtemp(join(folders.output, 'job-'));
      params = { ...args, paths: files.map(file => file.path), outputDirectory: job };
    }

    const response = await client.callTool({ name, arguments: params }, undefined, { timeout: 300_000 });
    if (response.isError) return errorResult(sanitize(response.content[0]?.text) || 'Image processing failed');
    const { result } = response.structuredContent;
    if (Array.isArray(result)) {
      for (const entry of result) {
        entry.source = toRelative(entry.source);
        if (entry.output) { entry.output = toRelative(entry.output); keep = true; }
        entry.error = sanitize(entry.error);
      }
    } else {
      result.path = toRelative(result.path);
      keep = name === 'piclite_create_cover';
    }
    return { structuredContent: { result }, content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (error) {
    if (error instanceof WorkspaceError) return errorResult(error.message);
    if (error.code === -32001) {
      // A timed-out native call may still be working. Restart before admitting another job.
      console.error('PicLite native call timed out');
      process.exit(1);
    }
    console.error('PicLite processing error', error.code ?? error.name);
    return errorResult('PicLite could not process the request');
  } finally {
    try { if (job && !keep) await rm(job, { recursive: true, force: true }); }
    catch { console.error('PicLite could not clean up a failed job'); }
    busy = false;
  }
}

const http = createServer({ requestTimeout: 30_000, headersTimeout: 10_000 }, async (req, res) => {
  if (req.url === '/healthz' && req.method === 'GET') { res.writeHead(200).end('ok'); return; }
  if (req.url !== '/mcp') { res.writeHead(404).end(); return; }
  if (req.headers.origin !== undefined) { res.writeHead(403).end(); return; }
  const auth = Buffer.from(req.headers.authorization || '');
  if (auth.length !== expectedAuth.length || !timingSafeEqual(auth, expectedAuth)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Bearer realm="PicLite MCP"' }).end(); return;
  }
  if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }).end(); return; }
  let parsedBody;
  try { parsedBody = await parseHttpBody(req); }
  catch (error) {
    res.writeHead(error instanceof WorkspaceError && error.message.includes('1 MiB') ? 413 : 400).end();
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  const server = new Server({ name: 'piclite', version }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: remoteTools }));
  server.setRequestHandler(CallToolRequestSchema, request => callTool(request.params));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { void server.close().catch(() => {}); });
  try { await server.connect(transport); await transport.handleRequest(req, res, parsedBody); }
  catch {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});

let stopping = false;
client.onclose = () => {
  if (!stopping) { console.error('PicLite native process exited'); process.exit(1); }
};
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
  stopping = true;
  http.close();
  await client.close();
  process.exit(0);
});
http.on('listening', () => console.error(`PicLite Docker MCP listening on port ${http.address().port}`));
http.listen(Number(process.env.PICLITE_MCP_PORT || 3210), process.env.PICLITE_MCP_HOST || '127.0.0.1');
