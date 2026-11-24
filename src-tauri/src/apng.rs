//! Recompress or transform APNG subframes without flattening the animation.
use super::{
    quantize_rgba, resize_dynamic_fast, target_dimensions, OptimizedImage, WatcherSettings,
};
use flate2::{bufread::ZlibDecoder, write::ZlibEncoder, Compression};
use std::io::{Cursor, Read, Write};

const SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";
const MAX_FRAME_BYTES: usize = 64 * 1024 * 1024;
const MAX_DECODED_BYTES: usize = 512 * 1024 * 1024;

fn chunks(bytes: &[u8]) -> impl Iterator<Item = (&[u8], &[u8])> + Clone {
    let mut rest = bytes.strip_prefix(SIGNATURE).unwrap_or_default();
    std::iter::from_fn(move || {
        let length = u32::from_be_bytes(rest.get(..4)?.try_into().ok()?) as usize;
        let raw = rest.get(..length.checked_add(12)?)?;
        rest = &rest[raw.len()..];
        Some((&raw[4..8], raw))
    })
}

pub(super) fn frame_count(bytes: &[u8]) -> Option<u32> {
    chunks(bytes)
        .take_while(|(kind, _)| !matches!(*kind, b"IDAT" | b"IEND"))
        .find_map(|(kind, raw)| {
            (kind == b"acTL" && raw.len() == 20)
                .then(|| u32::from_be_bytes(raw[8..12].try_into().unwrap()))
        })
}

fn write_chunk(output: &mut Vec<u8>, kind: &[u8], sequence: Option<u32>, payload: &[u8]) {
    output.extend_from_slice(
        &((payload.len() + if sequence.is_some() { 4 } else { 0 }) as u32).to_be_bytes(),
    );
    let start = output.len();
    output.extend_from_slice(kind);
    if let Some(sequence) = sequence {
        output.extend_from_slice(&sequence.to_be_bytes());
    }
    output.extend_from_slice(payload);
    output.extend_from_slice(&crc32fast::hash(&output[start..]).to_be_bytes());
}

pub(super) fn optimize(
    original: Vec<u8>,
    settings: &WatcherSettings,
) -> Result<OptimizedImage, String> {
    if !matches!(settings.format.as_str(), "keep" | "image/png") {
        return Err(
            "APNG 目前只支持保留 PNG 动画格式 / APNG output must stay PNG to preserve animation"
                .into(),
        );
    }
    if original.len() > 256 * 1024 * 1024 {
        return Err("APNG 超过 256 MB / APNG exceeds 256 MB".into());
    }
    let source = super::encoded_dimensions(&original)?;
    let requested = target_dimensions(source.0, source.1, settings);
    let quality = if settings.mode == "lossless" {
        100
    } else {
        settings.quality.clamp(1, 100)
    };
    let cap = (settings.target_size_kb as usize).saturating_mul(1000);
    let strip = settings.strip_metadata;
    let mut best = if requested == source && quality == 100 {
        recompress(&original, strip)?
    } else {
        transform(&original, source, requested, quality, strip)?
    };
    if cap > 0 && best.len() > cap {
        let target_quality = quality.min(20);
        if target_quality < quality {
            let trial = transform(&original, source, requested, target_quality, strip)?;
            if trial.len() < best.len() {
                best = trial;
            }
        }
        // With a byte cap the requested dimensions are the starting point.
        let mut dimensions = requested;
        let mut size = best.len();
        for _ in 0..16 {
            if best.len() <= cap || dimensions == (1, 1) {
                break;
            }
            let factor = ((cap as f64 / size as f64).sqrt() * 0.92).clamp(0.1, 0.8);
            dimensions = (
                ((dimensions.0 as f64 * factor).floor() as u32).max(1),
                ((dimensions.1 as f64 * factor).floor() as u32).max(1),
            );
            let trial = transform(&original, source, dimensions, target_quality, strip)?;
            size = trial.len();
            if size < best.len() {
                best = trial;
            }
        }
    }
    if settings.prevent_larger && requested == source && best.len() >= original.len() {
        best = recompress(&original, strip)?;
    }
    Ok(OptimizedImage {
        bytes: best,
        extension: "png".into(),
    })
}

