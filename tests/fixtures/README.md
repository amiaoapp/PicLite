`apple-photo.heic` is the 64 × 64 HEIC test image `flat-64.heic` from
[tbraun96/heic-rs](https://github.com/tbraun96/heic-rs/tree/main/tests/fixtures).
`apple-grid.heic` is the upstream `checker-1024.heic` sample and tests the
tiled container structure used for camera photographs.

These samples are used to test HEIC/HEIF decoding, imports and format conversion on all
platforms without requiring Apple's encoder during CI. Upstream licensing:
MIT OR Apache-2.0 (see the upstream LICENSE-MIT and LICENSE-APACHE files).
