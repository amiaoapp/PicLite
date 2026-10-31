import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import yaml from 'js-yaml';
const workflow=yaml.load(readFileSync(new URL('../.github/workflows/release-docker.yml',import.meta.url),'utf8'));

test('each Docker platform builds on its own native architecture',()=>{
 const build=workflow.jobs.build;
 assert.ok(build,'native build matrix is required instead of an emulated multi-platform job');
 assert.deepEqual(build.strategy.matrix.include,[{arch:'amd64',runner:'ubuntu-24.04'},{arch:'arm64',runner:'ubuntu-24.04-arm'}]);
 assert.equal(build['runs-on'],'${{ matrix.runner }}');
 assert.equal(build.strategy['fail-fast'],false);
 assert.ok(build['timeout-minutes']<=25);
 assert.ok(!build.steps.some(step=>step.uses?.includes('setup-qemu')));
 const image=build.steps.find(step=>step.uses?.startsWith('docker/build-push-action@'));
 assert.equal(image.with.platforms,'linux/${{ matrix.arch }}');
 assert.match(image.with.outputs,/push-by-digest=true/);
 assert.equal(image.with.sbom,true);
 assert.equal(image.with.provenance,'mode=max');
 assert.match(image.with['cache-to'],/scope=.*matrix.arch/);
});

test('native images are exercised before their digests permit final publication',()=>{
 const steps=workflow.jobs.build?.steps;
 assert.ok(steps,'native build steps missing');
 const smoke=steps.findIndex(step=>step.name==='Smoke test native image');
 const upload=steps.findIndex(step=>step.uses?.startsWith('actions/upload-artifact@'));
 assert.ok(smoke>=0&&upload>smoke,'run the actual container before publishing a successful digest artifact');
 assert.match(steps[smoke].run,/docker run/);
 assert.match(steps[smoke].run,/fetch\(/);
 assert.match(steps[smoke].run,/\/health|\.State\.Health\.Status/);
 assert.equal(steps[upload].with['if-no-files-found'],'error');
});

test('only the successful two-platform merge advances stable image tags',()=>{
 const merge=workflow.jobs.merge;
 assert.ok(merge,'final manifest merge job is required');
 assert.equal(merge.needs,'build');
 const run=merge.steps.find(step=>step.name==='Publish multi-platform manifest')?.run;
 assert.match(run||'',/imagetools create/);
 assert.match(run,/sha256:/);
 assert.match(run,/2/);
 const metadata=merge.steps.find(step=>step.uses?.startsWith('docker/metadata-action@'));
 assert.match(metadata.with.tags,/value=latest/);
 assert.match(metadata.with.tags,/inputs.version/);
 assert.ok(!workflow.jobs.build.steps.some(step=>step.with?.tags?.includes('latest')),'platform builds must not overwrite latest');
});
