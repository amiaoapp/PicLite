# UI preview 5

Separate preview identity `com.piclite.preview`; package/native version remains 2.0.2.

## Changes

- Remove black result/format blocks and hover scrim from floating cards. Keep metrics and supported formats on the continuous card surface.
- Enlarge and centre all six action glyphs, retain the two-row/three-column layout. Tests measure each SVG against its button centre, not just the grid.
- Settings → Floating results exposes a saved 0–28px corner-radius slider, default 10px. Zero remains valid. Shell, clipping, cards and settings preview use the same source; native material receives the floating radius.
- Add a pure white standard palette with a neutral dark counterpart. Glass material is neutral and independent of the palette.
- macOS 26+ uses NSGlassEffectView Clear with nil tint. Older macOS uses behind-window NSVisualEffectView; other systems retain the neutral CSS fallback. The implementation is independent code using Apple APIs, not copied AGPL qimiao source.
- Native material toggles cleanly and follows accessibility transparency preference. Floating shell stays transparent when glass is disabled; folded icon removes the material and expanded results restore it.

## Verification

- TypeScript, targeted ESLint, renderer build and Cargo check passed. Rust library tests: 83 passed, 0 failed, 1 ignored.
- Forty computed CSS cases cover five palettes, classic/studio, light/dark, native transparency, fallback/reduced transparency, and pure white. Regression assertions now include the preview stage's legacy gradient.
- Floating tests check five window sizes, all four painted image corners, glyph centre offsets, larger glyphs, no black block, and 0/10/24px radii. The real preference slider saves and reloads zero and 24px, updating its preview immediately.
- Browser hook tests cover native backend name mapping, zero radius, collapsed removal/restoration and reduced transparency. Crop/quality/format/action/auto-hide regressions passed.
- AppKit/WKWebView probe confirmed Clear/nil tint, one identified material under the unchanged webview after repeated enables, radius zero/update, autoresize, disable/removal, and forced visual-effect fallback.
- The actual PicLite Tauri development process returned `nsglass-clear` on this Mac. It ran standard → glass → reduced → glass and reported transparent html/body/root/app-shell only for active glass. A composited screen capture over a disposable coloured/text backdrop confirmed background colour bands and lettering continuing through the real window. This is native development-window verification, not a pixel-equivalence claim against qimiao. The system title bar remains native/default. No long-duration memory stress test was performed.

macOS preview is ad-hoc signed, not notarized. Windows ARM64 workflow triggering is separate from a verified downloadable installer; CI completion is intentionally not monitored.
