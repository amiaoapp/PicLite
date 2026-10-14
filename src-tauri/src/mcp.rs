//! Headless MCP stdio entry point; shares the desktop compression engine.
use super::*;
use serde_json::{json, Value};

fn tool(name: &str, description: &str, properties: Value, required: Value) -> Value {
    json!({"name":name,"description":description,"inputSchema":{"type":"object","properties":properties,"required":required,"additionalProperties":false}})
}
fn tools() -> Value {
    json!([
        tool("piclite_compress", "Compress or resize local images and animations. Writes a new file and never overwrites the source.", json!({
            "paths":{"type":"array","items":{"type":"string"},"minItems":1,"maxItems":100},
            "quality":{"type":"integer","minimum":1,"maximum":100},
            "scale":{"type":"number","minimum":0.1,"maximum":100},
            "format":{"type":"string","enum":["keep","image/webp","image/png","image/jpeg","image/avif"]},
            "outputDirectory":{"type":"string"},"targetSizeKb":{"type":"integer","minimum":0,"maximum":102400}
        }), json!(["paths"])),
        tool("piclite_inspect", "Inspect a local image's dimensions, format, size and animation status without modifying it.", json!({"path":{"type":"string"}}), json!(["path"]))
    ])
}
fn call(name: &str, args: Value) -> Result<Value, String> {
    match name {
        "piclite_inspect" => {
            let path = args["path"].as_str().ok_or("path is required")?;
            let bytes = fs::read(path).map_err(|e| e.to_string())?;
            if bytes.len() > 256 * 1024 * 1024 {
                return Err("Image exceeds 256 MB".into());
            }
            let format = image::guess_format(&bytes).map_err(|e| e.to_string())?;
            let (width, height) = image::ImageReader::new(Cursor::new(&bytes))
                .with_guessed_format()
                .map_err(|e| e.to_string())?
                .into_dimensions()
                .map_err(|e| e.to_string())?;
            let frames = if format == image::ImageFormat::Gif {
                GifDecoder::new(Cursor::new(&bytes))
                    .map_err(|e| e.to_string())?
                    .into_frames()
                    .collect_frames()
                    .map_err(|e| e.to_string())?
                    .len()
            } else if is_animated_webp(&bytes) {
                decode_webp_animation(&bytes)?.frames.len()
            } else {
                1
            };
            Ok(
                json!({"path":path,"bytes":bytes.len(),"width":width,"height":height,"format":format!("{:?}",format),"frames":frames,"animated":frames>1}),
            )
        }
        "piclite_compress" => {
            let paths: Vec<String> =
                serde_json::from_value(args["paths"].clone()).map_err(|e| e.to_string())?;
            if paths.is_empty()
                || paths.len() > 100
                || paths.iter().any(|p| !Path::new(p).is_absolute())
            {
                return Err("Provide 1–100 absolute image paths".into());
            }
            let quality = args["quality"].as_u64().unwrap_or(86);
            let scale = args["scale"].as_f64().unwrap_or(100.0);
            let format = args["format"].as_str().unwrap_or("keep");
            if !(1..=100).contains(&quality)
                || !scale.is_finite()
                || !(0.1..=100.0).contains(&scale)
                || ![
                    "keep",
                    "image/webp",
                    "image/png",
                    "image/jpeg",
                    "image/avif",
                ]
                .contains(&format)
            {
                return Err("Invalid quality, scale or format".into());
            }
            let target = args["targetSizeKb"].as_u64().unwrap_or(0);
            if target > 102400 {
                return Err("targetSizeKb exceeds 102400".into());
            }
            let settings: QuickCompressSettings = serde_json::from_value(json!({"mode":"manual","quality":quality,"scale":scale,"format":format,"stripMetadata":true,"preventLarger":true,"exportMode":if args["outputDirectory"].is_string(){"fixed-folder"}else{"same-folder"},"fixedFolder":args["outputDirectory"],"exportSuffix":"-piclite","targetSizeKb":target})).map_err(|e|e.to_string())?;
            let result = tauri::async_runtime::block_on(quick_compress_paths(paths, settings))?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        _ => Err(format!("Unknown tool: {name}")),
    }
}
fn response(request: Value, initialized: &mut bool) -> Option<Value> {
    let id = request.get("id")?.clone();
    let method = request["method"].as_str().unwrap_or("");
    let result = match method {
        "initialize" => {
            *initialized = true;
            let version = request["params"]["protocolVersion"]
                .as_str()
                .unwrap_or("2025-11-25");
            let version =
                if ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"].contains(&version) {
                    version
                } else {
                    "2025-11-25"
                };
            Ok(
                json!({"protocolVersion":version,"capabilities":{"tools":{"listChanged":false}},"serverInfo":{"name":"piclite","version":env!("CARGO_PKG_VERSION")}}),
            )
        }
        "ping" => Ok(json!({})),
        "tools/list" if *initialized => Ok(json!({"tools":tools()})),
        "tools/call" if *initialized => {
            let result = call(
                request["params"]["name"].as_str().unwrap_or(""),
                request["params"]["arguments"].clone(),
            );
            Ok(match result {
                Ok(value) => {
                    json!({"content":[{"type":"text","text":value.to_string()}],"structuredContent":{"result":value},"isError":false})
                }
                Err(error) => json!({"content":[{"type":"text","text":error}],"isError":true}),
            })
        }
        _ => Err("Unknown method or server not initialized"),
    };
    Some(match result {
        Ok(result) => json!({"jsonrpc":"2.0","id":id,"result":result}),
        Err(message) => json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":message}}),
    })
}
pub fn run() {
    let mut initialized = false;
    for line in std::io::stdin().lock().lines() {
        let response = match line {
            Ok(line) => match serde_json::from_str::<Value>(&line) {
                Ok(request) => response(request, &mut initialized),
                Err(_) => Some(
                    json!({"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"Parse error"}}),
                ),
            },
            Err(_) => break,
        };
        if let Some(response) = response {
            println!("{response}");
            let _ = std::io::stdout().flush();
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn handshake_and_tools() {
        let mut ready = false;
        assert!(response(json!({"method":"notifications/initialized"}), &mut ready).is_none());
        assert!(response(
            json!({"id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25"}}),
            &mut ready
        )
        .unwrap()["result"]["capabilities"]["tools"]
            .is_object());
        assert_eq!(
            response(json!({"id":2,"method":"tools/list"}), &mut ready).unwrap()["result"]["tools"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        assert!(call("piclite_compress", json!({"paths":["relative.png"]})).is_err());
    }
}
