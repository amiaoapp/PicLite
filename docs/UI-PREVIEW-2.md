# PicLite UI preview 2

This preview repairs the first UI preview without changing the stable release.

- The header has one Appearance button. Colour mode, material, layout, palette, and reduced transparency live inside its panel. The trusted cover editor follows the parent appearance and hides its separate theme button.
- Tool navigation uses pointer gestures rather than HTML5 drag/drop, so desktop file-drop handling cannot steal reordering. All tools, including Workspace and Cover maker, can be reordered. Disabled tools retain their saved positions. Alt + arrow keys remain available. Narrow windows scroll the tool rail.
- The workbench fits 820×540, 1120×700 and 1440×900 viewports. The settings panel scrolls independently. Notifications do not cover the export footer.
- Resize and enlarge has source thumbnails, a selected-source preview, output-dimension estimate, grouped controls and fixed processing actions. Enlargement is interpolation, not generative outpainting or AI detail reconstruction.
- Floating results use one integrated card with header controls, preview/actions, file row and one format bar. Crop and quality modes replace the preview; no separate toolbar is appended underneath. Apply/Cancel and output formats remain reachable at small window heights. Editing pauses automatic hiding.

Verification: real Chrome pointer reordering and reload persistence, disable/re-enable persistence, appearance controls, desktop header geometry, resize UI English/Chinese and light/dark, floating full/compact interactions, native raster crop artifacts, TypeScript, targeted ESLint, renderer and Pages builds. Native WKWebView checked the seven-tool header and single Appearance trigger. Final macOS executable passed MCP smoke tests.

Limitations: animated-image cropping is rejected safely. The glass material is a web approximation with reduced-transparency fallback and macOS large-surface blur protection. Native Windows runtime interaction is not locally verified; ARM64 preview builds run on GitHub.
