export const MAX_BATCH_CONCURRENCY = 32;
export const DEFAULT_BATCH_CONCURRENCY = 4;
export const BATCH_CONCURRENCY_KEY = "piclite.batchConcurrency.v1";
export const BATCH_MEMORY_QUEUE_KEY = "piclite.batchMemoryQueue.v1";
const MIB = 1024 ** 2;

export type SystemMemory = { totalBytes: number; availableBytes: number };
export type BatchMemoryQueue = { staticBytes: number[]; animationBytes: number };

export function normalizeBatchConcurrency(value: number) {
  return Number.isFinite(value)
    ? Math.max(1, Math.min(MAX_BATCH_CONCURRENCY, Math.round(value)))
    : DEFAULT_BATCH_CONCURRENCY;
}

export function readBatchConcurrency() {
  try {
    const stored = window.localStorage.getItem(BATCH_CONCURRENCY_KEY);
    return stored === null ? DEFAULT_BATCH_CONCURRENCY : normalizeBatchConcurrency(Number(stored));
  } catch {
    return DEFAULT_BATCH_CONCURRENCY;
  }
}

export function estimateImageMemory(width: number, height: number, bytes: number) {
  // Allow for decoded pixels, intermediate raster buffers and copies of the
  // encoded source across the renderer and native bridge.
  return 16 * MIB + width * height * 24 + bytes * 4;
}

export function summarizeBatchMemory(items: readonly { width: number; height: number; originalBytes: number; animated?: boolean }[]): BatchMemoryQueue {
  let animationBytes = 0;
  const staticBytes: number[] = [];
  for (const item of items) {
    const bytes = estimateImageMemory(item.width, item.height, item.originalBytes);
    if (item.animated) animationBytes = Math.max(animationBytes, bytes);
    else staticBytes.push(bytes);
  }
  return { staticBytes: staticBytes.sort((a, b) => b - a).slice(0, MAX_BATCH_CONCURRENCY), animationBytes };
}

export function estimateBatchMemory(queue: BatchMemoryQueue, concurrency: number) {
  const slots = normalizeBatchConcurrency(concurrency);
  if (queue.staticBytes.length || queue.animationBytes) {
    const staticPeak = queue.staticBytes.slice(0, slots).reduce((sum, bytes) => sum + bytes, 0);
    return Math.max(staticPeak, queue.animationBytes);
  }
  return slots * estimateImageMemory(4000, 3000, 4 * MIB);
}

export function projectedMemoryUsage(memory: SystemMemory, additionalBytes: number) {
  return (memory.totalBytes - memory.availableBytes + additionalBytes) / memory.totalBytes;
}

export async function runCompressionBatch<T extends { animated?: boolean }, R>(
  items: readonly T[], concurrency: number, run: (item: T) => Promise<R>,
): Promise<R[]> {
  const slots = normalizeBatchConcurrency(concurrency);
  const results: R[] = [];
  let cursor = 0;
  while (cursor < items.length) {
    const first = cursor;
    if (items[first].animated) {
      results[cursor++] = await run(items[first]);
      continue;
    }
    // Animations can hold many decoded frames. Finish the current group
    // before starting one, even when the user selects multiple workers.
    let end = first + 1;
    while (end < items.length && !items[end].animated) end++;
    let failed = false;
    const workers = Array.from({ length: Math.min(slots, end - first) }, async () => {
      try {
        while (!failed && cursor < end) {
          const index = cursor++;
          results[index] = await run(items[index]);
        }
      } catch (error) {
        failed = true;
        throw error;
      }
    });
    const settled = await Promise.allSettled(workers);
    const failure = settled.find(result => result.status === "rejected");
    if (failure) throw failure.reason;
  }
  return results;
}
