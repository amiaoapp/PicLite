import template from "./img2banner-template.html?raw";

export function BannerMaker({ language: _language }: { language: "zh" | "en" }) {
  return <section style={{ height: "calc(100vh - 72px)", minHeight: 620, padding: 0 }} aria-label="PicLite 封面制作">
    <iframe title="img2banner 封面制作" srcDoc={template} sandbox="allow-scripts allow-downloads allow-same-origin" style={{ width: "100%", height: "100%", border: 0, display: "block" }} />
  </section>;
}