fn recompress(original: &[u8], strip_metadata: bool) -> Result<Vec<u8>, String> {
    let mut output = SIGNATURE.to_vec();
    let mut source = chunks(original).peekable();
    let mut sequence = 0_u32;
    let mut decoded_budget = MAX_DECODED_BYTES;
    let mut ended = false;
    let mut frames = 0;
    while let Some((kind, raw)) = source.next() {
        let payload = &raw[8..raw.len() - 4];
        match kind {
            b"IDAT" | b"fdAT" => {
                let prefix = if kind == b"fdAT" { 4 } else { 0 };
                let mut compressed = payload.get(prefix..).ok_or("Invalid APNG frame")?.to_vec();
                // Ancillary chunks can interrupt fdAT groups. Leave those
                // frames in their original layout instead of decoding a partial stream.
                let mut originals = vec![raw];
                while source.peek().is_some_and(|(next, _)| *next == kind) {
                    let (_, part) = source.next().unwrap();
                    compressed.extend_from_slice(
                        part.get(8 + prefix..part.len() - 4)
                            .ok_or("Invalid APNG frame")?,
                    );
                    originals.push(part);
                }
                let interrupted = prefix != 0
                    && source
                        .clone()
                        .take_while(|(next, _)| !matches!(*next, b"fcTL" | b"IEND"))
                        .any(|(next, _)| next == b"fdAT");
                let mut raw_pixels = Vec::new();
                let limit = decoded_budget.min(MAX_FRAME_BYTES);
                let mut decoder = ZlibDecoder::new(compressed.as_slice());
                let encoded = if !interrupted
                    && limit > 0
                    && decoder
                        .by_ref()
                        .take((limit + 1) as u64)
                        .read_to_end(&mut raw_pixels)
                        .is_ok()
                    && raw_pixels.len() <= limit
                    && decoder.total_in() == compressed.len() as u64
                {
                    decoded_budget -= raw_pixels.len();
                    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::best());
                    encoder
                        .write_all(&raw_pixels)
                        .map_err(|error| error.to_string())?;
                    Some(encoder.finish().map_err(|error| error.to_string())?)
                } else {
                    decoded_budget = 0;
                    None
                };
                let old_size: usize = originals.iter().map(|part| part.len()).sum();
                if let Some(encoded) =
                    encoded.filter(|encoded| encoded.len() + 12 + prefix < old_size)
                {
                    write_chunk(
                        &mut output,
                        kind,
                        (prefix != 0).then_some(sequence),
                        &encoded,
                    );
                    sequence += u32::from(prefix != 0);
                } else {
                    for part in originals {
                        if prefix == 0 {
                            output.extend_from_slice(part);
                        } else {
                            write_chunk(
                                &mut output,
                                kind,
                                Some(sequence),
                                &part[12..part.len() - 4],
                            );
                            sequence += 1;
                        }
                    }
                }
            }
            b"fcTL" if payload.len() == 26 => {
                frames += 1;
                write_chunk(&mut output, kind, Some(sequence), &payload[4..]);
                sequence += 1;
            }
            b"fcTL" => return Err("Invalid APNG frame control".into()),
            b"IEND" => {
                output.extend_from_slice(raw);
                ended = true;
                break;
            }
            b"tEXt" | b"zTXt" | b"iTXt" | b"tIME" | b"eXIf" if strip_metadata => {}
            _ => output.extend_from_slice(raw),
        }
    }
    if !ended || frames == 0 || frame_count(original) != Some(frames) {
        return Err("APNG 动画不完整 / Incomplete APNG animation".into());
    }
    Ok(if output.len() < original.len() {
        output
    } else {
        original.to_vec()
    })
}

fn scaled_interval(start: u32, length: u32, from: u32, to: u32) -> (u32, u32) {
    let edge = |value| (value as f64 * to as f64 / from as f64).round() as u32;
    let left = edge(start).min(to - 1);
    (left, edge(start + length).clamp(left + 1, to) - left)
}

struct IndexedOutput {
    colors: Vec<[u8; 4]>,
    premultiplied: Vec<[i32; 4]>,
    indices: std::collections::HashMap<[u8; 4], u8>,
}

