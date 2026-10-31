# UI preview 7

Preview identity remains `com.piclite.preview`, version 2.0.2, Apple Silicon arm64. Ad-hoc signed, not notarized.

- Floating preview fills the card body to its bottom edge. Format/crop controls are absolutely overlaid rather than occupying a separate grid row. The window utility row is also an overlay. No independent background, blur or strip is painted beneath these controls; only the selected format has a local marker. Preserve the existing arrangement and two-by-three actions, with non-overlapping hit targets at small sizes.
- Decorated transparent Tauri/Wry windows implicitly enable FullSizeContentView. The previous native titlebar overlay obscured the first 32 DOM points. Remove that style once while preserving content size, remove the custom titlebar material, and let AppKit draw its native titlebar. Main content keeps Regular, nil-tint native glass. This fixes overlap; it does not claim custom Liquid Glass inside the system titlebar.
- Export current/all share light/dark glass surfaces and explicit disabled states, rather than an inverted bulk-export button.

## Verified

- Real FloatingResults browser component: proportional full-window image; raster edge samples beneath formats/footer; transparent surfaces in light/dark glass; full-height preview body; action/format/utility hit targets do not overlap at 246×188, 420×320, 680×480. Browser screenshot visually checked.
- Floating editor smoke: quality editing and apply/cancel, separate crop flow, format/actions, compact layout, auto-hide and collapse.
- Real Tauri/Wry AppKit window probe executes production helpers: demonstrates implicit full-size content before fix; proves no titlebar/WebView intersection afterwards at 820×540 and 1120×700, Aqua/Dark Aqua and repeated material toggles. Native radius0/10/24 and material hierarchy checks pass. Full-app native screenshots were unavailable because the OS capture returned empty output in this session; browser screenshots are not native visual proof.
- Export colors, active/disabled, light/dark, classic/studio, empty/loaded at 820×540, 1120×700 and 1440×900; enabled contrast >4.5, buttons separated. TypeScript, cargo check, renderer/release build and diff whitespace pass.
- Package signature, arm64 executable, bundle identity, archive integrity and packaged MCP smoke checked at delivery.

Windows ARM64 CI may be triggered from the preview branch without monitoring completion; a trigger does not mean an installer is available.
