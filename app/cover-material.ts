import glassCss from "./liquid-glass.css?raw";

const coverCss = `
html[data-material="glass"] { --bg: var(--paper); --card: var(--glass-solid); --muted: var(--glass-muted); --accent: var(--deep); }
html[data-material="glass"] body { background: var(--paper); color: var(--ink); }
html[data-material="glass"] .panel { background: linear-gradient(145deg,var(--glass-highlight),transparent 48%),var(--glass-solid); border: 1px solid var(--glass-edge); box-shadow:var(--glass-shadow); }
html[data-material="glass"] :is(.module-group,.preset-bar,.uploader,.editor-area) { background:var(--glass-solid); border-color:var(--glass-edge); }
html[data-material="glass"] :is(.module-title,.control-row label) { color:var(--ink); }
html[data-material="glass"] :is(input[type=number],input[type=text],select,.btn) { background:var(--glass-solid); color:var(--ink); border:1px solid var(--glass-edge); }
html[data-material="glass"] .btn.primary { background:var(--deep); color:var(--paper); }
html[data-material="glass"] :is(button,input,select):focus-visible { outline:2px solid var(--deep); outline-offset:3px; }
@media(prefers-reduced-motion:reduce) { html[data-material="glass"] * { transition:none; } }
`;

/** Bind only to PicLite's trusted same-origin srcDoc cover iframe, after load.
 * Returns cleanup; never access or inject into arbitrary plugin/external frames.
 * Presentation CSS never touches the canvas drawing or exported cover pixels. */
export function bindCoverMaterial(frame: HTMLIFrameElement, source = document.documentElement): () => void {
  const target = frame.contentDocument;
  if (!target) return () => {};
  const root = target.documentElement;
  const previous = target.getElementById("piclite-cover-material");
  previous?.remove();
  const style = target.createElement("style");
  style.id = "piclite-cover-material";
  style.textContent = glassCss + coverCss + " .theme-inline .theme-btn,.theme-inline .theme-label{display:none!important}";
  target.head.appendChild(style);
  const tokens = ["--ink", "--paper", "--deep", "--surface", "--line"];
  const sync = () => {
    for (const attribute of ["data-theme", "data-palette", "data-material", "data-transparency", "data-platform"]) {
      const value = source.getAttribute(attribute);
      if (value === null) root.removeAttribute(attribute); else root.setAttribute(attribute, value);
    }
    const computed = getComputedStyle(source);
    for (const token of tokens) root.style.setProperty(token, computed.getPropertyValue(token));
    root.style.colorScheme = source.dataset.theme === "dark" ? "dark" : "light";
  };
  sync();
  const observer = new MutationObserver(sync);
  observer.observe(source, { attributes: true, attributeFilter: ["data-theme", "data-palette", "data-material", "data-transparency", "data-platform", "style"] });
  return () => { observer.disconnect(); style.remove(); };
}
