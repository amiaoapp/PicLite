//! Publish encoded result bytes and image compatibility formats in one copy.
//! macOS receives the original image type with no file URL or large bitmap.
//! Windows also needs standard bitmap formats for image-only paste targets.
use super::*;
use image::ImageFormat;

fn image_types(data: &[u8]) -> Result<(&'static str, &'static str), String> {
    if heic_input::is_heic(data) {
        return Ok(("public.heic", "image/heic"));
    }
    match image::guess_format(data).map_err(|e| e.to_string())? {
        ImageFormat::Png => Ok(("public.png", "image/png")),
        ImageFormat::Jpeg => Ok(("public.jpeg", "image/jpeg")),
        ImageFormat::WebP => Ok(("org.webmproject.webp", "image/webp")),
        ImageFormat::Gif => Ok(("com.compuserve.gif", "image/gif")),
        ImageFormat::Tiff => Ok(("public.tiff", "image/tiff")),
        ImageFormat::Bmp => Ok(("com.microsoft.bmp", "image/bmp")),
        ImageFormat::Avif => Ok(("public.avif", "image/avif")),
        ImageFormat::Ico => Ok(("com.microsoft.ico", "image/vnd.microsoft.icon")),
        ImageFormat::Tga => Ok(("com.truevision.tga-image", "image/x-tga")),
        ImageFormat::Qoi => Ok(("org.phoboslab.qoi", "image/qoi")),
        _ => Err("此图片格式暂不支持复制，请先转换为 PNG、JPEG 或 WebP".into()),
    }
}

pub(super) fn write_result(path: &Path, data: &[u8]) -> Result<(), String> {
    let (uti, mime) = image_types(data)?;
    #[cfg(target_os = "macos")]
    {
        let _ = (path, mime);
        objc2::rc::autoreleasepool(|_| {
            write_macos(&objc2_app_kit::NSPasteboard::generalPasteboard(), data, uti)
        })
    }
    #[cfg(target_os = "windows")]
    {
        let _ = uti;
        write_windows(path, data, mime)
    }
    #[cfg(target_os = "linux")]
    {
        let _ = (path, uti);
        for (program, args) in [
            ("wl-copy", vec!["--type", mime]),
            ("xclip", vec!["-selection", "clipboard", "-t", mime, "-i"]),
        ] {
            let Ok(mut child) = Command::new(program)
                .args(args)
                .stdin(std::process::Stdio::piped())
                .spawn()
            else {
                continue;
            };
            let written = child
                .stdin
                .take()
                .map(|mut stdin| stdin.write_all(data).is_ok())
                .unwrap_or(false);
            if child.wait().is_ok_and(|status| status.success()) && written {
                return Ok(());
            }
        }
        Err("无法复制原格式图片，请安装 wl-clipboard 或 xclip".into())
    }
}

#[cfg(target_os = "macos")]
fn write_macos(
    pasteboard: &objc2_app_kit::NSPasteboard,
    data: &[u8],
    uti: &str,
) -> Result<(), String> {
    use objc2::runtime::ProtocolObject;
    use objc2_app_kit::{NSPasteboardItem, NSPasteboardWriting};
    use objc2_foundation::{NSArray, NSData, NSString};

    let item = NSPasteboardItem::new();
    // Put the actual encoded result first, with no decode/re-encode cycle.
    if !item.setData_forType(&NSData::with_bytes(data), &NSString::from_str(uti)) {
        return Err("无法准备压缩图片剪贴板数据".into());
    }
    // AppKit recognises encoded WebP/JPEG/PNG directly. A file URL makes
    // clipboard managers classify it as a file; a PNG fallback makes them store
    // the expanded PNG instead of the compressed WebP. Avoid both for native
    // image types. QOI alone needs a compatibility image on macOS.
    if uti == "org.phoboslab.qoi" {
        let decoded = decode_static_oriented(data)?;
        let mut png = Cursor::new(Vec::new());
        decoded
            .write_to(&mut png, ImageFormat::Png)
            .map_err(|e| e.to_string())?;
        if !item.setData_forType(
            &NSData::with_bytes(png.get_ref()),
            &NSString::from_str("public.png"),
        ) {
            return Err("无法准备图片兼容数据".into());
        }
    }
    let object: objc2::rc::Retained<ProtocolObject<dyn NSPasteboardWriting>> =
        ProtocolObject::from_retained(item);
    pasteboard.clearContents();
    if pasteboard.writeObjects(&NSArray::from_retained_slice(&[object])) {
        Ok(())
    } else {
        Err("系统未能复制压缩图片".into())
    }
}

