import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import gifenc from 'gifenc';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const binary = process.env.PICLITE_BINARY || resolve('src-tauri/target/debug/piclite');
const directory = await mkdtemp(join(tmpdir(), 'piclite-mcp-'));
const gif = gifenc.GIFEncoder();
for (let frame=0;frame<4;frame++) gif.writeFrame(new Uint8Array(64*48).fill(frame%2),64,48,{palette:[[255,0,0],[0,0,255]],delay:80+frame*10,repeat:0});
gif.finish();
const source=join(directory,'animation.gif');
await writeFile(source,gif.bytes());
const original=await readFile(source);
async function verify(client) {
  const list=await client.listTools(); assert.equal(list.tools.length,2);
  const inspect=await client.callTool({name:'piclite_inspect',arguments:{path:source}});
  assert.equal(inspect.isError,false); assert.equal(inspect.structuredContent.result.frames,4);
  const result=await client.callTool({name:'piclite_compress',arguments:{paths:[source],scale:50,format:'image/webp'}});
  assert.equal(result.isError,false);
  const [output]=result.structuredContent.result;
  assert.ok(output.output,JSON.stringify(output));
  const animated=await client.callTool({name:'piclite_inspect',arguments:{path:output.output}});
  assert.equal(animated.structuredContent.result.animated,true);
  assert.equal(animated.structuredContent.result.width,32);
  assert.equal(animated.structuredContent.result.height,24);
  assert.deepEqual(await readFile(source),original);
  assert.equal((await client.callTool({name:'piclite_compress',arguments:{paths:['relative.png']}})).isError,true);
}
const stdio=new Client({name:'piclite-smoke',version:'1.0.0'});
let bridge;
try {
 await stdio.connect(new StdioClientTransport({command:binary,args:['--mcp']})); await verify(stdio); await stdio.close();
 bridge=spawn(process.execPath,['scripts/mcp-http.mjs'],{env:{...process.env,PICLITE_BINARY:binary,PICLITE_MCP_PORT:'3219'},stdio:['ignore','pipe','pipe']});
 await new Promise((res,rej)=>{bridge.stderr.on('data',data=>{if(data.toString().includes('PicLite MCP:'))res();});bridge.on('exit',code=>rej(new Error(`bridge exit ${code}`)));setTimeout(()=>rej(new Error('bridge timeout')),10000).unref();});
 const http=new Client({name:'piclite-http-smoke',version:'1.0.0'});
 await http.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:3219/mcp')));await verify(http);await http.close();
 console.log('PASS: SDK stdio + HTTP handshake, tools, animated compression, dimensions, source preserved, validation');
} finally {await stdio.close();bridge?.kill();await rm(directory,{recursive:true,force:true});}
