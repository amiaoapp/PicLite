"use client";
/* eslint-disable @next/next/no-img-element -- locally owned result Blob URLs */
import { useEffect, useState } from "react";
import { ArrowClockwise, ArrowRight, Copy, DownloadSimple, GearSix, SplitHorizontal, X } from "@phosphor-icons/react";
import { useFloatingTone } from "../desktop/use-floating-tone";
import "./browser-floating-result.css";

type Result = { id: string; name: string; sourceUrl: string; outputUrl?: string; originalBytes: number; outputBytes?: number; outputType?: string; width: number; height: number; outputWidth?: number; outputHeight?: number };
type Props = { item: Result; count: number; style: "immersive" | "classic"; seconds: number; language: "zh" | "en"; busy: boolean; onDismiss: () => void; onNext: () => void; onCopy: () => void; onSave: () => void; onProcess: () => void; onInspect: () => void; onSettings: () => void };

export function BrowserFloatingResult({ item, count, style, seconds, language, busy, onDismiss, onNext, onCopy, onSave, onProcess, onInspect, onSettings }: Props) {
  const src = item.outputUrl || item.sourceUrl;
  const tone = useFloatingTone(src);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  const t = (zh: string, en: string) => language === "en" ? en : zh;
  useEffect(() => {
    if (!seconds || hovered || focused || busy) return;
    const timer = window.setTimeout(onDismiss, seconds * 1000);
    return () => window.clearTimeout(timer);
  }, [item.id, src, seconds, hovered, focused, busy, onDismiss]);
  const bytes = (value: number) => value < 1024 ? `${value} B` : value < 1048576 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1048576).toFixed(1)} MB`;
  const actions = [
    [t("复制图片", "Copy image"), Copy, onCopy],
    [t("保存图片", "Save image"), DownloadSimple, onSave],
    [t("重新压缩", "Optimise again"), ArrowClockwise, onProcess],
    [t("查看对比", "Compare"), SplitHorizontal, onInspect],
    [t("下一张结果", "Next result"), ArrowRight, onNext],
    [t("悬浮窗设置", "Floating settings"), GearSix, onSettings],
  ] as const;
  const footerActions = [actions[0], actions[1], actions[3], actions[5], actions[4], [t("关闭悬浮结果", "Dismiss floating result"), X, onDismiss]] as const;
  const format = (item.outputType || "image").split("/").pop()?.toUpperCase();
  return <aside className={`browser-floating-result style-${style}`} data-tone={tone} data-controls-visible={hovered || focused || undefined} data-result-id={item.id} role="region" aria-label={t("悬浮压缩结果", "Floating optimisation result")} onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)} onFocusCapture={() => setFocused(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}>
    <img className="browser-floating-image" src={src} alt={t("压缩结果预览", "Optimised result preview")} />
    <header className="browser-floating-header">
      <button type="button" aria-label={t("关闭悬浮结果", "Dismiss floating result")} onClick={onDismiss}><X aria-hidden="true" /></button>
      <span aria-live="polite">{t("处理完成", "Optimised")} · {count}</span>
    </header>
    <div className="browser-floating-actions">{actions.map(([label, Icon, action], index) => <button key={label} type="button" title={label} aria-label={label} disabled={busy || (index === 4 && count < 2)} onClick={action}><Icon aria-hidden="true" weight="regular" /></button>)}</div>
    <div className="browser-floating-bottom">
      <div className="browser-floating-metrics"><span>{bytes(item.originalBytes)} → <strong>{bytes(item.outputBytes ?? item.originalBytes)}</strong></span><small>{item.outputWidth || item.width} × {item.outputHeight || item.height} · {format}</small></div>
      <span className="browser-floating-format" aria-label={t("当前输出格式", "Current output format")}>{format}</span>
    </div>
    <footer className="browser-floating-footer" aria-label={t("结果操作", "Result actions")}>
      {footerActions.map(([label, Icon, action], index) => <button key={label} type="button" title={label} aria-label={label} disabled={(busy && index !== 5) || (index === 4 && count < 2)} onClick={action}><Icon aria-hidden="true" weight="regular" /></button>)}
    </footer>
  </aside>;
}