#[cfg(target_os = "windows")]
fn write_windows(path: &Path, data: &[u8], mime: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);
    let decoded = decode_static_oriented(data)?;
    let png_path = std::env::temp_dir().join(format!(
        "piclite-clipboard-{}-{}-{}.png",
        std::process::id(),
        now_ms(),
        NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
    ));
    let mut png = Cursor::new(Vec::new());
    decoded
        .write_to(&mut png, ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    let mut temp = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&png_path)
        .map_err(|e| e.to_string())?;
    if let Err(error) = temp.write_all(png.get_ref()) {
        drop(temp);
        let _ = fs::remove_file(&png_path);
        return Err(error.to_string());
    }
    drop(temp);
    // One DataObject carries the compressed file and its original MIME bytes,
    // plus PNG/Bitmap for apps that only accept standard Windows image formats.
    let script = r#"$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing;
$image=[Drawing.Image]::FromFile($env:PICLITE_CLIPBOARD_PNG); $png=New-Object IO.MemoryStream(,[IO.File]::ReadAllBytes($env:PICLITE_CLIPBOARD_PNG)); $encoded=New-Object IO.MemoryStream(,[IO.File]::ReadAllBytes($env:PICLITE_CLIPBOARD_FILE));
try { $data=New-Object Windows.Forms.DataObject; $data.SetData($env:PICLITE_CLIPBOARD_MIME,$false,$encoded); $data.SetData('PNG',$false,$png); $data.SetImage($image); $files=New-Object Collections.Specialized.StringCollection; [void]$files.Add($env:PICLITE_CLIPBOARD_FILE); $data.SetFileDropList($files); [Windows.Forms.Clipboard]::SetDataObject($data,$true,3,80) } finally { $image.Dispose(); $png.Dispose(); $encoded.Dispose() }"#;
    let result = Command::new("powershell.exe")
        .creation_flags(0x0800_0000)
        .env("PICLITE_CLIPBOARD_FILE", path)
        .env("PICLITE_CLIPBOARD_PNG", &png_path)
        .env("PICLITE_CLIPBOARD_MIME", mime)
        .args(["-NoProfile", "-NonInteractive", "-STA", "-Command", script])
        .status();
    let _ = fs::remove_file(&png_path);
    match result {
        Ok(status) if status.success() => Ok(()),
        Ok(status) => Err(format!("系统未能复制压缩图片：{status}")),
        Err(error) => Err(format!("无法写入系统剪贴板：{error}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encoded_format_is_detected_from_bytes_not_filename() {
        let image = DynamicImage::new_rgba8(12, 8);
        for (format, uti, mime) in [
            (ImageFormat::Png, "public.png", "image/png"),
            (ImageFormat::WebP, "org.webmproject.webp", "image/webp"),
        ] {
            let mut data = Cursor::new(Vec::new());
            image.write_to(&mut data, format).unwrap();
            assert_eq!(image_types(data.get_ref()).unwrap(), (uti, mime));
        }
        assert!(image_types(b"not an image").is_err());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_copy_keeps_exact_encoded_bytes_and_an_image_representation() {
        use objc2_app_kit::NSPasteboard;
        use objc2_foundation::NSString;
        objc2::rc::autoreleasepool(|_| {
            let board = NSPasteboard::pasteboardWithUniqueName();
            for format in [ImageFormat::WebP, ImageFormat::Png, ImageFormat::Jpeg] {
                let mut encoded = Cursor::new(Vec::new());
                DynamicImage::new_rgb8(20, 12)
                    .write_to(&mut encoded, format)
                    .unwrap();
                let data = encoded.into_inner();
                let (uti, _) = image_types(&data).unwrap();
                write_macos(&board, &data, uti).unwrap();
                let copied = board.dataForType(&NSString::from_str(uti)).unwrap();
                assert_eq!(unsafe { copied.as_bytes_unchecked() }, data);
                assert!(
                    objc2_app_kit::NSImage::canInitWithPasteboard(&board),
                    "Encoded result must be recognised as an image"
                );
                assert!(board
                    .stringForType(&NSString::from_str("public.file-url"))
                    .is_none());
                if format == ImageFormat::WebP {
                    assert!(
                        board
                            .dataForType(&NSString::from_str("public.png"))
                            .is_none(),
                        "Do not offer a larger re-encoded PNG for WebP results"
                    );
                }
                assert!(board
                    .stringForType(&NSString::from_str("public.utf8-plain-text"))
                    .is_none());
            }
            board.clearContents();
        });
    }
}
