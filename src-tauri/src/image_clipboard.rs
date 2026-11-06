//! Publish encoded result bytes and image compatibility formats in one copy.
//! Original image types remain available alongside browser file representations.
//! Windows also needs standard bitmap formats for image-only paste targets.
use super::*;
use image::ImageFormat;

#[cfg(target_os = "macos")]
static CLIPBOARD_COPY_ID: AtomicU64 = AtomicU64::new(0);

pub(super) fn read_image_file(path: &Path) -> Result<ClipboardImage, String> {
    let data = fs::read(path).map_err(|e| e.to_string())?;
    encoded_payload(data, path.file_name().map(|v| v.to_string_lossy().into_owned()))
}
fn encoded_payload(data: Vec<u8>, name: Option<String>) -> Result<ClipboardImage, String> {
    if data.is_empty() || data.len() > 128 * 1024 * 1024 { return Err("剪贴板图片无效或超过 128 MB".into()); }
    let (_, mime) = image_types(&data)?;
    let extension = match mime { "image/jpeg"=>"jpg", "image/vnd.microsoft.icon"=>"ico", "image/x-tga"=>"tga", other=>other.trim_start_matches("image/") };
    let name = name.filter(|name| !name.is_empty()).map(|name| safe_file_name(&name))
        .unwrap_or_else(|| format!("clipboard-{}.{}",now_ms(),extension));
    Ok(ClipboardImage { data: BASE64.encode(data), name, mime: mime.into() })
}
#[cfg(target_os = "macos")]
fn read_macos(board: &objc2_app_kit::NSPasteboard) -> Result<Option<ClipboardImage>, String> {
    use objc2_foundation::NSString;
    let Some(items) = board.pasteboardItems() else { return Ok(None); };
    for item in items.iter() {
        let types = item.types();
        let is_result = types.iter().any(|t| t.to_string() == "com.piclite.image-result");
        if !is_result && types.iter().any(|t| matches!(t.to_string().as_str(), "public.file-url" | "NSFilenamesPboardType")) { continue; }
        let name = item.stringForType(&NSString::from_str("com.piclite.image-result"))
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw.to_string()).ok())
            .and_then(|meta| meta["name"].as_str().map(str::to_owned));
        // Check owner-provided representations before requesting AppKit's TIFF.
        for uti in ["org.webmproject.webp","public.jpeg","public.png","com.compuserve.gif","public.avif","public.heic","com.microsoft.bmp","public.tiff"] {
            if !types.iter().any(|t| t.to_string() == uti) { continue; }
            if let Some(data) = item.dataForType(&NSString::from_str(uti)) {
                return encoded_payload(data.to_vec(),name).map(Some);
            }
        }
    }
    Ok(None)
}
pub(super) fn read_encoded() -> Result<Option<ClipboardImage>, String> {
    #[cfg(target_os = "macos")]
    { objc2::rc::autoreleasepool(|_| read_macos(&objc2_app_kit::NSPasteboard::generalPasteboard())) }
    #[cfg(not(target_os = "macos"))]
    {
        if let Some(paths) = clipboard_file_image_paths()? {
            return paths.first().map(|path| read_image_file(Path::new(path))).transpose();
        }
        #[cfg(target_os = "linux")]
        for (program, list_args, type_args) in [
            ("wl-paste",vec!["--list-types"],vec!["--no-newline","--type"]),
            ("xclip",vec!["-selection","clipboard","-o","-t","TARGETS"],vec!["-selection","clipboard","-o","-t"]),
        ] {
            let Ok(types) = Command::new(program).args(list_args).output() else { continue; };
            if !types.status.success() { continue; }
            for mime in ["image/webp","image/jpeg","image/png","image/gif","image/avif","image/tiff"] {
                if !String::from_utf8_lossy(&types.stdout).lines().any(|t|t.trim()==mime) {continue;}
                let output = Command::new(program).args(&type_args).arg(mime).output().map_err(|e|e.to_string())?;
                if output.status.success() { return encoded_payload(output.stdout,None).map(Some); }
            }
        }
        Ok(None)
    }
}

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
        let _ = mime;
        objc2::rc::autoreleasepool(|_| {
            write_macos(&objc2_app_kit::NSPasteboard::generalPasteboard(), path, data, uti)
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
    path: &Path,
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
    // Browsers consume a file representation without PNG re-encoding, retaining
    // its encoded bytes and filename. Native consumers still receive an image.
    // The marker lets PicLite/Qimiao distinguish this from a Finder file copy.
    let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
    let snapshot = std::env::temp_dir().join("piclite-clipboard-results")
        .join(format!("{}-{}-{}", std::process::id(), now_ms(), CLIPBOARD_COPY_ID.fetch_add(1, Ordering::Relaxed)))
        .join(&name);
    fs::create_dir_all(snapshot.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::write(&snapshot, data).map_err(|e| e.to_string())?;
    let url = url::Url::from_file_path(&snapshot).map_err(|_| "Invalid clipboard result path")?;
    if !item.setString_forType(&NSString::from_str(url.as_str()), &NSString::from_str("public.file-url")) ||
       !item.setString_forType(&NSString::from_str(&serde_json::json!({"name":name}).to_string()), &NSString::from_str("com.piclite.image-result")) {
        return Err("无法准备浏览器原格式图片".into());
    }
    // QOI alone needs a compatibility image on macOS.
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
                let path = std::env::temp_dir().join(format!("expected-result.{}", if format == ImageFormat::WebP {"webp"} else if format == ImageFormat::Jpeg {"jpg"} else {"png"}));
                write_macos(&board, &path, &data, uti).unwrap();
                let copied = board.dataForType(&NSString::from_str(uti)).unwrap();
                assert_eq!(unsafe { copied.as_bytes_unchecked() }, data);
                assert!(
                    objc2_app_kit::NSImage::canInitWithPasteboard(&board),
                    "Encoded result must be recognised as an image"
                );
                let imported = read_macos(&board).unwrap().unwrap();
                assert_eq!(BASE64.decode(imported.data).unwrap(),data);
                assert_eq!(imported.name,path.file_name().unwrap().to_string_lossy());
                let url = board.stringForType(&NSString::from_str("public.file-url")).unwrap();
                let snapshot = url::Url::parse(&url.to_string()).unwrap().to_file_path().unwrap();
                assert_eq!(fs::read(&snapshot).unwrap(),data);
                assert_eq!(snapshot.file_name(),path.file_name());
                fs::remove_dir_all(snapshot.parent().unwrap()).unwrap();
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
