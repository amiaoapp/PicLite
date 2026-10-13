use super::*;

struct SizedAnimation {
    frames: Vec<(image::RgbaImage, i32)>, // fully composited pixels and start time
    duration: i32,
    loop_count: i32,
    background: [u8; 4],
}

fn fit(width: u32, height: u32, edge: u32) -> (u32, u32) {
    let ratio = (edge as f64 / width.max(height).max(1) as f64).min(1.0);
    (
        (width as f64 * ratio).round().max(1.0) as u32,
        (height as f64 * ratio).round().max(1.0) as u32,
    )
}

fn resize_frame(frame: &image::RgbaImage, width: u32, height: u32) -> image::RgbaImage {
    if frame.dimensions() == (width, height) {
        return frame.clone();
    }
    image::imageops::resize(frame, width, height, FilterType::Triangle)
}

fn decode_sized(
    data: &[u8],
    extension: &str,
    settings: &WatcherSettings,
    edge: u32,
) -> Result<SizedAnimation, String> {
    let mut result = SizedAnimation {
        frames: Vec::new(),
        duration: 0,
        loop_count: 0,
        background: [0; 4],
    };
    if extension == "gif" {
        let decoder =
            GifDecoder::new(BufReader::new(Cursor::new(data))).map_err(|e| e.to_string())?;
        let (w, h) = decoder.dimensions();
        let (w, h) = target_dimensions(w, h, settings);
        let (w, h) = fit(w, h, edge);
        let mut metadata = gif::DecodeOptions::new()
            .read_info(Cursor::new(data))
            .map_err(|e| e.to_string())?;
        metadata.next_frame_info().map_err(|e| e.to_string())?;
        result.loop_count = match metadata.repeat() {
            gif::Repeat::Infinite => 0,
            gif::Repeat::Finite(n) => n as i32,
        };
        for frame in decoder.into_frames() {
            let frame = frame.map_err(|e| e.to_string())?;
            let start = result.duration;
            result.duration = result
                .duration
                .checked_add(gif_delay_ms(frame.delay()))
                .ok_or("动图播放时长过长")?;
            if result
                .frames
                .last()
                .map(|(_, t)| start - t >= 50)
                .unwrap_or(true)
            {
                result
                    .frames
                    .push((resize_frame(frame.buffer(), w, h), start));
            }
        }
    } else {
        let decoded = AnimatedWebPDecoder::new(data)
            .decode()
            .map_err(|e| format!("动态 WebP 解码失败：{e}"))?;
        result.loop_count = decoded.loop_count as i32;
        result.background = [
            decoded.bg_color as u8,
            (decoded.bg_color >> 8) as u8,
            (decoded.bg_color >> 16) as u8,
            (decoded.bg_color >> 24) as u8,
        ];
        for frame in &decoded {
            let start = result.duration;
            result.duration = frame.get_time_ms();
            if result
                .frames
                .last()
                .map(|(_, t)| start - t >= 50)
                .unwrap_or(true)
            {
                let pixels = image::RgbaImage::from_raw(
                    frame.width(),
                    frame.height(),
                    frame.get_image().to_vec(),
                )
                .ok_or("动态 WebP 帧无效")?;
                let (w, h) = target_dimensions(frame.width(), frame.height(), settings);
                let (w, h) = fit(w, h, edge);
                result.frames.push((resize_frame(&pixels, w, h), start));
            }
        }
    }
    if result.frames.is_empty() {
        return Err("动图没有可编码帧".into());
    }
    Ok(result)
}

fn select_frames(
    animation: &SizedAnimation,
    fps: u32,
    width: u32,
    height: u32,
) -> Vec<(image::RgbaImage, i32)> {
    let mut result: Vec<(image::RgbaImage, i32)> = Vec::new();
    for (pixels, start) in &animation.frames {
        if result
            .last()
            .map(|(_, t)| start - t >= (1000 / fps.max(1)) as i32)
            .unwrap_or(true)
        {
            result.push((resize_frame(pixels, width, height), *start));
        }
    }
    result
}

