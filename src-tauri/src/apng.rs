//! Lossless recompression of the zlib streams in animated PNGs.
use super::{target_dimensions, OptimizedImage, WatcherSettings};
use flate2::{bufread::ZlibDecoder, write::ZlibEncoder, Compression};
use std::io::{Read, Write};

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
    let dimensions = super::encoded_dimensions(&original)?;
    if target_dimensions(dimensions.0, dimensions.1, settings) != dimensions {
        return Err(
            "APNG 无损压缩暂不支持缩放 / Lossless APNG compression does not resize frames".into(),
        );
    }
    let mut output = SIGNATURE.to_vec();
    let mut source = chunks(&original).peekable();
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
            b"tEXt" | b"zTXt" | b"iTXt" | b"tIME" | b"eXIf" if settings.strip_metadata => {}
            _ => output.extend_from_slice(raw),
        }
    }
    if !ended || frames == 0 || frame_count(&original) != Some(frames) {
        return Err("APNG 动画不完整 / Incomplete APNG animation".into());
    }
    drop(source);
    Ok(OptimizedImage {
        bytes: if output.len() < original.len() {
            output
        } else {
            original
        },
        extension: "png".into(),
    })
}
