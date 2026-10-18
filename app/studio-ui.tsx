"use client";
import { motion, useReducedMotion, useMotionValue, useTransform } from "motion/react";
import { ArrowUpRightIcon, ArrowDownIcon, ImageIcon, ShieldCheckIcon } from "@phosphor-icons/react";
import type { PointerEvent } from "react";

export function StudioWelcome({ language, choose, sample }: { language: "zh" | "en"; choose: () => void; sample: () => void }) {
  const reduced = useReducedMotion(); const pointer = useMotionValue(0); const rotate = useTransform(pointer, [-1, 1], [-3, 3]);
  const t = (zh: string, en: string) => language === "en" ? en : zh;
  const move = (event: PointerEvent<HTMLDivElement>) => { if (reduced) return; const rect = event.currentTarget.getBoundingClientRect(); pointer.set((event.clientX - rect.left) / rect.width * 2 - 1); };
  return <motion.div className="studio-welcome" initial={reduced ? false : { opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .65, ease: [.22, 1, .36, 1] }}>
    <div className="studio-welcome-heading"><h1>{t("好画质，", "Keep the detail.")}<br /><span>{t("轻一点。", "Lose the weight.")}</span></h1><p>{t("把体积留给空间，把细节留给图片。", "More space. Every detail intact.")}</p></div>
    <div className="studio-photo-button" onPointerMove={move} onPointerLeave={() => pointer.set(0)}>
      <motion.figure style={{ rotateZ: reduced ? 0 : rotate }} whileHover={reduced ? {} : { y: -5 }} transition={{ type: "spring", stiffness: 180, damping: 22 }}>
        <img src={`${import.meta.env?.BASE_URL || "/"}studio-coast.webp`} width="1536" height="1024" alt={t("黑色岩岸上的海浪，界面装饰图", "Ocean foam on a volcanic coast. Decorative artwork.")} />
        <figcaption><span>PicLite · {t("影像工作台", "Image workspace")}</span><ArrowUpRightIcon size={18} /></figcaption>
      </motion.figure>
    </div>
    <div className="studio-import"><button type="button" onClick={choose}><ImageIcon size={20} /><span>{t("选择图片", "Choose images")}</span><ArrowUpRightIcon size={18} /></button><small>{t("也可以直接拖入 · ⌘ / Ctrl + V 粘贴", "Or drop files here · ⌘ / Ctrl + V to paste")}</small><button type="button" className="studio-demo-link" onClick={sample}>{t("载入原有演示图片", "Load the built-in demo image")}</button></div>
  </motion.div>;
}
export function StudioStatus({ count, saving, language }: { count: number; saving: string; language: "zh" | "en" }) {
  return <div className="studio-status"><span><ShieldCheckIcon size={14} />{language === "zh" ? "图片留在本机" : "Images stay local"}</span><span>{count ? `${count} ${language === "zh" ? "张图片" : "images"}` : language === "zh" ? "准备就绪" : "Ready"}</span><span><ArrowDownIcon size={12} />{saving}</span></div>;
}