// The webp wrapper finalises with timestamp zero and guesses the last delay.
// Update that delay in the ANMF header to the exact source end timestamp.
fn finish_webp_duration(bytes: &mut [u8], duration: i32) -> Result<(), String> {
    let mut offset = 12usize;
    let mut last = None;
    let mut total = 0i64;
    while offset + 8 <= bytes.len() {
        let length = u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap()) as usize;
        let end = offset
            .checked_add(8)
            .and_then(|v| v.checked_add(length))
            .ok_or("WebP 长度无效")?;
        if end > bytes.len() {
            return Err("WebP 数据不完整".into());
        }
        if &bytes[offset..offset + 4] == b"ANMF" && length >= 16 {
            let p = offset + 20;
            let delay =
                bytes[p] as i64 | ((bytes[p + 1] as i64) << 8) | ((bytes[p + 2] as i64) << 16);
            total += delay;
            last = Some((p, delay));
        }
        offset = end + (length & 1);
    }
    if let Some((p, old)) = last {
        let delay = old + duration as i64 - total;
        if !(1..=0xffffff).contains(&delay) {
            return Err("WebP 帧时长超过编码范围".into());
        }
        bytes[p] = delay as u8;
        bytes[p + 1] = (delay >> 8) as u8;
        bytes[p + 2] = (delay >> 16) as u8;
    }
    Ok(())
}

fn encode_webp(
    frames: &[(image::RgbaImage, i32)],
    animation: &SizedAnimation,
    quality: u8,
) -> Result<Vec<u8>, String> {
    let (width, height) = frames[0].0.dimensions();
    let mut config = WebPConfig::new().map_err(|_| "WebP 配置失败")?;
    config.quality = quality as f32;
    config.method = 1;
    config.thread_level = 1;
    config.alpha_quality = 80;
    let mut encoder = AnimatedWebPEncoder::new(width, height, &config);
    encoder.set_loop_count(animation.loop_count);
    encoder.set_bgcolor(animation.background);
    for (pixels, start) in frames {
        encoder.add_frame(AnimatedWebPFrame::from_rgba(
            pixels.as_raw(),
            width,
            height,
            *start,
        ));
    }
    let mut output = encoder
        .try_encode()
        .map_err(|e| format!("WebP 编码失败：{e:?}"))?
        .to_vec();
    finish_webp_duration(&mut output, animation.duration)?;
    Ok(output)
}

fn encode_gif(
    frames: &[(image::RgbaImage, i32)],
    animation: &SizedAnimation,
    quality: u8,
) -> Result<Vec<u8>, String> {
    let (width, height) = frames[0].0.dimensions();
    let levels = if quality >= 65 {
        6usize
    } else if quality >= 35 {
        4
    } else {
        3
    };
    let transparent = levels.pow(3) as u8;
    let mut palette = Vec::new();
    for r in 0..levels {
        for g in 0..levels {
            for b in 0..levels {
                palette.extend([
                    (r * 255 / (levels - 1)) as u8,
                    (g * 255 / (levels - 1)) as u8,
                    (b * 255 / (levels - 1)) as u8,
                ]);
            }
        }
    }
    palette.extend([0, 0, 0]);
    let mut output = Vec::new();
    let mut encoder = gif::Encoder::new(&mut output, width as u16, height as u16, &palette)
        .map_err(|e| e.to_string())?;
    encoder
        .set_repeat(if animation.loop_count == 0 {
            gif::Repeat::Infinite
        } else {
            gif::Repeat::Finite(animation.loop_count as u16)
        })
        .map_err(|e| e.to_string())?;
    let mut previous: Option<Vec<u8>> = None;
    for (i, (pixels, start)) in frames.iter().enumerate() {
        let mut indices = Vec::with_capacity((width * height) as usize);
        for pixel in pixels.pixels() {
            if pixel.0[3] < 128 {
                indices.push(transparent);
                continue;
            }
            let channels: [usize; 3] = std::array::from_fn(|c| {
                (pixel.0[c] as f32 * (levels - 1) as f32 / 255.0)
                    .round()
                    .clamp(0.0, (levels - 1) as f32) as usize
            });
            indices
                .push((channels[0] * levels * levels + channels[1] * levels + channels[2]) as u8);
        }
        let opaque = !indices.contains(&transparent);
        let mut bounds = (0, 0, width, height);
        if opaque {
            if let Some(old) = previous.as_ref().filter(|v| !v.contains(&transparent)) {
                let (mut l, mut t, mut r, mut b) = (width, height, 0, 0);
                for y in 0..height {
                    for x in 0..width {
                        let p = (y * width + x) as usize;
                        if old[p] != indices[p] {
                            l = l.min(x);
                            t = t.min(y);
                            r = r.max(x + 1);
                            b = b.max(y + 1);
                        }
                    }
                }
                bounds = if r == 0 {
                    (0, 0, 1, 1)
                } else {
                    (l, t, r - l, b - t)
                };
            }
        }
        let (left, top, w, h) = bounds;
        let mut buffer = Vec::with_capacity((w * h) as usize);
        for y in top..top + h {
            buffer.extend_from_slice(
                &indices[(y * width + left) as usize..(y * width + left + w) as usize],
            );
        }
        let end = frames
            .get(i + 1)
            .map(|(_, t)| *t)
            .unwrap_or(animation.duration);
        let mut frame = gif::Frame::default();
        frame.width = w as u16;
        frame.height = h as u16;
        frame.left = left as u16;
        frame.top = top as u16;
        // Round cumulative timestamps, rather than each delay, to avoid drift.
        frame.delay = ((end + 5) / 10 - (start + 5) / 10)
            .max(1)
            .min(u16::MAX as i32) as u16;
        frame.buffer = Cow::Owned(buffer);
        frame.transparent = Some(transparent);
        frame.dispose = if opaque {
            gif::DisposalMethod::Keep
        } else {
            gif::DisposalMethod::Background
        };
        encoder.write_frame(&frame).map_err(|e| e.to_string())?;
        previous = Some(indices);
    }
    drop(encoder);
    Ok(output)
}

