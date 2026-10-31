const coverCss = `
:root { --bg:var(--paper); --card:var(--surface); --muted:var(--host-muted); --accent:var(--deep); }
.theme-inline .theme-btn,.theme-inline .theme-label { display:none!important; }
`;

/** Synchronize the trusted same-origin cover iframe without changing export pixels. */
export function bindCoverMaterial(frame: HTMLIFrameElement, source = document.documentElement): () => void {
  const target = frame.contentDocument;
  if (!target) return () => {};
  const root = target.documentElement;
  target.getElementById("piclite-cover-material")?.remove();
  const style = target.createElement("style");
  style.id = "piclite-cover-material";
  style.textContent = coverCss;
  target.head.appendChild(style);
  const tokens = ["--ink", "--paper", "--deep", "--surface", "--line"];
  const attributes = ["data-theme", "data-palette", "data-platform"];
  const sync = () => {
    for (const attribute of attributes) {
      const value = source.getAttribute(attribute);
      if (value === null) root.removeAttribute(attribute); else root.setAttribute(attribute, value);
    }
    const computed = getComputedStyle(source);
    for (const token of tokens) root.style.setProperty(token, computed.getPropertyValue(token));
    root.style.setProperty("--host-muted", computed.getPropertyValue("--muted"));
    root.style.colorScheme = source.dataset.theme === "dark" ? "dark" : "light";
  };
  sync();
  const observer = new MutationObserver(sync);
  observer.observe(source, { attributes: true, attributeFilter: [...attributes, "style"] });
  return () => { observer.disconnect(); style.remove(); };
}
