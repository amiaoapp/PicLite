# UI preview 8

Version 2.0.2, preview identity `com.piclite.preview`, separate from stable.

## Changes

- Remove Liquid Glass controls, effect CSS imports and native effect allocation. Saved glass preferences migrate to standard. Keep light/dark, layouts and five palettes. Native compatibility command remains only for ordinary titlebar safety, floating transparent backing and configurable corner clipping.
- Initialize standalone floating theme/palette. Previously tests supplied data-theme manually, but the production floating entry did not; conditional transparent-card overrides failed, leaving the old 82% dark card above the shared preview image.
- Stacked mode mounts one current result card instead of every full control layer. Other results stay available through Next, wheel and expanded list. Preserve the v7 full-image style, two-by-three hover actions, formats and local selected marker.
- One explicit image layer paints the whole window. Remove inherited information/hover scrims. List stacking context sits below utility footer; resize grip no longer blocks the close control at minimum size.
- Fix extensionless TypeScript runtime import that caused watch-settings Node tests to fail in CI; enable TypeScript imports with the project's existing noEmit configuration.

## Verification

- New multi-result regression first failed on the actual utility-footer hit (preview intercepted it) and exposed 2–6 duplicate control layers. Production entry then reproduced dim pixels [22,46,62] for source [35,165,255], exposing missing theme initialization.
- Final production renderer browser test: 1–6 images, undimmed pixel samples, one controls layer, real pointer clicks opening workbench, all header/format/footer target centres at 246×188, 420×320 and 680×480; Next changes metrics; list preserves six results; stack restores one card; dismissal reduces count.
- WKWebView loads the production bundle through its real renderer entry with a fixture bridge. At all three sizes, one metrics/control layer, transparent card and every footer hit target passes. Snapshot source-color samples equal [35,165,255]. This is a real WebKit renderer check, not proof of native filesystem/clipboard behavior.
- Floating editor smoke, quality/crop flow, formats/actions/auto-hide; main classic/studio export geometry and palette persistence pass. TypeScript, targeted ESLint and material migration/white-palette tests pass.

Preview package signature, architecture, archive integrity and packaged MCP smoke verified at delivery. macOS preview is ad-hoc signed, not notarized. Windows CI, if triggered, is handed off without monitoring; do not imply installer readiness.
