# UI Preview 11 — typography and softened floating controls

## Interface
- Floating controls use neutral translucent surfaces and subtle hover/selection/focus states rather than solid near-black/white blocks. Image tone (not app appearance) still selects inverse foreground. No image filter, full-image scrim, or Liquid Glass was added.
- Floating button labels, filesize, dimensions and percentages use weight 400 in both classic and immersive renderers.
- General settings now include interface text size (90–150%, 5-point steps, default 110%), system/default font selection, local TTF/OTF/WOFF/WOFF2 import, preview and Reset.
- A shared PostCSS transform scales font-size declarations only (including font shorthand); viewport, image, crop coordinates and export pixels are not zoomed.
- Imported UI fonts are decoded before selection and saved locally (IndexedDB, and the existing native font cache for desktop). Selected font/size synchronize between main, preferences, floating and crop documents; no font service or upload is involved. UI font preferences are separate from compression and watermark settings. Invalid or missing fonts leave readable system fallback text. Font files are limited to 32 MiB.
- Independent plugin/cover iframes retain their own document typography.

## Verification
- TypeScript, new font validation/persistence tests, existing compression-policy and image-editing tests.
- Production Chromium: actual slider changes/computed font-size (110/125/150), unzoomed geometry, real local Arial TTF import, loaded FontFace, reload restoration, cross-document synchronization and Reset.
- macOS WKWebView (nonpersistent): 150% computed text-size and real local TTF import/load.
- Floating production entry: light/dark image tones, classic/immersive switch, 1–6 images unchanged, one interactive card, actual footer clicks, action sizing/centering, pointer hit targets and viewport bounds at 246×188, 320×230, 488×372, 680×480.
- Static Pages and standalone builds; standalone production UI compression, clipboard image, download, paging, classic mode and typography reload tests.
- Windows uses the shared code but native Windows visual/runtime checks are not performed on this Mac. Docker frontend build/server verification is not a local container runtime test.

## Boundaries
- No compression codec, quality ladder, preset defaults or processing parameters changed for typography/colour work.
- Preview identity stays com.piclite.preview, version 2.0.2; macOS packaging remains arm64, ad-hoc signed, not notarized.
