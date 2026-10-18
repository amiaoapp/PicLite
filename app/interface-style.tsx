"use client";

import { useSyncExternalStore } from "react";

type InterfaceStyle = "classic" | "studio";
const storageKey = "piclite.interfaceStyle.v1";
const eventName = "piclite:interface-style";
let sessionStyle: InterfaceStyle = "classic";
function read(): InterfaceStyle {
  try { return localStorage.getItem(storageKey) === "studio" ? "studio" : "classic"; } catch { return sessionStyle; }
}
function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(eventName, listener);
  return () => { window.removeEventListener("storage", listener); window.removeEventListener(eventName, listener); };
}

// This preference only controls presentation. It never writes image settings.
export function useInterfaceStyle() {
  const style = useSyncExternalStore(subscribe, read, (): InterfaceStyle => "classic");
  const choose = (next: InterfaceStyle) => {
    sessionStyle = next;
    try { localStorage.setItem(storageKey, next); } catch { /* Keep the choice for this session. */ }
    window.dispatchEvent(new Event(eventName));
  };
  return [style, choose] as const;
}
export function InterfaceStyleSwitch({ value, onChange, language }: { value: InterfaceStyle; onChange: (value: InterfaceStyle) => void; language: "zh" | "en" }) {
  return <select className="interface-style-control" aria-label={language === "zh" ? "界面样式" : "Interface style"} title={language === "zh" ? "只切换界面外观，保留当前任务和压缩参数" : "Changes appearance while preserving your queue and image settings"} value={value} onChange={event => onChange(event.target.value === "studio" ? "studio" : "classic")}>
    <option value="classic">{language === "zh" ? "经典旧版" : "Classic"}</option>
    <option value="studio">{language === "zh" ? "新版界面" : "Studio"}</option>
  </select>;
}
