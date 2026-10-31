import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const command = process.env.PICLITE_BINARY;
if (!command) throw new Error('Set PICLITE_BINARY to the absolute PicLite executable path');
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const client = new Client({ name: 'piclite-http-bridge', version });
await client.connect(new StdioClientTransport({ command, args: ['--mcp'], stderr: 'inherit' }));
const port = Number(process.env.PICLITE_MCP_PORT || 3210);
const token = process.env.PICLITE_MCP_TOKEN;
const http = createServer(async (req, res) => {
  if (req.url !== '/mcp') { res.writeHead(404).end(); return; }
  if (token && req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401).end(); return; }
  if (req.headers.origin && !['http://localhost:' + port, 'http://127.0.0.1:' + port].includes(req.headers.origin)) { res.writeHead(403).end(); return; }
  const server = new Server({ name: 'piclite', version }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, () => client.listTools());
  server.setRequestHandler(CallToolRequestSchema, (request) => client.callTool(request.params));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { void transport.close(); void server.close(); });
  try { await server.connect(transport); await transport.handleRequest(req, res); }
  catch (error) { console.error(error); if (!res.headersSent) res.writeHead(500).end(); }
});
http.listen(port, '127.0.0.1', () => console.error(`PicLite MCP: http://127.0.0.1:${port}/mcp`));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, async () => { http.close(); await client.close(); process.exit(0); });
