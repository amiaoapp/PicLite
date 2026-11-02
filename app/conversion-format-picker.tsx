"use client";

import { CheckIcon } from "@phosphor-icons/react";
import "./conversion-format-picker.css";

const commonFormats = [
  { value: "image/webp", label: "WebP", zh: "网页与日常分享", en: "Web & everyday sharing" },
  { value: "image/jpeg", label: "JPEG", zh: "照片与广泛兼容", en: "Photos & compatibility" },
  { value: "image/png", label: "PNG", zh: "透明背景与清晰线条", en: "Transparency & sharp edges" },
  { value: "image/avif", label: "AVIF", zh: "更高压缩效率", en: "Efficient compression" },
];

export function ConversionFormatPicker({ value, onChange, language, options, disabled = false, id }: {
  value: string; onChange: (value: string) => void; language: "zh" | "en";
  options: { value: string; label: string }[]; disabled?: boolean; id?: string;
}) {
  const zh = language === "zh";
  return <div className="conversion-format-picker">
    <div className="conversion-format-title"><span>{zh ? "输出格式" : "Output format"}</span><small>{options.find(option => option.value === value)?.label}</small></div>
    <div className="conversion-format-grid" role="group" aria-label={zh ? "常用输出格式" : "Common output formats"}>
      {commonFormats.filter(format => options.some(option => option.value === format.value)).map(format => <button type="button" key={format.value} aria-pressed={format.value === value} disabled={disabled} onClick={() => onChange(format.value)}>
        <strong>{format.label}</strong><CheckIcon size={16} weight="bold" aria-hidden="true" /><span>{zh ? format.zh : format.en}</span>
      </button>)}
    </div>
    <label className="conversion-all-formats"><span>{zh ? "全部格式" : "All formats"}</span><select id={id} disabled={disabled} value={value} onChange={event => onChange(event.target.value)}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
  </div>;
}
