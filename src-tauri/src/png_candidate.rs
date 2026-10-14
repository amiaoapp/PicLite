//! Stop a losing PNG candidate without changing the winning encoder or quality.
use super::*;
use std::{cell::Cell, sync::atomic::AtomicUsize};

const CHUNK_SIZE: usize = 64 * 1024;

struct BoundedWriter<'a> {
    bytes: Vec<u8>,
    best: &'a AtomicUsize,
    finishing: &'a Cell<bool>,
    safe_length: &'a Cell<usize>,
    exceeded: bool,
}

impl Write for BoundedWriter<'_> {
    fn write(&mut self, data: &[u8]) -> std::io::Result<usize> {
        let length = self.bytes.len().saturating_add(data.len());
        // Streaming splits IDAT into 64 KiB chunks; the regular encoder can
        // use one large chunk. Exclude MORE than the extra chunk framing so
        // this lower bound never rejects a PNG merely because of framing.
        let extra_framing = (length / CHUNK_SIZE + 2).saturating_mul(12);
        if !self.finishing.get()
            && length.saturating_sub(extra_framing) >= self.best.load(Ordering::Relaxed)
        {
            self.exceeded = true;
            return Err(std::io::Error::other("PNG candidate is already larger"));
        }
        self.bytes.extend_from_slice(data);
        if !self.finishing.get() {
            self.safe_length.set(length);
        }
        Ok(data.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// Same palette, filtering and DEFLATE as `encode_static_ref`. A completed
/// contender is encoded with that original function, preserving exact bytes.
pub(super) fn stream(
    image: &DynamicImage,
    quality: u8,
    best: &AtomicUsize,
) -> Result<Option<Vec<u8>>, String> {
    stream_inner(image, quality, best).map(|result| result.map(|(bytes, _)| bytes))
}

fn stream_inner(
    image: &DynamicImage,
    quality: u8,
    best: &AtomicUsize,
) -> Result<Option<(Vec<u8>, usize)>, String> {
    let rgba = image.to_rgba8();
    let finishing = Cell::new(false);
    let safe_length = Cell::new(0);
    let mut output = BoundedWriter {
        bytes: Vec::new(),
        best,
        finishing: &finishing,
        safe_length: &safe_length,
        exceeded: false,
    };
    let result = (|| -> Result<(), png::EncodingError> {
        let mut encoder = png::Encoder::new(&mut output, rgba.width(), rgba.height());
        encoder.set_depth(png::BitDepth::Eight);
        let quantizer = if quality >= 100 {
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_compression(png::Compression::High);
            encoder.set_filter(png::Filter::Adaptive);
            None
        } else {
            let normalized = (quality.clamp(1, 99) as f32 / 100.0).clamp(0.01, 0.99);
            let colors = (64.0 + 192.0 * normalized.powf(1.35))
                .round()
                .clamp(64.0, 256.0) as usize;
            let quantizer = color_quant::NeuQuant::new(10, colors, rgba.as_raw());
            let mut palette = Vec::with_capacity(colors * 3);
            let mut transparency = Vec::with_capacity(colors);
            for color in quantizer.color_map_rgba().chunks_exact(4) {
                palette.extend_from_slice(&color[..3]);
                transparency.push(color[3]);
            }
            while transparency.last() == Some(&u8::MAX) {
                transparency.pop();
            }
            encoder.set_color(png::ColorType::Indexed);
            encoder.set_palette(palette);
            if !transparency.is_empty() {
                encoder.set_trns(transparency);
            }
            Some(quantizer)
        };
        let mut writer = encoder.write_header()?;
        {
            let mut stream = writer.stream_writer_with_size(CHUNK_SIZE)?;
            if let Some(quantizer) = quantizer {
                let mut row = vec![0; rgba.width() as usize];
                for pixels in rgba.rows() {
                    for (index, pixel) in pixels.enumerate() {
                        row[index] = quantizer.index_of(&pixel.0) as u8;
                    }
                    stream.write_all(&row)?;
                }
            } else {
                for row in rgba.as_raw().chunks_exact(rgba.width() as usize * 4) {
                    stream.write_all(row)?;
                }
            }
            // PNG's streaming API sync-flushes on finish, adding an extra
            // final DEFLATE block. Only preceding emitted chunks are an exact
            // prefix of the regular encoder, so stop pruning before that flush.
            finishing.set(true);
            stream.finish()?;
        }
        writer.finish()
    })();
    if output.exceeded {
        return Ok(None);
    }
    result.map_err(|error| error.to_string())?;
    Ok(Some((output.bytes, safe_length.get())))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn idat(bytes: &[u8]) -> Vec<u8> {
        let mut payload = Vec::new();
        let mut offset = 8;
        while offset < bytes.len() {
            let length = u32::from_be_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize;
            if &bytes[offset + 4..offset + 8] == b"IDAT" {
                payload.extend_from_slice(&bytes[offset + 8..offset + 8 + length]);
            }
            offset += length + 12;
        }
        payload
    }

    #[test]
    fn pruning_only_uses_an_identical_compressed_prefix() {
        let image = DynamicImage::ImageRgba8(image::RgbaImage::from_fn(1000, 200, |x, y| {
            let mut seed = (x + y * 1000).wrapping_add(1);
            seed = (seed ^ (seed >> 16)).wrapping_mul(0x7feb352d);
            seed = (seed ^ (seed >> 15)).wrapping_mul(0x846ca68b);
            seed ^= seed >> 16;
            image::Rgba([
                seed as u8,
                (seed >> 8) as u8,
                (seed >> 16) as u8,
                if x % 7 == 0 { 100 } else { 255 },
            ])
        }));
        for quality in [25, 82, 100] {
            let exact = encode_static_ref(&image, "png", quality).unwrap();
            let (streamed, safe_length) =
                stream_inner(&image, quality, &AtomicUsize::new(usize::MAX))
                    .unwrap()
                    .unwrap();
            let prefix = idat(&streamed[..safe_length]);
            let exact_payload = idat(&exact);
            assert!(
                prefix == exact_payload[..prefix.len()],
                "quality={quality}: encoded prefix must match exactly"
            );
            assert!(
                image::load_from_memory(&streamed).unwrap().to_rgba8()
                    == image::load_from_memory(&exact).unwrap().to_rgba8(),
                "quality={quality}: pixels must match"
            );
            assert!(
                stream(&image, quality, &AtomicUsize::new(32_000))
                    .unwrap()
                    .is_none(),
                "quality={quality}: a losing candidate should stop"
            );
            assert!(stream(&image, quality, &AtomicUsize::new(exact.len() + 1))
                .unwrap()
                .is_some());
        }
    }

    #[test]
    fn large_graphic_still_chooses_the_exact_smallest_completed_candidate() {
        let image = DynamicImage::ImageRgba8(image::RgbaImage::from_fn(4000, 1000, |x, _| {
            let mut seed = x.wrapping_add(1);
            seed = (seed ^ (seed >> 16)).wrapping_mul(0x7feb352d);
            seed = (seed ^ (seed >> 15)).wrapping_mul(0x846ca68b);
            seed ^= seed >> 16;
            image::Rgba([seed as u8, (seed >> 8) as u8, (seed >> 16) as u8, 255])
        }));
        let mut original = Vec::new();
        PngEncoder::new_with_quality(
            &mut original,
            CompressionType::Fast,
            PngFilterType::NoFilter,
        )
        .write_image(
            image.as_bytes(),
            image.width(),
            image.height(),
            image::ExtendedColorType::Rgba8,
        )
        .unwrap();
        let mut settings =
            crate::tests::watch_test_settings(Path::new("/tmp/piclite-candidate-test"));
        settings.resize = false;
        settings.mode = "lossless".into();
        settings.quality = 92;
        settings.format = "keep".into();
        settings.prevent_larger = false;
        let expected = ["jpg", "webp", "png"]
            .into_iter()
            .map(|format| {
                (
                    format,
                    encode_static_ref(&image, format, if format == "png" { 100 } else { 92 })
                        .unwrap(),
                )
            })
            .min_by_key(|(_, bytes)| bytes.len())
            .unwrap();
        assert_eq!(expected.0, "png", "fixture must exercise a winning PNG");
        let result = optimize_image_data(original, "png".into(), &settings).unwrap();
        assert_eq!(result.extension, "png");
        assert!(
            result.bytes == expected.1,
            "a winning PNG must remain byte-identical"
        );
    }
}
