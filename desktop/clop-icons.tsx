import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { name: string };

const paths: Record<string, React.ReactNode> = {
  gear: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
  clipboard: <><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4.5V3h6v1.5M8 10h8M8 14h8M8 18h5"/></>,
  folder: <path d="M3 7.5h7l2-2h9v13H3z"/>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="9" r="1.4"/><path d="m5 17 4-4 3 3 2.5-2.5L19 18"/></>,
  drop: <><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M4 18v3h16v-3"/></>,
  zones: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  results: <><rect x="5" y="3" width="14" height="18" rx="3"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
  shortcut: <><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 9h.01M11 9h.01M15 9h.01M7 13h.01M11 13h6M7 17h10"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></>,
  copy: <><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5H5v11h3"/></>,
  eye: <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/></>,
  undo: <><path d="m8 8-4 4 4 4"/><path d="M5 12h8a6 6 0 0 1 6 6"/></>,
  save: <><path d="M5 3h12l2 2v16H5z"/><path d="M8 3v6h8V3M8 17h8"/></>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  clear: <circle cx="12" cy="12" r="8"/>,
  minus: <path d="M5 12h14"/>,
  down15: <><path d="M12 4v12m0 0-4-4m4 4 4-4"/><path d="M5 20h14"/></>,
  external: <><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v7H4V6h7"/></>,
  sliders: <><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2"/><circle cx="15" cy="17" r="2"/></>,
  play: <path d="m8 5 11 7-11 7z"/>,
  stop: <rect x="6" y="6" width="12" height="12" rx="1"/>,
  check: <path d="m5 12 4 4L19 6"/>,
  plus: <path d="M12 5v14M5 12h14"/>,
  menu: <path d="M5 7h14M5 12h14M5 17h14"/>,
  spark: <path d="m12 2 1.5 5.5L19 9l-5.5 1.5L12 16l-1.5-5.5L5 9l5.5-1.5z"/>,
  watermark: <><path d="M12 3s5 5.7 5 10a5 5 0 0 1-10 0c0-4.3 5-10 5-10Z"/><path d="M9.5 14.5c.7 1.2 1.6 1.7 2.8 1.7"/></>,
  upload: <><path d="M12 16V4m0 0-4 4m4-4 4 4"/><path d="M5 14v6h14v-6"/></>,
  gallery: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m6 16 4-4 3 3 2-2 3 3"/><circle cx="16" cy="9" r="1"/></>,
  heart: <path d="M20.8 5.8a5.2 5.2 0 0 0-7.4 0L12 7.2l-1.4-1.4a5.2 5.2 0 0 0-7.4 7.4L12 22l8.8-8.8a5.2 5.2 0 0 0 0-7.4Z"/>,
  globe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.4 2.5 3.7 5.5 3.7 9s-1.3 6.5-3.7 9c-2.4-2.5-3.7-5.5-3.7-9S9.6 5.5 12 3Z"/></>,
  youtube: <><rect x="3" y="6" width="18" height="12" rx="4"/><path d="m10 9 5 3-5 3Z"/></>,
  bilibili: <><path d="m8 3 2 3m6-3-2 3"/><rect x="3" y="6" width="18" height="14" rx="3"/><path d="M8 11v3m8-3v3"/></>,
  douyin: <path d="M14 4v10.5a4 4 0 1 1-3-3.9M14 4c1.1 2.7 2.8 4.2 5 4.5"/>,
  telegram: <><path d="m3 11 17-7-4 16-5-6-4 3 1-5Z"/><path d="m8 12 8-5"/></>,
  "x-social": <><path d="M5 4 19 20M19 4l-6.4 7.4M11.3 12.9 5 20"/></>,
};

export function Icon({ name, ...props }: IconProps) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name] || paths.info}</svg>;
}