fn color_metric([r, g, b, a]: [u8; 4]) -> [i32; 4] {
    let a = i32::from(a);
    [
        i32::from(r) * a / 255,
        i32::from(g) * a / 255,
        i32::from(b) * a / 255,
        2 * a,
    ]
}

impl IndexedOutput {
    fn index(&mut self, rgba: [u8; 4], resized: bool) -> u8 {
        if let Some(&index) = self.indices.get(&rgba) {
            return index;
        }
        // Interpolation introduces colors absent from the source palette.
        // Compare premultiplied colors so RGB under transparency matters less.
        let pixel = color_metric(rgba);
        let preserve_alpha = !resized || matches!(rgba[3], 0 | 255);
        let index = self
            .premultiplied
            .iter()
            .enumerate()
            .min_by_key(|(_, color)| {
                let alpha_changed = color[3] != pixel[3];
                let distance: i32 = color.iter().zip(pixel).map(|(a, b)| (a - b).pow(2)).sum();
                (preserve_alpha && alpha_changed, distance)
            })
            .map_or(0, |(index, _)| index as u8);
        if self.indices.len() < 65_536 {
            self.indices.insert(rgba, index);
        }
        index
    }
}

fn reduced_palette(info: &png::Info<'_>, quality: u8) -> Option<IndexedOutput> {
    let palette = info.palette.as_ref()?;
    let alpha = info.trns.as_deref().unwrap_or_default();
    let q = (quality as f64 - 1.0) / 99.0;
    let levels = (2.0 + 24.0 * q + 230.0 * q.powi(22)).round();
    let step = 255.0 / (levels - 1.0);
    let mut colors = Vec::new();
    let mut indices = std::collections::HashMap::new();
    for (index, rgb) in palette.chunks_exact(3).enumerate() {
        let rgba = [
            rgb[0],
            rgb[1],
            rgb[2],
            alpha.get(index).copied().unwrap_or(255),
        ];
        let mut color = rgba;
        for channel in &mut color[..3] {
            *channel = if rgba[3] == 0 {
                0
            } else {
                ((*channel as f64 / step).round() * step).round() as u8
            };
        }
        let index = colors
            .iter()
            .position(|entry| *entry == color)
            .unwrap_or_else(|| {
                colors.push(color);
                colors.len() - 1
            });
        indices.insert(rgba, index as u8);
    }
    let premultiplied = colors.iter().copied().map(color_metric).collect();
    Some(IndexedOutput {
        colors,
        premultiplied,
        indices,
    })
}

