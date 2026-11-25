"use client";

import { useEffect, useId, useState } from "react";
import {
  BATCH_CONCURRENCY_KEY, BATCH_MEMORY_QUEUE_KEY, DEFAULT_BATCH_CONCURRENCY, MAX_BATCH_CONCURRENCY,
  estimateBatchMemory, normalizeBatchConcurrency, projectedMemoryUsage, readBatchConcurrency,
  type BatchMemoryQueue, type SystemMemory,
} from "./batch-compression";
import "./batch-performance-settings.css";

const EMPTY_QUEUE: BatchMemoryQueue = { staticBytes: [], animationBytes: 0 };

export function BatchPerformanceSettings({ language, queue, readMemory }: {
  language: "zh" | "en";
  queue?: BatchMemoryQueue;
  readMemory?: () => Promise<SystemMemory | null>;
}) {
  const id = useId();
  const [concurrency, setConcurrency] = useState(DEFAULT_BATCH_CONCURRENCY);
  const [desktopQueue, setDesktopQueue] = useState(EMPTY_QUEUE);
  const [memory, setMemory] = useState<SystemMemory | null>(null);
  const [readingMemory, setReadingMemory] = useState(Boolean(readMemory));
  const t = (zh: string, en: string) => language === "zh" ? zh : en;

  useEffect(() => {
    const sync = () => {
      setConcurrency(readBatchConcurrency());
      if (queue) return;
      try {
        const saved = window.localStorage.getItem(BATCH_MEMORY_QUEUE_KEY);
        const summary = saved ? JSON.parse(saved) as BatchMemoryQueue : EMPTY_QUEUE;
        setDesktopQueue(Array.isArray(summary?.staticBytes) && Number.isFinite(summary.animationBytes) ? summary : EMPTY_QUEUE);
      } catch {
        setDesktopQueue(EMPTY_QUEUE);
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === BATCH_MEMORY_QUEUE_KEY || event.key === BATCH_CONCURRENCY_KEY) sync();
    };
    sync();
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [queue]);

  useEffect(() => {
    if (!readMemory) return;
    let disposed = false;
    const refresh = async () => {
      const current = await readMemory().catch(() => null);
      if (disposed) return;
      setMemory(current?.totalBytes && current.availableBytes >= 0 && current.availableBytes <= current.totalBytes ? current : null);
      setReadingMemory(false);
    };
    void refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [readMemory]);

  const workload = queue ?? desktopQueue;
  const estimate = estimateBatchMemory(workload, concurrency);
  const predictedUsage = memory ? projectedMemoryUsage(memory, estimate) : null;
  const hasAnimation = workload.animationBytes > 0;
  const highMemory = predictedUsage !== null && predictedUsage > 0.8;
  const bytes = (value: number) => value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(1)} GiB` : `${Math.ceil(value / 1024 ** 2)} MiB`;
  const setWorkers = (value: number) => {
    const slots = normalizeBatchConcurrency(value);
    window.localStorage.setItem(BATCH_CONCURRENCY_KEY, String(slots));
    setConcurrency(slots);
  };

  return <div className="batch-performance">
    <div className="batch-performance-control">
      <label htmlFor={id}>{t("批量压缩并发", "Batch compression concurrency")}</label>
      <output htmlFor={id}>{t(`${concurrency} 路`, `${concurrency} at a time`)}</output>
      <input id={id} type="range" min="1" max={MAX_BATCH_CONCURRENCY} step="1" value={concurrency}
        aria-describedby={`${id}-memory`} onChange={event => setWorkers(event.currentTarget.valueAsNumber)} />
    </div>
    <div id={`${id}-memory`} className="batch-performance-memory" aria-live="polite">
      <div><span>{t("预计新增内存", "Estimated additional memory")}</span><strong>{hasAnimation ? "≥ " : "≈ "}{bytes(estimate)}</strong></div>
      {!workload.staticBytes.length && !hasAnimation && <small>{t("暂无图片，按每张 1200 万像素估算。", "Queue is empty. Estimated using 12-megapixel images.")}</small>}
      {memory && <div><span>{t("系统可用内存", "Available system memory")}</span><strong>{bytes(memory.availableBytes)} / {bytes(memory.totalBytes)}</strong></div>}
      {!memory && <small>{readingMemory ? t("正在读取系统内存…", "Reading system memory…") : t("此环境无法读取实时系统内存。", "Live system memory is unavailable in this environment.")}</small>}
      {highMemory && <small className="batch-performance-warning">{t(`预计总内存需求超过 80%（约 ${Math.ceil(predictedUsage * 100)}%）。`, `Estimated demand exceeds 80% of system memory (about ${Math.ceil(predictedUsage * 100)}%).`)}</small>}
      {hasAnimation && <small>{t("动图逐张处理，实际内存随帧数增加。", "Animations run one at a time and may use more memory depending on their frame count.")}</small>}
    </div>
  </div>;
}
