import { useState } from "react";
import { Icon } from "./clop-icons";
import { normalizeClipboardExcludedApps } from "./clipboard-source-settings";
import "./clipboard-source-controls.css";

type Props = {
  language: "zh" | "en";
  office: boolean;
  apps: string[];
  onOfficeChange: (enabled: boolean) => void;
  onAppsChange: (apps: string[]) => void;
};
export function ClipboardSourceControls({ language, office, apps, onOfficeChange, onAppsChange }: Props) {
  const [draft, setDraft] = useState("");
  const text = (zh: string, en: string) => language === "zh" ? zh : en;
  const add = () => {
    if (!draft.trim()) return;
    onAppsChange(normalizeClipboardExcludedApps([...apps, ...draft.split(/[,，;；\n]/)]));
    setDraft("");
  };
  return <div className="clipboard-source-controls">
    <div className="clipboard-source-row"><div><strong>{text("忽略 Office 复制内容", "Ignore clipboard content from Office")}</strong><small>{text("Excel、OneNote、Word、PowerPoint、Outlook 等应用的复制内容不自动压缩", "Skip automatic compression for copies from Excel, OneNote, Word, PowerPoint, Outlook and other Office apps")}</small></div><button type="button" className={`switch ${office ? "on" : ""}`} role="switch" aria-checked={office} aria-label={text("忽略 Office 复制内容", "Ignore clipboard content from Office")} onClick={() => onOfficeChange(!office)}><i /></button></div>
    <div className="clipboard-source-custom"><strong>{text("其他排除应用", "Other excluded apps")}</strong><small>{text("填写应用名称、macOS Bundle ID 或 Windows 程序名（如 EXCEL.EXE）。仅影响自动检测，仍可手动粘贴或压缩。", "Enter an app name, macOS bundle ID or Windows executable (such as EXCEL.EXE). Applies to automatic detection; manual paste and compression remain available.")}</small>
      <div className="clipboard-source-add"><input aria-label={text("排除应用名称", "Excluded app name")} placeholder={text("例如：备忘录 / Notes / custom.exe", "For example: Notes / com.apple.Notes / custom.exe")} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); add(); } }} /><button type="button" disabled={!draft.trim()} onClick={add}>{text("添加", "Add")}</button></div>
      {apps.length > 0 && <ul className="clipboard-source-apps">{apps.map(app => <li key={app}><span>{app}</span><button type="button" aria-label={text(`移除 ${app}`, `Remove ${app}`)} onClick={() => onAppsChange(apps.filter(value => value !== app))}><Icon name="close" /></button></li>)}</ul>}
    </div>
  </div>;
}
