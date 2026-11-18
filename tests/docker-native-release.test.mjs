import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import yaml from 'js-yaml';
const workflow=yaml.load(readFileSync(new URL('../.github/workflows/release-docker.yml',import.meta.url),'utf8'));

test('each Docker platform builds on its own native architecture',()=>{
 const build=workflow.jobs.build;
 assert.ok(build,'native build matrix is required instead of an emulated multi-platform job');
 assert.deepEqual(build.strategy.matrix.include,[
  {arch:'amd64',runner:'ubuntu-24.04',target:'runner',image:'piclite'},
  {arch:'arm64',runner:'ubuntu-24.04-arm',target:'runner',image:'piclite'},
  {arch:'amd64',runner:'ubuntu-24.04',target:'mcp',image:'piclite-mcp'},
  {arch:'arm64',runner:'ubuntu-24.04-arm',target:'mcp',image:'piclite-mcp'},
 ]);
 assert.equal(build['runs-on'],'${{ matrix.runner }}');
 assert.equal(build.strategy['fail-fast'],false);
 assert.ok(build['timeout-minutes']<=45);
 assert.ok(!build.steps.some(step=>step.uses?.includes('setup-qemu')));
 const image=build.steps.find(step=>step.uses?.startsWith('docker/build-push-action@'));
 assert.equal(image.with.platforms,'linux/${{ matrix.arch }}');
 assert.match(image.with.outputs,/push-by-digest=true/);
 assert.equal(image.with.target,'${{ matrix.target }}');
 assert.equal(image.with.sbom,true);
 assert.equal(image.with.provenance,'mode=max');
 assert.match(image.with['cache-to'],/scope=.*matrix.arch/);
});

test('native web and MCP images are exercised before their digests permit final publication',()=>{
 const steps=workflow.jobs.build?.steps;
 assert.ok(steps,'native build steps missing');
 const smoke=steps.findIndex(step=>step.name==='Smoke test native image and amd64 browser UI');
 const mcpSmoke=steps.findIndex(step=>step.name==='Smoke test authenticated Docker MCP service');
 const upload=steps.findIndex(step=>step.uses?.startsWith('actions/upload-artifact@')&&step.name==='Upload tested digest');
 assert.ok(smoke>=0&&upload>smoke,'run the actual container before publishing a successful digest artifact');
 assert.match(steps[smoke].run,/docker run/);
 assert.match(steps[smoke].run,/fetch\(/);
 assert.match(steps[smoke].run,/\/health|\.State\.Health\.Status/);
 assert.ok(mcpSmoke>=0&&upload>mcpSmoke,'test MCP authentication and image processing before publishing its digest');
 assert.match(steps[mcpSmoke].run,/tests\/mcp-docker-smoke\.mjs/);
 assert.match(steps[mcpSmoke].run,/PICLITE_MCP_TOKEN/);
 assert.match(steps[mcpSmoke].run,/docker run/);
 assert.equal(steps[upload].with['if-no-files-found'],'error');
 assert.match(steps[smoke].run,/node tests\/docker-ui-smoke\.mjs/);
 assert.match(steps[smoke].run,/-p 127\.0\.0\.1:3456:3456/);
 assert.match(steps[smoke].run,/SMOKE_ARCH.*amd64/);
});

test('only each successful two-platform merge advances stable image tags',()=>{
 const merge=workflow.jobs.merge;
 assert.ok(merge,'final manifest merge job is required');
 assert.equal(merge.needs,'build');
 const run=merge.steps.find(step=>step.name==='Publish multi-platform manifest')?.run;
 assert.match(run||'',/imagetools create/);
 assert.match(run,/sha256:/);
 assert.match(run,/2/);
 assert.match(run,/matrix\.image/);
 assert.deepEqual(merge.strategy.matrix.image,['piclite','piclite-mcp']);
 const metadata=merge.steps.find(step=>step.uses?.startsWith('docker/metadata-action@'));
 assert.match(metadata.with.tags,/value=latest/);
 assert.match(metadata.with.tags,/inputs.version/);
 assert.ok(!workflow.jobs.build.steps.some(step=>step.with?.tags?.includes('latest')),'platform builds must not overwrite latest');
});

test('remote MCP Docker service is opt-in and requires a token',()=>{
 const docker=readFileSync(new URL('../docker-compose.yml',import.meta.url),'utf8');
 const mcp=docker.slice(docker.indexOf('  piclite-mcp:'));
 assert.match(mcp,/profiles:\s*\[mcp\]/);
 assert.match(mcp,/PICLITE_MCP_TOKEN:\s*\$\{PICLITE_MCP_TOKEN:-\}/);
 assert.match(mcp,/PICLITE_MCP_BIND:-127\.0\.0\.1/);
 assert.match(mcp,/\/workspace/);
 const dockerfile=readFileSync(new URL('../Dockerfile',import.meta.url),'utf8');
 assert.match(dockerfile,/FROM rust:1-bookworm AS mcp-builder/);
 assert.match(dockerfile,/FROM node:24-bookworm-slim AS mcp/);
 assert.match(dockerfile,/PICLITE_BINARY=\/usr\/local\/bin\/piclite/);
});
