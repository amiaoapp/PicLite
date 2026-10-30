use super::*;
use std::sync::mpsc::{self, Sender};

#[derive(Default)]
pub struct CropRequests(Mutex<HashMap<String, PendingCrop>>);
struct PendingCrop {
    source: String,
    sender: Sender<Option<String>>,
    applying: bool,
}
impl CropRequests {
    fn source(&self, token: &str, label: &str) -> Result<String, String> {
        if label != format!("crop-{token}") { return Err("Invalid crop request identity".into()); }
        self.0.lock().unwrap_or_else(|e| e.into_inner()).get(token)
            .map(|p| p.source.clone()).ok_or_else(|| "Crop request expired".into())
    }
    fn cancel(&self, token: &str) {
        if let Some(p) = self.0.lock().unwrap_or_else(|e| e.into_inner()).remove(token) {
            let _ = p.sender.send(None);
        }
    }
    fn complete(&self, token: &str, output: String) -> bool {
        if let Some(p) = self.0.lock().unwrap_or_else(|e| e.into_inner()).remove(token) {
            return p.sender.send(Some(output)).is_ok();
        }
        false
    }
}

fn validated_source(path: &str) -> Result<String, String> {
    let source = Path::new(path);
    if !source.is_absolute() || !source.is_file() { return Err("Invalid crop source".into()); }
    let source = fs::canonicalize(source).map_err(|e| e.to_string())?;
    let bytes = fs::read(&source).map_err(|e| e.to_string())?;
    if image::guess_format(&bytes).ok() == Some(image::ImageFormat::Gif)
        || is_animated_webp(&bytes) || bytes.windows(4).any(|c| c == b"acTL") {
        return Err("动图暂不支持裁剪 / Cropping animated images is not supported".into());
    }
    decode_static_oriented(&bytes)?;
    Ok(source.to_string_lossy().into_owned())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CropSource { path: String, name: String, width: u32, height: u32, preview: String }

#[tauri::command]
pub async fn open_crop_editor(app: AppHandle, window: tauri::WebviewWindow, path: String) -> Result<Option<String>, String> {
    if !matches!(window.label(), "main" | "dropzone" | "preferences") { return Err("Invalid crop caller".into()); }
    let source = tauri::async_runtime::spawn_blocking(move || validated_source(&path)).await.map_err(|e| e.to_string())??;
    static SEQUENCE: AtomicU64 = AtomicU64::new(1);
    let token = format!("{:x}-{:x}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos(), SEQUENCE.fetch_add(1, Ordering::Relaxed));
    let label = format!("crop-{token}");
    let (sender, receiver) = mpsc::channel();
    app.state::<CropRequests>().0.lock().unwrap_or_else(|e| e.into_inner()).insert(token.clone(), PendingCrop { source, sender, applying: false });
    let result = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(format!("index.html?window=crop&request={token}").into()))
        .title("裁剪图片 · PicLite").inner_size(960.0, 660.0).min_inner_size(700.0, 480.0)
        .resizable(true).center().build();
    if let Err(error) = result { app.state::<CropRequests>().cancel(&token); return Err(error.to_string()); }
    tauri::async_runtime::spawn_blocking(move || receiver.recv().unwrap_or(None)).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_crop_editor_source(app: AppHandle, window: tauri::WebviewWindow, request: String) -> Result<CropSource, String> {
    let path = app.state::<CropRequests>().source(&request, window.label())?;
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = fs::read(&path).map_err(|e| e.to_string())?;
        let image = decode_static_oriented(&bytes)?;
        let (width, height) = (image.width(), image.height());
        let display = image.thumbnail(2400, 2400);
        let mut encoded = Cursor::new(Vec::new());
        display.write_to(&mut encoded, image::ImageFormat::Png).map_err(|e| e.to_string())?;
        let name = Path::new(&path).file_name().unwrap_or_default().to_string_lossy().into_owned();
        Ok(CropSource { path, name, width, height, preview: format!("data:image/png;base64,{}", BASE64.encode(encoded.get_ref())) })
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn finish_crop_editor(app: AppHandle, window: tauri::WebviewWindow, request: String, edit: Option<floating_editor::ImageEdit>) -> Result<(), String> {
    let path = app.state::<CropRequests>().source(&request, window.label())?;
    if let Some(edit) = edit {
        {
            let state = app.state::<CropRequests>();
            let mut pending = state.0.lock().unwrap_or_else(|e| e.into_inner());
            let item = pending.get_mut(&request).ok_or("Crop request expired")?;
            if item.applying { return Err("Crop already applying".into()); }
            item.applying = true;
        }
        let output = floating_editor::edit_floating_image(path, edit).await;
        match output {
            Ok(output) => {
                if !app.state::<CropRequests>().complete(&request, output.clone()) {
                    // Closing during encoding cancels the request, including its unused new file.
                    let _ = fs::remove_file(output);
                }
            }
            Err(error) => {
                if let Some(p) = app.state::<CropRequests>().0.lock().unwrap_or_else(|e| e.into_inner()).get_mut(&request) { p.applying = false; }
                return Err(error);
            }
        }
    } else { app.state::<CropRequests>().cancel(&request); }
    let _ = window.close();
    Ok(())
}

pub fn window_closed(app: &AppHandle, label: &str) {
    if let Some(token) = label.strip_prefix("crop-") { app.state::<CropRequests>().cancel(token); }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn requests_are_isolated_authorized_and_cancel_exactly_once() {
        let requests = CropRequests::default();
        let (a, ar) = mpsc::channel(); let (b, br) = mpsc::channel();
        let mut map = requests.0.lock().unwrap();
        map.insert("a".into(), PendingCrop { source: "/a.png".into(), sender: a, applying: false });
        map.insert("b".into(), PendingCrop { source: "/b.png".into(), sender: b, applying: false }); drop(map);
        assert!(requests.source("a", "crop-b").is_err());
        assert_eq!(requests.source("a", "crop-a").unwrap(), "/a.png");
        requests.cancel("a"); requests.cancel("a");
        assert_eq!(ar.recv().unwrap(), None);
        assert!(br.try_recv().is_err());
        assert!(requests.complete("b", "/new.png".into()));
        assert_eq!(br.recv().unwrap(), Some("/new.png".into()));
        assert!(!requests.complete("b", "/again.png".into()));
    }
    #[test]
    fn source_rejects_relative_and_non_image_paths() {
        assert!(validated_source("relative.png").is_err());
        assert!(validated_source(concat!(env!("CARGO_MANIFEST_DIR"), "/Cargo.toml")).is_err());
    }
}
