# UI preview 9

Version 2.0.2, preview identity `com.piclite.preview`.

- Six centre actions switch to one row when the preview height is at most 240px; taller previews retain two rows of three. Keep moderate button sizes (max 60px for two rows, max 44px for one row), enlarge glyphs independently and remove the inherited max-percentage cap that shrank SVG twice. Metrics remain visible. No image scrim added. Footer glyphs increase from 12px to 16px.
- Production-browser and fresh nonpersistent WKWebView measurements: at 246×188 buttons ~33.7px, glyphs ~20.2px, one row; at 320×230 ~44px/~26.4px, one row; at 488×372 and 680×480 ~60px/~36px, two rows. All remain centred. Production test also verifies one control layer across 1–6 results, pixel colours, footer hits, Next/list/stack/dismiss. Editor smoke, TypeScript and whitespace checks pass.

## Compression audit / unchanged scope

This preview changes CSS only, plus a UI test and this document. No codec, quality ladder, presets, source selection, persistence or processing calls are changed.

Compared with original cover/stable-era commit 0160201 and v8:
- compression-policy.ts, animation_size.rs, png_candidate.rs and heic_input.rs unchanged.
- nativeSettings and resolveOptimisationPreset functions unchanged.
- Rust compression implementation is unchanged; lib.rs UI-round additions are modules, window lifecycle and invoke registrations.
- Existing Release test executable passed real_product_artwork_uses_the_super_compression_ladder and automatic_first_pass_measures_all_opaque_formats. Real artwork: original 1566240 B; lossless 137574 B; balanced 77950 B; small 28278 B, WebP. This proves the supplied fixture, not the user's unprovided original image.
- Initial floating auto remains Q86/100%/keep with multiformat choice; main defaults and saved presets are separate and unchanged.
- Earlier UI round added manual quality editing. Its Auto means preserve format during manual quality encoding, unlike the outer Auto multiformat action. That semantic ambiguity and current-output recompression are identified, not silently changed here. No evidence ties them to the user's screenshot without the source image/operation path.

Final package signature, arm64, ZIP and packaged MCP smoke verified at delivery. Ad-hoc signed, not notarized. Windows build trigger is not installer readiness; do not monitor CI when handing off.
