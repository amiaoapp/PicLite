# UI preview 6

Preview identity remains `com.piclite.preview`; native/npm version remains 2.0.2.

## User-visible changes

- Floating image covers the entire expanded window, including format and bottom utility controls. Controls overlay one continuous image. There is no black panel, hover scrim or letterboxing. Preview uses proportional cover and crops excess edges; source/output image files are not changed by the display fit.
- Six floating buttons and their glyphs scale with both viewport axes, retaining two rows of three. Close, formats, utility controls and quality editor remain separate usable targets.
- A radius of zero now reaches html/body/root, shell clipping and native full-size backing layers, not only the card. Native clipping tests exercise 10/0/24/0 and standard/off states. Actual native zero-radius screenshot shows square corners.
- Default stacked results now allow window dragging from the preview. Prior code explicitly passed false for this mode. Interactive buttons/inputs remain excluded. Actual native drag moved a 480×360 window from (972,578) to (934,540) without resizing.
- Appearance palette picker is a compact full-width responsive grid below its label, rather than five cards in a narrow trailing column.
- Correct export footer tracks at classic/studio breakpoints. Current-image export and Export all no longer overlap.
- Native main-window glass uses NSGlassEffectView Regular, not Clear, and stronger neutral panel tint to reduce background-letter interference. The native titlebar receives NSVisualEffectView titlebar material with reversible transparency; contentLayoutRect, window styles and traffic-light geometry are preserved. This changes the app titlebar, not the macOS global menu bar. Old macOS retains visual-effect fallback. Populated floating windows keep image-only surfaces rather than tinted glass slabs.

## Verification

- Actual browser renderer: both layouts, empty and loaded-image states at 820×540, 1120×700, 1440×900; export buttons inside footer/viewport and separated by 6–8px. Five palette choices use one/two rows, fit labels and persist selection.
- Cover geometry: five viewport/aspect combinations cover both axes proportionally. Raster edge samples confirm image pixels beneath formats and footer. Tests mount the real FloatingResults component, not just a card, and assert the default stacked drag path. Light/dark glass cannot restore a block over the image.
- Floating buttons grow with window size, remain three columns and centre each glyph. Quality/apply/cancel, format changes, separate crop launch/output/cancel, actions, menus and auto-hide regressions passed.
- Actual Rust AppKit helper probe uses WKWebView: Regular nil-tint material, one sibling, titlebar enable/repeat/restore, unchanged content/traffic lights/style, zero native corner radius and fallback.
- Actual Tauri development window screenshot: image fills the whole 480×360 native floating window including both bottom control rows; no black/blank band; square corners at zero. Native movement confirmed by before/after CoreGraphics bounds.
- TypeScript, targeted ESLint, renderer build and Rust library tests passed (83 passed, 0 failed, 1 ignored).
- Final macOS preview is Apple Silicon arm64 with ad-hoc signing, not notarized. Archive integrity, signature, bundle identity and packaged MCP smoke tests are verified at delivery.

Windows ARM64 uses the same preview branch through GitHub Actions. Triggered is not equivalent to generated/tested; CI completion is intentionally not monitored.
