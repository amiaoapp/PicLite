use super::*;

pub(super) fn is_heic(data: &[u8]) -> bool {
    if data.len() < 16 || &data[4..8] != b"ftyp" {
        return false;
    }
    let size = u32::from_be_bytes(data[..4].try_into().unwrap()) as usize;
    if size < 16 || size > data.len() {
        return false;
    }
    let brands = std::iter::once(&data[8..12]).chain(data[16..size].chunks_exact(4));
    brands.into_iter().any(|b| {
        matches!(
            b,
            b"heic" | b"heix" | b"hevc" | b"hevx" | b"heim" | b"heis" | b"hevm" | b"hevs"
        )
    })
}

pub(super) fn dimensions(data: &[u8]) -> Result<(u32, u32), String> {
    let info = heic_rs::probe(data).map_err(|e| format!("无法读取 HEIC／HEIF 信息：{e}"))?;
    Ok((info.width, info.height))
}

pub(super) fn decode(data: &[u8]) -> Result<DynamicImage, String> {
    let options = heic_rs::DecodeOptions {
        layout: heic_rs::PixelLayout::Rgba8,
        max_pixels: Some(100_000_000),
        ..Default::default()
    };
    let decoded =
        heic_rs::decode(data, &options).map_err(|e| format!("无法解码 HEIC／HEIF 照片：{e}"))?;
    image::RgbaImage::from_raw(decoded.width, decoded.height, decoded.data)
        .map(DynamicImage::ImageRgba8)
        .ok_or_else(|| "HEIC／HEIF 像素数据不完整".into())
}

pub(super) fn preview(data: &[u8]) -> Result<Option<(Vec<u8>, u32, u32)>, String> {
    if !is_heic(data) {
        return Ok(None);
    }
    let image = decode(data)?;
    let (width, height) = image.dimensions();
    // Browser engines do not uniformly decode HEIC. Use a full-resolution,
    // pixel-lossless proxy so comparing a source photo cannot introduce its
    // own scaling or compression artifacts. This proxy is never exported.
    let rgba = image.to_rgba8();
    let mut encoded = Vec::new();
    PngEncoder::new_with_quality(&mut encoded, CompressionType::Fast, PngFilterType::Adaptive)
        .write_image(&rgba, width, height, image::ExtendedColorType::Rgba8)
        .map_err(|e| e.to_string())?;
    Ok(Some((encoded, width, height)))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn detects_heic_compatible_brands_without_misclassifying_avif() {
        assert!(is_heic(b"\0\0\0\x18ftypmif1\0\0\0\0heicmif1"));
        assert!(!is_heic(b"\0\0\0\x18ftypavif\0\0\0\0avifmif1"));
        assert!(!is_heic(b"\0\0\0\x18ftypheic"));
    }
}

#[cfg(test)]
mod integration_tests {
    use super::*;
    const PHOTO: &[u8] = include_bytes!("../../tests/fixtures/apple-photo.heic");
    #[test]
    fn decodes_apple_heic_and_converts_to_the_existing_output_formats() {
        assert!(is_heic(PHOTO));
        assert_eq!(dimensions(PHOTO).unwrap(), (64, 64));
        assert_eq!(
            decode_static_oriented(PHOTO).unwrap().dimensions(),
            (64, 64)
        );
        let mut settings = super::super::tests::watch_test_settings(Path::new("/tmp"));
        settings.resize = false;
        settings.prevent_larger = false;
        for (format, ext) in [
            ("image/jpeg", "jpg"),
            ("image/png", "png"),
            ("image/webp", "webp"),
        ] {
            settings.format = format.into();
            let result = optimize_image_data(PHOTO.to_vec(), "heic".into(), &settings).unwrap();
            assert_eq!(result.extension, ext);
            assert_eq!(
                image::load_from_memory(&result.bytes).unwrap().dimensions(),
                (64, 64)
            );
        }
        settings.format = "keep".into();
        assert_eq!(
            optimize_image_data(PHOTO.to_vec(), "heif".into(), &settings)
                .unwrap()
                .extension,
            "webp"
        );
    }
    #[test]
    fn decodes_camera_style_heic_tile_grids_with_display_dimensions() {
        let photo = include_bytes!("../../tests/fixtures/apple-grid.heic");
        let info = heic_rs::probe(photo).unwrap();
        assert!(info.is_grid);
        assert_eq!(dimensions(photo).unwrap(), (1024, 1024));
        assert_eq!(decode(photo).unwrap().dimensions(), (1024, 1024));
    }
    #[test]
    fn import_exposes_a_displayable_preview_and_preserves_original_file_bytes() {
        let root = std::env::temp_dir().join(format!("piclite-heic-{}", now_ms()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("Apple Photo.HEIF");
        fs::write(&path, PHOTO).unwrap();
        assert!(is_image(&path));
        assert_eq!(mime_for(&path), "image/heif");
        let state = DesktopState::default();
        let entries =
            native_image_entries_from_paths_with_progress(vec![path.clone()], &state, |_, _| {})
                .unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].original_bytes, PHOTO.len() as u64);
        assert_eq!(entries[0].width, 64);
        let images =
            native_images_from_paths(vec![path.to_string_lossy().to_string()], &state).unwrap();
        assert_eq!(BASE64.decode(&images[0].data).unwrap(), PHOTO);
        assert_eq!(images[0].preview_type.as_deref(), Some("image/png"));
        assert_eq!(
            image::guess_format(
                &BASE64
                    .decode(images[0].preview_data.as_ref().unwrap())
                    .unwrap()
            )
            .unwrap(),
            image::ImageFormat::Png
        );
        let proxy = BASE64
            .decode(images[0].preview_data.as_ref().unwrap())
            .unwrap();
        assert_eq!(
            image::load_from_memory(&proxy).unwrap().to_rgba8(),
            decode(PHOTO).unwrap().to_rgba8()
        );
        fs::remove_dir_all(root).unwrap();
    }
}
