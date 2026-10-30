# Optional Liquid Glass material

This is a CSS web approximation inspired by [rdev/liquid-glass-react](https://github.com/rdev/liquid-glass-react), not Apple's native material or a bundled dependency.

## Upstream inspection

Inspected the published npm `liquid-glass-react@1.1.1` README and `dist/index.esm.js` from https://registry.npmjs.org/liquid-glass-react/-/liquid-glass-react-1.1.1.tgz. React >=19 peers match PicLite's React 19.2.6. Upstream explicitly warns that Safari/Firefox only partially support the effect and displacement is not visible. Its implementation uses SVG `feDisplacementMap` color-channel passes, optional generated shader maps, and mouse-position React state. The package's npm repository field is empty; the README links to the GitHub project above.

PicLite runs WKWebView on macOS and already guards against retained backing surfaces during resize. Do not remove that guard. We use static edge lighting and small chrome blur, no distortion filters, mouse tracking, canvas or animation loops. Scrolling panels remain opaque; mobile blur is disabled. No new package or lockfile change is required.

## Parent integration

Global CSS already imports `app/liquid-glass.css`. Mount one controller in every relevant document. Existing application code continues to own `data-theme` (`light`/`dark`), `data-palette`, and `data-platform`.

```tsx
import { LiquidGlassThemeRoot, MaterialControls } from './liquid-glass-theme';

// In PicLiteApp, outside any conditional page branches:
<LiquidGlassThemeRoot />
// In appearance preferences (not just one layout's toolbar):
<MaterialControls language={language} />
```

If the parent wants custom controls instead:

```tsx
const [{ material, transparency }, choose] = useLiquidGlassTheme();
choose({ material: 'glass' }); // 'standard' restores original presentation
choose({ transparency: 'reduce' }); // 'system' follows OS
```

Call `useLiquidGlassTheme` once at the application root OR mount `LiquidGlassThemeRoot`, not both. `MaterialControls` can appear multiple places; it subscribes without mounting root effects. Mount the same controller in `desktop/clop-desktop-app.tsx` for independent floating/preferences documents. The floating agent may consume `--glass-solid`, `--glass-tint`, `--glass-edge`, `--glass-highlight`, `--glass-shadow`, `--glass-blur`, `--glass-muted`, and root `[data-material="glass"]`. Do not add blur to large scrolling content or image canvases. `.glass-surface` is available for small dialogs/popovers.

Storage key: `piclite.interfaceMaterial.v1`, JSON `{material:'standard'|'glass', transparency:'system'|'reduce'}`. Defaults to standard; changes do not write desktop settings, compression fields, queue or palette. Same-document events and cross-window storage events synchronize settings. Blocked storage still permits session-only changes. Reduced transparency is applied when either the user or OS requests it. CSS independently handles reduced transparency, increased contrast, forced colors and reduced motion.

## Cover iframe integration

`app/cover-material.ts` provides `bindCoverMaterial(frame)` for PicLite's trusted same-origin `srcDoc` iframe. It injects the material CSS and cover chrome overrides, copies palette tokens, watches root theme/material attributes, and returns cleanup. It does not alter canvas rendering/export data. Keep an iframe ref and disconnect on replacement/unmount:

```tsx
const cleanup = useRef<(() => void) | undefined>(undefined);
useEffect(() => () => cleanup.current?.(), []);
const onCoverLoad = (event: React.SyntheticEvent<HTMLIFrameElement>) => {
  cleanup.current?.();
  cleanup.current = bindCoverMaterial(event.currentTarget);
};
// Existing iframe:
<iframe onLoad={onCoverLoad} ... />
```

Only bind the trusted cover document. Do not inject into external/plugin frames. Root `data-theme` is the source of truth; the iframe's old local theme button should be hidden/removed by its owner when using parent-controlled theme.

## Verification

Run `node --experimental-strip-types --test tests/material-preference.test.mjs` alongside the existing desktop unit tests. `npx tsc --noEmit --incremental false` and `npm run desktop:renderer` passed. Headless Chrome on the actual desktop dev renderer confirmed light/dark token changes, 14px chrome blur, no queue blur, manual reduced-transparency blur disabled, Darwin desktop blur disabled, and cover binding injection/theme attributes. Chromium checks do not replace final native WKWebView visual review.
