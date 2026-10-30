# UI preview 4

This preview keeps native/npm version 2.0.2 and uses the separate `com.piclite.preview` application identity. It does not replace the stable installation.

## Changes

- Remove the filename from floating cards. Keep close/overflow at the top corners, the six rounded actions in two rows of three, and a small regular-weight Auto/JPEG/WEBP/PNG strip with a crop entry.
- Measure the actual image slot with ResizeObserver and compute explicit contain dimensions. Reserve space for controls and result metrics rather than obscuring image corners. Very small native windows consequently show a smaller complete image.
- Open crop in a separate resizable native window. Support moving the selection, eight handles, aspect/size presets, exact output dimensions, reset, apply and cancellation. Native code retains the source path in a request registry and returns a newly rendered file. Animated images remain unsupported for cropping.
- Import material CSS into each document through the theme hook; fix opaque overrides and use translucent fills, highlights and small-surface backdrop blur. This is a web glass approximation, not Apple's native Liquid Glass or a native desktop-background lens. Reduced transparency remains available. Image previews receive no material filter.

## Verification

- TypeScript, targeted ESLint, renderer production build and Rust library tests passed.
- Browser floating tests cover full/compact cards, light/dark modes, Chinese/English labels, six actions, format/quality changes, crop launch/output/cancel, menus and auto-hide. The timer assertion awaits an observable event with a bounded timeout rather than assuming a background browser fires exactly at one second.
- Five viewport/source combinations verify all four distinct coloured image corners are actually painted, proportional image bounds and a three-column action grid.
- A disposable Vite probe in an actual macOS Tauri development process resized the native dropzone sequentially to 380×330, 246×188, 280×220, 460×300 and 320×230. Actual WebView innerWidth/innerHeight matched every request and the rendered image stayed inside its measured slot with the original aspect ratio. This is native development-process verification, not inspection of the packaged release window.
- A separate native crop probe opened a real crop window, observed eight handles, selected 1:1 and applied. A 640×400 source produced a decoded 400×400 PNG with expected pixels while the original dimensions remained intact.
- Crop browser tests additionally cover full-resolution versus thumbnail coordinates, pointer edge dragging, precise dimensions, apply/cancel and 700×480/960×660 layouts. Native request ownership/cancellation are tested in Rust.
- Real WKWebView computed styles confirm glass mode, alpha fills and toolbar blur, with a single appearance entry and no horizontal overflow. This confirms CSS application, not visual equivalence to native Liquid Glass.
- The final macOS archive passes ZIP integrity, arm64 architecture and ad-hoc signature checks. Its packaged executable passes MCP smoke tests. The macOS app is not notarized.

Windows ARM64 is built through the preview GitHub Actions workflow. Triggering that workflow does not mean an installer has already been generated or tested. CI completion is intentionally not monitored.
