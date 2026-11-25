import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_BATCH_CONCURRENCY, estimateBatchMemory, estimateImageMemory,
  normalizeBatchConcurrency, projectedMemoryUsage, runCompressionBatch, summarizeBatchMemory,
} from '../app/batch-compression.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));

test('batch limits and memory estimates use the largest simultaneous jobs', () => {
  assert.equal(DEFAULT_BATCH_CONCURRENCY, 4);
  assert.equal(normalizeBatchConcurrency(33), 32);
  assert.equal(normalizeBatchConcurrency(0), 1);
  const large = { width: 4000, height: 3000, originalBytes: 2_000_000 };
  const small = { width: 100, height: 200, originalBytes: 6000 };
  const queue = summarizeBatchMemory([small, large]);
  const single = estimateImageMemory(large.width, large.height, large.originalBytes);
  assert.equal(estimateBatchMemory(queue, 1), single);
  assert.equal(estimateBatchMemory(queue, 32), single + estimateImageMemory(small.width, small.height, small.originalBytes));
  assert.equal(estimateBatchMemory(summarizeBatchMemory([{ ...large, animated: true }, small]), 32), single);
  assert.equal(projectedMemoryUsage({ totalBytes: 100, availableBytes: 30 }, 10), 0.8);
  assert.ok(projectedMemoryUsage({ totalBytes: 100, availableBytes: 30 }, 11) > 0.8);
});

test('parallel jobs preserve result order and reserve the batch for an animation', async () => {
  const jobs = [0, 1, 2, 3, 4].map(index => ({ index, animated: index === 3 }));
  const active = new Set();
  let peak = 0;
  const finished = await runCompressionBatch(jobs, 2, async job => {
    assert.ok(!active.has(3));
    if (job.animated) assert.equal(active.size, 0);
    active.add(job.index);
    peak = Math.max(peak, active.size);
    if (job.index === 0) await tick();
    await tick();
    active.delete(job.index);
    return job.index;
  });
  assert.equal(peak, 2);
  assert.deepEqual(finished, [0, 1, 2, 3, 4]);
});

test('a failed batch stops admitting jobs and waits for in-flight work', async () => {
  const error = Error('failed');
  const started = [];
  let secondFinished = false;
  await assert.rejects(runCompressionBatch([0, 1, 2].map(index => ({ index, animated: false })), 2, async ({ index }) => {
    started.push(index);
    if (index === 0) throw error;
    await tick();
    secondFinished = true;
  }), error);
  assert.deepEqual(started, [0, 1]);
  assert.equal(secondFinished, true);
});
