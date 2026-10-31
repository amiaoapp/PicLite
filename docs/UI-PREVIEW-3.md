# UI preview 3

This revision addresses feedback on the UI-v2 preview.

- Restores visible Support, Appearance and Settings entries. Appearance remains one button with an anchored panel; the scrolling tool rail yields space to the fixed action area.
- Retains a two-row, three-column floating action grid in both full and compact layouts, including short windows. Default actions are downscale, undo, compression quality, copy, upload and save-copy. Other existing actions remain configurable or accessible in the overflow menu.
- Explicitly constrains the image element to its preview bounds using `object-fit: contain`, preventing intrinsic image dimensions from clipping a resized floating window.
- Uses a fixed dark format strip with bright labels and a clear selected state. Only supported output formats are shown; this does not add AVIF, HEIC or JXL encoders to the floating pipeline.
- Adds movable crop selections, four corner handles, free/1:1/3:2/4:3/16:9/original aspect presets, and proportional output dimensions. Native crop/save output remains non-destructive. Animation crop is still rejected safely.

Validation covers the actual complete floating window at 246×188, 280×220, 320×230 and 380×330, plus card-level full/compact modes. Browser tests exercise pointer crop drawing, corner resizing, selection movement, presets, apply, quality/format payloads and auto-hide behavior. They use an instrumented native bridge; decoded native artifact tests separately verify pixels, output dimensions and original preservation. Header geometry is checked in classic/Studio, light/dark and small desktop windows. WKWebView checked the actual header. TypeScript and targeted ESLint pass.