fn transform(
    original: &[u8],
    source: (u32, u32),
    target: (u32, u32),
    quality: u8,
    strip: bool,
) -> Result<Vec<u8>, String> {
    let too_large = "APNG 动画像素过多 / APNG exceeds the pixel processing limit";
    let pixels = |w: u32, h: u32| u64::from(w) * u64::from(h);
    for (w, h) in [source, target] {
        if pixels(w, h) > (MAX_FRAME_BYTES / 4) as u64 {
            return Err(too_large.into());
        }
    }

    let mut decoder = png::Decoder::new(Cursor::new(original));
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder.read_info().map_err(|e| e.to_string())?;
    let animation = reader
        .info()
        .animation_control
        .ok_or("Invalid APNG animation")?;
    let poster = reader.info().frame_control.is_none();
    let mut indexed = if quality < 100 && reader.info().color_type == png::ColorType::Indexed {
        reduced_palette(reader.info(), quality)
    } else {
        None
    };
    let count = animation
        .num_frames
        .checked_add(u32::from(poster))
        .ok_or(too_large)?;
    let mut buffer = vec![0; reader.output_buffer_size().ok_or(too_large)?];
    let mut output = Vec::new();
    let mut encoder = png::Encoder::new(&mut output, target.0, target.1);
    if let Some(indexed) = &indexed {
        encoder.set_color(png::ColorType::Indexed);
        // Index numbers do not describe color gradients. Filtering them like RGBA often expands the stream.
        encoder.set_filter(png::Filter::NoFilter);
        encoder.set_palette(
            indexed
                .colors
                .iter()
                .flat_map(|color| color[..3].iter().copied())
                .collect::<Vec<_>>(),
        );
        encoder.set_trns(
            indexed
                .colors
                .iter()
                .map(|color| color[3])
                .collect::<Vec<_>>(),
        );
    } else {
        encoder.set_color(png::ColorType::Rgba);
    }
    encoder.set_depth(png::BitDepth::Eight);
    encoder
        .set_animated(animation.num_frames, animation.num_plays)
        .map_err(|e| e.to_string())?;
    encoder.set_sep_def_img(poster).map_err(|e| e.to_string())?;
    let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
    for (kind, raw) in chunks(original) {
        let gray_icc = kind == b"iCCP"
            && matches!(
                reader.info().color_type,
                png::ColorType::Grayscale | png::ColorType::GrayscaleAlpha
            );
        if !gray_icc && matches!(kind, b"cHRM" | b"gAMA" | b"iCCP" | b"sRGB" | b"pHYs")
            || !strip && matches!(kind, b"tEXt" | b"zTXt" | b"iTXt" | b"tIME" | b"eXIf")
        {
            writer
                .write_chunk(
                    png::chunk::ChunkType(kind.try_into().unwrap()),
                    &raw[8..raw.len() - 4],
                )
                .map_err(|e| e.to_string())?;
        }
    }

    let mut remaining = (MAX_DECODED_BYTES / 4) as u64;
    for index in 0..count {
        let info = reader.next_frame(&mut buffer).map_err(|e| e.to_string())?;
        let control = if index == 0 && poster {
            None
        } else {
            Some(reader.info().frame_control.ok_or("Invalid APNG frame")?)
        };
        let (x, width) = scaled_interval(
            control.map_or(0, |c| c.x_offset),
            info.width,
            source.0,
            target.0,
        );
        let (y, height) = scaled_interval(
            control.map_or(0, |c| c.y_offset),
            info.height,
            source.1,
            target.1,
        );
        remaining = remaining
            .checked_sub(pixels(info.width, info.height).max(pixels(width, height)))
            .ok_or(too_large)?;
        use png::ColorType::{Grayscale, GrayscaleAlpha, Indexed, Rgb, Rgba};
        let data = &buffer[..info.buffer_size()];
        let pixels = match info.color_type {
            Rgba => data.to_vec(),
            Rgb => data
                .chunks_exact(3)
                .flat_map(|p| [p[0], p[1], p[2], 255])
                .collect(),
            Grayscale => data.iter().flat_map(|&p| [p, p, p, 255]).collect(),
            GrayscaleAlpha => data
                .chunks_exact(2)
                .flat_map(|p| [p[0], p[0], p[0], p[1]])
                .collect(),
            Indexed => return Err("Invalid APNG palette".into()),
        };
        let image = image::RgbaImage::from_raw(info.width, info.height, pixels)
            .ok_or("Invalid APNG frame pixels")?;
        let mut image = resize_dynamic_fast(image::DynamicImage::ImageRgba8(image), width, height)?
            .into_rgba8();
        let pixels = if let Some(indexed) = &mut indexed {
            image
                .pixels()
                .map(|p| indexed.index(p.0, target != source))
                .collect::<Vec<_>>()
        } else {
            quantize_rgba(&mut image, quality);
            image.into_raw()
        };
        if let Some(control) = control {
            writer.reset_frame_position().map_err(|e| e.to_string())?;
            writer
                .set_frame_dimension(width, height)
                .map_err(|e| e.to_string())?;
            writer.set_frame_position(x, y).map_err(|e| e.to_string())?;
            writer
                .set_frame_delay(control.delay_num, control.delay_den)
                .map_err(|e| e.to_string())?;
            writer
                .set_dispose_op(control.dispose_op)
                .map_err(|e| e.to_string())?;
            writer
                .set_blend_op(control.blend_op)
                .map_err(|e| e.to_string())?;
        }
        writer
            .write_image_data(&pixels)
            .map_err(|e| e.to_string())?;
    }
    reader.finish().map_err(|e| e.to_string())?;
    writer.finish().map_err(|e| e.to_string())?;
    Ok(output)
}
