use super::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageEdit {
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    output_width: u32,
    output_height: u32,
}

fn edit_image_file(source: &Path, edit: &ImageEdit) -> Result<PathBuf, String> {
    let bytes = fs::read(source).map_err(|e| e.to_string())?;
    // Never silently flatten a multi-frame input through a static decoder.
    if image::guess_format(&bytes).ok() == Some(image::ImageFormat::Gif)
        || is_animated_webp(&bytes)
        || bytes.windows(4).any(|chunk| chunk == b"acTL")
    {
        return Err(
            "动图暂不支持裁剪；原始动画保持不变 / Cropping animated images is not supported".into(),
        );
    }
    let image = decode_static_oriented(&bytes)?;
    let (w, h) = (image.width(), image.height());
    if edit.width == 0
        || edit.height == 0
        || edit.x >= w
        || edit.y >= h
        || edit.width > w - edit.x
        || edit.height > h - edit.y
        || edit.output_width == 0
        || edit.output_height == 0
        || edit.output_width > 16384
        || edit.output_height > 16384
        || u64::from(edit.output_width) * u64::from(edit.output_height) > 64_000_000
    {
        return Err("裁剪范围或输出尺寸无效 / Invalid crop or output dimensions".into());
    }
    let cropped = image.crop_imm(edit.x, edit.y, edit.width, edit.height);
    let output = cropped.resize_exact(edit.output_width, edit.output_height, FilterType::Lanczos3);
    let mut encoded = Cursor::new(Vec::new());
    output
        .write_to(&mut encoded, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    let directory = source.parent().ok_or("Missing image folder")?;
    let stem = source
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("image");
    let _guard = QUICK_OUTPUT_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let path = available_path(directory, &format!("{stem}-edited.png"))?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    file.write_all(encoded.get_ref())
        .map_err(|e| e.to_string())?;
    record_optimised_output(directory, &path)?;
    Ok(path)
}

#[tauri::command]
pub async fn edit_floating_image(path: String, edit: ImageEdit) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        edit_image_file(Path::new(&path), &edit).map(|p| p.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn save_result_copy(source: &Path, directory: &Path) -> Result<PathBuf, String> {
    let name = source
        .file_name()
        .and_then(|v| v.to_str())
        .ok_or("Invalid result filename")?;
    let bytes = fs::read(source).map_err(|e| e.to_string())?;
    let _guard = QUICK_OUTPUT_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let destination = available_path(directory, name)?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&destination)
        .map_err(|e| e.to_string())?;
    file.write_all(&bytes).map_err(|e| e.to_string())?;
    Ok(destination)
}

#[tauri::command]
pub async fn save_floating_result(path: String, folder: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        save_result_copy(Path::new(&path), Path::new(&folder))
            .map(|p| p.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crop_rejects_animation_and_out_of_bounds_without_creating_output() {
        let dir = std::env::temp_dir().join(format!("piclite-reject-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let source = dir.join("animated.gif");
        let mut bytes = Vec::new();
        {
            let mut encoder = gif::Encoder::new(&mut bytes, 4, 4, &[255, 0, 0]).unwrap();
            encoder
                .write_frame(&gif::Frame {
                    width: 4,
                    height: 4,
                    buffer: Cow::Owned(vec![0; 16]),
                    ..Default::default()
                })
                .unwrap();
        }
        fs::write(&source, &bytes).unwrap();
        let request = ImageEdit {
            x: 0,
            y: 0,
            width: 4,
            height: 4,
            output_width: 2,
            output_height: 2,
        };
        assert!(edit_image_file(&source, &request)
            .unwrap_err()
            .contains("animated"));
        assert_eq!(fs::read(&source).unwrap(), bytes);
        let still = dir.join("still.png");
        image::RgbaImage::new(2, 2).save(&still).unwrap();
        assert!(edit_image_file(&still, &request)
            .unwrap_err()
            .contains("Invalid crop"));
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 2);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn save_copy_preserves_bytes_and_existing_destination() {
        let dir = std::env::temp_dir().join(format!("piclite-save-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let source = dir.join("result.webp");
        fs::write(&source, b"exact encoded bytes").unwrap();
        let saved = save_result_copy(&source, &dir).unwrap();
        assert_ne!(source, saved);
        assert_eq!(fs::read(saved).unwrap(), b"exact encoded bytes");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn crop_resize_creates_real_pixels_without_overwriting_source_or_previous_output() {
        let dir = std::env::temp_dir().join(format!("piclite-crop-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let source = dir.join("source.png");
        let image = image::RgbaImage::from_fn(8, 6, |x, _| {
            if x < 4 {
                image::Rgba([255, 0, 0, 255])
            } else {
                image::Rgba([0, 0, 255, 255])
            }
        });
        image.save(&source).unwrap();
        let original = fs::read(&source).unwrap();
        let request = ImageEdit {
            x: 4,
            y: 0,
            width: 4,
            height: 6,
            output_width: 2,
            output_height: 3,
        };
        let first = edit_image_file(&source, &request).unwrap();
        let second = edit_image_file(&source, &request).unwrap();
        assert_ne!(first, second);
        let result = image::open(&first).unwrap().to_rgba8();
        assert_eq!(result.dimensions(), (2, 3));
        assert!(result.pixels().all(|p| p.0 == [0, 0, 255, 255]));
        assert_eq!(fs::read(&source).unwrap(), original);
        fs::remove_dir_all(dir).unwrap();
    }
}
