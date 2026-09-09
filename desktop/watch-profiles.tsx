import { useState } from "react";
import type { Language, PicLiteBridge, WatchProfile } from "./clop-types";
import { fileName, tr } from "./clop-store";

const folderPattern = String.raw`[【\[]\s*(\d+)\s*-\s*(\d+)\s*[】\]]`;

export function WatchProfiles({ api, language, profiles, onChange, status }: {
  api: PicLiteBridge; language: Language; profiles: WatchProfile[];
  onChange: (profiles: WatchProfile[]) => void; status: string;
}) {
  const [draft, setDraft] = useState<WatchProfile | null>(null);
  const [error, setError] = useState("");
  const t = (zh: string, en: string) => tr(language, zh, en);
  const update = (value: Partial<WatchProfile>) => setDraft((current) => current && { ...current, ...value });
  const save = async () => {
    if (!draft) return;
    const next = [...profiles.filter((profile) => profile.id !== draft.id), draft];
    // Ask the native validator before persisting, so conflicting drafts never replace saved rules.
    const active = next.filter((profile) => profile.enabled);
    try {
      const result = await api.validateWatcher({ ...draft, profiles: draft.enabled ? active : [...active, draft] });
      if (!result.ok) { setError(result.error || t("规则无效", "Invalid rules")); return; }
      onChange(next); setDraft(null); setError("");
    } catch (failure) { setError(String(failure)); }
  };
  return <section className="settings-block">
    <header><h2>{t("文件夹监控任务", "Folder watch tasks")}</h2><p>{status || t("每个任务独立保存规则；添加新图片后自动处理，原图保留。", "Each task saves its own rules. New images are processed and originals are kept.")}</p></header>
    <div className="settings-card">
      {profiles.map((profile) => <div className="settings-row" key={profile.id}><div><strong>{profile.name}</strong><small>{profile.inputFolder}</small><small>{profile.format === "keep" ? t("自动择优", "Automatic") : profile.format.replace("image/", "").toUpperCase()} · {profile.resize ? `${profile.maxWidth} × ${profile.maxHeight}` : `${profile.scale}%`}</small></div><div className="settings-control inline-fields">
        <button className="settings-button" onClick={() => onChange(profiles.map((item) => item.id === profile.id ? { ...item, enabled: !item.enabled } : item))}>{profile.enabled ? t("暂停", "Pause") : t("启用", "Enable")}</button>
        <button className="settings-button" onClick={() => { setDraft(structuredClone(profile)); setError(""); }}>{t("编辑", "Edit")}</button>
        <button className="settings-button danger" onClick={() => { onChange(profiles.filter((item) => item.id !== profile.id)); if (draft?.id === profile.id) setDraft(null); }}>{t("移除", "Remove")}</button>
      </div></div>)}
      <button className="add-path" onClick={async () => {
        const path = await api.selectFolder("input");
        if (path) { setError(""); setDraft({ id: crypto.randomUUID(), name: fileName(path), enabled: true, inputFolder: path, inputFolders: [], outputFolder: "@same-folder", outputSuffix: "-piclite", renameTemplate: "{name}{suffix}", mode: "manual", quality: 86, scale: 100, format: "image/jpeg", resize: false, maxWidth: 1920, maxHeight: 1920, stripMetadata: true, preventLarger: true, onlyWhenNeeded: true, notifyOnComplete: true }); }
      }}>{t("添加监控任务", "Add watch task")}</button>
    </div>
    {draft && <div className="settings-card watch-profile-editor">
      <label>{t("任务名称", "Task name")}<input value={draft.name} onChange={(event) => update({ name: event.target.value })} /></label>
      <label>{t("来源目录（含所有子目录）", "Source folder (recursive)")}<button className="path-button" onClick={async () => { const path = await api.selectFolder("input"); if (path) update({ inputFolder: path }); }}>{draft.inputFolder}</button></label>
      <label>{t("输出位置", "Output location")}<select value={draft.outputFolder === "@same-folder" ? "same" : draft.outputFolder === "" ? "sub" : "fixed"} onChange={async (event) => {
        if (event.target.value === "fixed") { const path = await api.selectFolder("output"); if (path) update({ outputFolder: path }); }
        else update({ outputFolder: event.target.value === "same" ? "@same-folder" : "" });
      }}><option value="same">{t("原图片所在目录", "Beside the original")}</option><option value="sub">{t("根目录下 PicLite 文件夹", "PicLite folder under root")}</option><option value="fixed">{t("选择指定目录…", "Choose output folder…")}</option></select>{draft.outputFolder && draft.outputFolder !== "@same-folder" && <small>{draft.outputFolder}</small>}</label>
      <label>{t("目标格式", "Target format")}<select value={draft.format} onChange={(event) => update({ format: event.target.value, mode: event.target.value === "keep" ? "balanced" : "manual", onlyWhenNeeded: event.target.value === "keep" ? false : draft.onlyWhenNeeded })}><option value="image/jpeg">JPEG / JFIF</option><option value="image/png">PNG</option><option value="image/webp">WebP</option><option value="keep">{t("自动择优压缩", "Automatic compression")}</option></select></label>
      <label>{t("压缩质量", "Quality")}<input type="number" min="1" max="100" value={draft.quality} onChange={(event) => update({ quality: Math.max(1, Math.min(100, +event.target.value || 1)) })} /></label>
      <label>{t("缩放比例 %", "Scale %")}<input type="number" min="1" max="100" value={draft.scale} onChange={(event) => update({ scale: Math.max(1, Math.min(100, +event.target.value || 1)), mode: "manual" })} /></label>
      <label><input type="checkbox" checked={draft.resize} onChange={(event) => update({ resize: event.target.checked, mode: "manual" })} />{t("限制最大尺寸（等比例，不放大）", "Limit dimensions (fit, never upscale)")}</label>
      {draft.resize && <div className="inline-fields"><input aria-label="Maximum width" type="number" min="1" value={draft.maxWidth} onChange={(event) => update({ maxWidth: Math.max(1, +event.target.value || 1) })} /> × <input aria-label="Maximum height" type="number" min="1" value={draft.maxHeight} onChange={(event) => update({ maxHeight: Math.max(1, +event.target.value || 1) })} /></div>}
      <label><input type="checkbox" checked={draft.onlyWhenNeeded ?? false} onChange={(event) => update({ onlyWhenNeeded: event.target.checked })} />{t("仅格式或尺寸不符合时处理（启用父目录命名时仍处理）", "Only process format/size mismatches (folder naming still applies)")}</label>
      <label><input type="checkbox" checked={draft.notifyOnComplete ?? true} onChange={(event) => update({ notifyOnComplete: event.target.checked })} />{t("处理完成后发送系统通知", "Send system notification on completion")}</label>
      <label><input type="checkbox" checked={!!draft.folderRename} onChange={(event) => update({ folderRename: event.target.checked ? { rootFolder: draft.inputFolder, folderPattern, renameTemplate: "{code}_{name}", firstPadding: 2, secondPadding: 2 } : undefined })} />{t("从父目录提取命名内容", "Extract naming content from parent folders")}</label>
      {draft.folderRename ? <>
        <label>{t("文件夹匹配规则", "Folder match pattern")}<input value={draft.folderRename.folderPattern} onChange={(event) => update({ folderRename: { ...draft.folderRename!, folderPattern: event.target.value } })} /><small>{t("数字：(\\d+)-(\\d+)；中文：(风景|人物)；英文：([A-Za-z]+)", "Numbers: (\\d+)-(\\d+); words: ([A-Za-z]+)")}</small></label>
        <label>{t("命名模板", "Filename template")}<input value={draft.folderRename.renameTemplate} onChange={(event) => update({ folderRename: { ...draft.folderRename!, renameTemplate: event.target.value } })} /><small>{"{code}_{name} · {1}_{name} · {1:initial}_{name} · {1:initials}_{name}"}</small></label>
        <label>{t("数字补齐位数", "Numeric padding")}<div className="inline-fields">{(["firstPadding", "secondPadding"] as const).map((key) => <input key={key} aria-label={key} type="number" min="1" max="12" value={draft.folderRename![key]} onChange={(event) => update({ folderRename: { ...draft.folderRename!, [key]: Math.max(1, Math.min(12, +event.target.value || 1)) } })} />)}</div></label>
      </> : <label>{t("命名模板", "Filename template")}<input value={draft.renameTemplate} onChange={(event) => update({ renameTemplate: event.target.value })} /><small>{"{name}{suffix} · {date}_{name} · {width}x{height}_{name}"}</small></label>}
      <div className="inline-fields"><button className="settings-button" onClick={() => void save()}>{t("保存任务", "Save task")}</button><button className="settings-button" onClick={() => { setDraft(null); setError(""); }}>{t("取消", "Cancel")}</button></div>
      {error && <p role="alert">{error}</p>}
    </div>}
  </section>;
}
