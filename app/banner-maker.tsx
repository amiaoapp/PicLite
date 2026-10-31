import { useEffect, useRef } from "react";
import { bindCoverMaterial } from "./cover-material";
import template from "./img2banner-template.html?raw";
import editorStyles from "./cover-editor.css?raw";

export function BannerMaker({ language }: { language: "zh" | "en" }) {
  const cleanup = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => cleanup.current?.(), []);
  const document = template.replace("</head>", `<style>${editorStyles} .theme-inline .theme-btn,.theme-inline .theme-label{display:none!important}</style></head>`);
  return <section style={{ height: "calc(100dvh - 88px)", minHeight: 420, padding: 0 }} aria-label={language === "en" ? "PicLite cover editor" : "PicLite 封面制作"}>
    <iframe onLoad={event => { cleanup.current?.(); cleanup.current = bindCoverMaterial(event.currentTarget); }} title="img2banner 封面制作" srcDoc={document} sandbox="allow-scripts allow-downloads allow-same-origin" style={{ width: "100%", height: "100%", border: 0, display: "block", borderRadius: 20 }} />
  </section>;
}