pub(super) fn target_bytes(settings: &WatcherSettings) -> usize {
    if settings.mode == "lossless" {
        return 0;
    }
    if settings.target_size_kb > 0 {
        return settings.target_size_kb as usize * 1024;
    }
    if matches!(settings.mode.as_str(), "auto" | "balanced" | "small") {
        500 * 1024
    } else {
        0
    }
}

pub(super) fn optimize(
    data: &[u8],
    extension: &str,
    settings: &WatcherSettings,
    target: usize,
) -> Result<OptimizedImage, String> {
    if !matches!(
        settings.format.as_str(),
        "keep" | "image/gif" | "image/webp"
    ) || (extension == "webp" && settings.format == "image/gif")
    {
        return Err("动态图片只能输出 GIF 或动态 WebP".into());
    }
    let same_format = settings.format == "keep" || settings.format == format!("image/{extension}");
    if settings.mode == "manual"
        && data.len() <= target
        && settings.scale == 100.0
        && !settings.resize
        && same_format
    {
        return Ok(OptimizedImage {
            bytes: data.to_vec(),
            extension: extension.into(),
        });
    }
    let max_edge = if target <= 256 * 1024 { 640 } else { 1024 };
    let animation = decode_sized(data, extension, settings, max_edge)?;
    let (mut width, mut height) = animation.frames[0].0.dimensions();
    let mut best = OptimizedImage {
        bytes: data.to_vec(),
        extension: extension.into(),
    };
    let qualities = [72, 58, 44, 34, 25, 18];
    let rates = [20, 15, 12, 10, 8, 6];
    for (stage, quality) in qualities.into_iter().enumerate() {
        let quality = quality.min(settings.quality.max(1));
        let frames = select_frames(&animation, rates[stage], width, height);
        let allow_webp = settings.format == "image/webp"
            || extension == "webp"
            || (settings.format == "keep" && settings.mode != "manual");
        let allow_gif = extension == "gif" && settings.format != "image/webp";
        let mut stage_size = usize::MAX;
        for format in ["webp", "gif"] {
            if (format == "webp" && !allow_webp) || (format == "gif" && !allow_gif) {
                continue;
            }
            let encoded = if format == "webp" {
                encode_webp(&frames, &animation, quality)?
            } else {
                encode_gif(&frames, &animation, quality)?
            };
            stage_size = stage_size.min(encoded.len());
            if encoded.len() < best.bytes.len() {
                best = OptimizedImage {
                    bytes: encoded,
                    extension: format.into(),
                };
            }
        }
        if best.bytes.len() <= target {
            break;
        }
        let factor = ((target as f64 / stage_size.max(1) as f64).sqrt() * 0.92).clamp(0.5, 0.85);
        let edge = ((width.max(height) as f64 * factor).round() as u32)
            .max(32)
            .min(width.max(height));
        (width, height) = fit(width, height, edge);
    }
    Ok(best)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (Vec<u8>, SizedAnimation) {
        let mut animation = SizedAnimation {
            frames: Vec::new(),
            duration: 1800,
            loop_count: 3,
            background: [0; 4],
        };
        for i in 0..18 {
            let pixels = image::RgbaImage::from_fn(96, 64, |x, y| {
                image::Rgba([
                    ((x * 23 + y * 17 + i * 19) % 256) as u8,
                    ((x * 31 + y * 11 + i * 13) % 256) as u8,
                    ((x * 7 + y * 29 + i * 41) % 256) as u8,
                    if x < 4 { 0 } else { 255 },
                ])
            });
            animation.frames.push((pixels, i as i32 * 100));
        }
        let bytes = encode_gif(&animation.frames, &animation, 90).unwrap();
        (bytes, animation)
    }
    fn settings(mode: &str, format: &str, cap: u32) -> WatcherSettings {
        let mut s = super::super::tests::watch_test_settings(Path::new("/tmp"));
        s.mode = mode.into();
        s.format = format.into();
        s.resize = false;
        s.scale = 100.0;
        s.target_size_kb = cap;
        s.quality = 82;
        s
    }
    #[test]
    fn smart_animation_defaults_to_500kb_and_manual_retains_no_limit() {
        assert_eq!(target_bytes(&settings("auto", "keep", 0)), 500 * 1024);
        assert_eq!(target_bytes(&settings("manual", "keep", 0)), 0);
        assert_eq!(target_bytes(&settings("auto", "keep", 50)), 50 * 1024);
        assert_eq!(target_bytes(&settings("lossless", "keep", 0)), 0);
    }
    #[test]
    fn gif_solid_colors_remain_solid_without_added_dot_patterns() {
        let animation = SizedAnimation {
            frames: vec![
                (
                    image::RgbaImage::from_pixel(32, 24, image::Rgba([128, 128, 128, 255])),
                    0,
                ),
                (
                    image::RgbaImage::from_pixel(32, 24, image::Rgba([85, 85, 85, 255])),
                    100,
                ),
            ],
            duration: 200,
            loop_count: 0,
            background: [0; 4],
        };
        let bytes = encode_gif(&animation.frames, &animation, 72).unwrap();
        let frames = GifDecoder::new(Cursor::new(bytes))
            .unwrap()
            .into_frames()
            .collect_frames()
            .unwrap();
        assert_eq!(frames.len(), 2);
        for frame in frames {
            let first = frame.buffer().get_pixel(0, 0);
            assert!(frame.buffer().pixels().all(|pixel| pixel == first));
        }
    }

    #[test]
    fn gif_target_reduces_size_preserving_time_loop_and_transparency() {
        let (original, _) = fixture();
        let result = optimize(&original, "gif", &settings("manual", "keep", 6), 6 * 1024).unwrap();
        assert_eq!(result.extension, "gif");
        assert!(result.bytes.len() <= 6 * 1024);
        let mut d = gif::DecodeOptions::new()
            .read_info(Cursor::new(&result.bytes))
            .unwrap();
        let mut time = 0;
        let mut count = 0;
        while let Some(f) = d.read_next_frame().unwrap() {
            time += f.delay as u32 * 10;
            count += 1;
            assert!(f.transparent.is_some());
        }
        assert_eq!(time, 1800);
        assert!(count >= 2);
        assert_eq!(d.repeat(), gif::Repeat::Finite(3));
    }
    #[test]
    fn webp_target_keeps_animation_timing_loop_and_reported_dimensions() {
        let (_, animation) = fixture();
        let original = encode_webp(&animation.frames, &animation, 86).unwrap();
        let s = settings("auto", "keep", 6);
        let result = optimize(&original, "webp", &s, 6 * 1024).unwrap();
        assert_eq!(result.extension, "webp");
        assert!(result.bytes.len() <= 6 * 1024);
        let d = AnimatedWebPDecoder::new(&result.bytes).decode().unwrap();
        assert!(d.has_animation());
        assert_eq!(d.loop_count, 3);
        assert_eq!(d.into_iter().last().unwrap().get_time_ms(), 1800);
    }
    #[test]
    fn dropping_frames_preserves_total_duration_with_uneven_delays() {
        let (_, mut animation) = fixture();
        animation.frames[1].1 = 70;
        animation.frames[2].1 = 210;
        let frames = select_frames(&animation, 6, 48, 32);
        assert!(frames.len() < animation.frames.len());
        let result = encode_webp(&frames, &animation, 44).unwrap();
        let d = AnimatedWebPDecoder::new(&result).decode().unwrap();
        assert_eq!(d.into_iter().last().unwrap().get_time_ms(), 1800);
        assert_eq!(fit(1000, 20, 100), (100, 2));
    }
}
