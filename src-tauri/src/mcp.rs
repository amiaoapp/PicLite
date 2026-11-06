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
        tool("piclite_create_cover", "Build a transparent 3:2 PNG cover by centering and cropping a supplied local image, with optional rounded corners, border, and shadow. Reuses the supplied configuration values; no UI or network is needed.", json!({
            "imagePath":{"type":"string","description":"Absolute path to the source image"},
            "presetPath":{"type":"string","description":"Optional img2banner exported project JSON; its ui settings are applied, with config overrides taking priority"},
            "config":{"type":"object","description":"Optional img2banner-compatible config overrides: canvasW/canvasH, innerSize, zoom, transparent, bgColor, bgPadding, borderType/borderWidth/borderColor/borderRadius, enableShadow/shadowColor/shadowBlur. Default 1200x800 transparent, centered image."},
            "outputPath":{"type":"string","description":"Optional absolute destination path for PNG output"}
        }), json!(["imagePath"])),
        tool("piclite_inspect", "Inspect a local image's dimensions, format, size and animation status without modifying it.", json!({"path":{"type":"string"}}), json!(["path"]))
    ])
}
// Integrate boundary pixels on an 8x8 grid; skip sampling for pixels entirely
// inside/outside the rounded rectangle. This changes alpha, not image sharpness.
fn rounded_cover_coverage(x: u32, y: u32, size: u32, radius: f64, inset: f64) -> f64 {
    let half = size as f64 / 2.0 - inset;
    if half <= 0.0 { return 0.0; }
    let r = (radius - inset).clamp(0.0, half);
    let distance = |px: f64, py: f64| {
        let qx = (px - size as f64 / 2.0).abs() - (half - r);
        let qy = (py - size as f64 / 2.0).abs() - (half - r);
        qx.max(0.0).hypot(qy.max(0.0)) + qx.max(qy).min(0.0) - r
    };
    let d = distance(x as f64 + 0.5, y as f64 + 0.5);
    if d < -std::f64::consts::FRAC_1_SQRT_2 { return 1.0; }
    if d > std::f64::consts::FRAC_1_SQRT_2 { return 0.0; }
    let mut covered = 0;
    for sy in 0..8 { for sx in 0..8 {
        if distance(x as f64 + (sx as f64 + 0.5) / 8.0, y as f64 + (sy as f64 + 0.5) / 8.0) <= 0.0 { covered += 1; }
    }}
    covered as f64 / 64.0
}

fn resample_cover_source(source: &image::RgbaImage, size: u32, x: f64, y: f64, side: f64) -> image::RgbaImage {
    // Filter premultiplied color so invisible RGB cannot bleed into the edge.
    // A padded square also preserves transparent space when zooming out.
    let side_pixels = side.ceil().clamp(1.0, 4096.0) as u32;
    let mut crop = image::Rgba32FImage::new(side_pixels, side_pixels);
    for (cx, cy, pixel) in crop.enumerate_pixels_mut() {
        let sx = x + (cx as f64 + 0.5) * side / side_pixels as f64 - 0.5;
        let sy = y + (cy as f64 + 0.5) * side / side_pixels as f64 - 0.5;
        let ix = sx.floor() as i64; let iy = sy.floor() as i64;
        let fx = (sx - ix as f64) as f32; let fy = (sy - iy as f64) as f32;
        let mut values = [0.0; 4];
        for (dx, dy, weight) in [(0,0,(1.0-fx)*(1.0-fy)),(1,0,fx*(1.0-fy)),(0,1,(1.0-fx)*fy),(1,1,fx*fy)] {
            let px = ix + dx; let py = iy + dy;
            if px < 0 || py < 0 || px >= source.width() as i64 || py >= source.height() as i64 { continue; }
            let p = source.get_pixel(px as u32, py as u32).0;
            let alpha = p[3] as f32 / 255.0;
            for c in 0..3 { values[c] += p[c] as f32 / 255.0 * alpha * weight; }
            values[3] += alpha * weight;
        }
        *pixel = image::Rgba(values);
    }
    let filtered = image::imageops::resize(&crop, size, size, image::imageops::FilterType::Lanczos3);
    image::RgbaImage::from_fn(size, size, |x, y| {
        let p = filtered.get_pixel(x, y).0;
        let alpha = p[3].clamp(0.0, 1.0);
        if alpha <= 0.0 { return image::Rgba([0;4]); }
        image::Rgba([(p[0] / alpha).clamp(0.0,1.0).mul_add(255.0,0.5) as u8, (p[1] / alpha).clamp(0.0,1.0).mul_add(255.0,0.5) as u8, (p[2] / alpha).clamp(0.0,1.0).mul_add(255.0,0.5) as u8, (alpha*255.0).round() as u8])
    })
}

fn create_cover(args: &Value) -> Result<Value, String> {
    let input = args["imagePath"].as_str().ok_or("imagePath is required")?;
    let input_path = Path::new(input);
    if !input_path.is_absolute() {
        return Err("imagePath must be absolute".into());
    }
    let bytes = fs::read(input_path).map_err(|e| format!("read source image: {e}"))?;
    if bytes.len() > 256 * 1024 * 1024 {
        return Err("source image exceeds 256 MB".into());
    }
    let source = image::load_from_memory(&bytes)
        .map_err(|e| format!("decode source image: {e}"))?
        .to_rgba8();
    let mut config = serde_json::Map::new();
    if let Some(preset) = args["presetPath"].as_str() {
        let path = Path::new(preset);
        if !path.is_absolute() {
            return Err("presetPath must be absolute".into());
        }
        let raw = fs::read(path).map_err(|e| format!("read preset: {e}"))?;
        if raw.len() > 16 * 1024 * 1024 {
            return Err("preset JSON exceeds 16 MB".into());
        }
        let preset: Value =
            serde_json::from_slice(&raw).map_err(|e| format!("invalid preset JSON: {e}"))?;
        if let Some(ui) = preset.get("ui").and_then(Value::as_object) {
            config.extend(ui.clone());
            if let Some(crop) = preset.get("crop") {
                config.insert("crop".into(), crop.clone());
            }
        }
    }
    if let Some(overrides) = args["config"].as_object() {
        config.extend(overrides.clone());
    }
    let config = Value::Object(config);
    let number = |key: &str, default: f64| {
        config[key]
            .as_f64()
            .or_else(|| config[key].as_str().and_then(|s| s.parse().ok()))
            .unwrap_or(default)
    };
    let u32v = |key: &str, default: u32| {
        config[key]
            .as_u64()
            .and_then(|n| u32::try_from(n).ok())
            .or_else(|| config[key].as_str().and_then(|s| s.parse().ok()))
            .unwrap_or(default)
    };
    let boolv = |key: &str, default: bool| {
        config[key]
            .as_bool()
            .or_else(|| config[key].as_str().and_then(|s| s.parse().ok()))
            .unwrap_or(default)
    };
    let width = u32v("canvasW", 1200);
    let height = u32v("canvasH", 800);
    if !(1..=4096).contains(&width)
        || !(1..=4096).contains(&height)
        || (width as u64) * (height as u64) > 16_777_216
    {
        return Err("canvas dimensions exceed 4096 per edge or 16 megapixels".into());
    }
    let mut canvas = image::RgbaImage::new(width, height);
    let transparent = boolv("transparent", true);
    if !transparent {
        let color = parse_cover_color(config["bgColor"].as_str().unwrap_or("#f6f8fb"))?;
        for p in canvas.pixels_mut() {
            *p = color;
        }
    }
    let padding = number("bgPadding", 0.0).clamp(0.0, 100.0) as f32;
    let plate_w = (width as f32 * (1.0 - padding / 200.0)).round().max(1.0) as u32;
    let plate_h = (height as f32 * (1.0 - padding / 200.0)).round().max(1.0) as u32;
    let px = (width - plate_w) / 2;
    let py = (height - plate_h) / 2;
    if let Some(path) = config["backgroundImagePath"].as_str() {
        let bgbytes = fs::read(path).map_err(|e| format!("read background image: {e}"))?;
        let bg = image::load_from_memory(&bgbytes)
            .map_err(|e| format!("decode background image: {e}"))?
            .to_rgba8();
        let scale = (plate_w as f32 / bg.width() as f32).max(plate_h as f32 / bg.height() as f32);
        let rw = (bg.width() as f32 * scale).ceil() as u32;
        let rh = (bg.height() as f32 * scale).ceil() as u32;
        let resized = image::imageops::resize(&bg, rw, rh, image::imageops::FilterType::Lanczos3);
        let ox = px as i64 - ((rw - plate_w) / 2) as i64;
        let oy = py as i64 - ((rh - plate_h) / 2) as i64;
        image::imageops::overlay(&mut canvas, &resized, ox, oy);
    } else if !transparent {
        let c = parse_cover_color(config["bgColor"].as_str().unwrap_or("#f6f8fb"))?;
        for y in py..py + plate_h {
            for x in px..px + plate_w {
                canvas.put_pixel(x, y, c)
            }
        }
    }
    let size =
        number("innerSize", height as f64 * 0.52).clamp(1.0, width.max(height) as f64) as u32;
    let zoom = number("zoom", 100.0).clamp(10.0, 500.0) / 100.0;
    // Use the original img2banner square viewport and crop coordinates.
    let source_side = source.width().min(source.height()) as f64 / zoom;
    let crop_number = |key: &str, default: f64| config["crop"][key].as_f64().unwrap_or(default);
    let center_x = crop_number("centerX", source.width() as f64 / 2.0);
    let center_y = crop_number("centerY", source.height() as f64 / 2.0);
    let crop_origin = |center: f64, dimension: u32| {
        if source_side <= dimension as f64 { (center - source_side / 2.0).clamp(0.0, dimension as f64 - source_side) }
        else { center - source_side / 2.0 }
    };
    let source_x = crop_origin(center_x, source.width());
    let source_y = crop_origin(center_y, source.height());
    let mut scaled = resample_cover_source(&source, size, source_x, source_y, source_side);
    let radius = number("borderRadius", 24.0).clamp(0.0, size as f64 / 2.0);
    let border_type = config["borderType"].as_str().unwrap_or("none");
    let bw = number("borderWidth", 4.0).clamp(0.0, 40.0) as u32;
    let border = parse_cover_color(config["borderColor"].as_str().unwrap_or("#ffffff"))?;
    let shadow = boolv("enableShadow", true);
    let blur = number("shadowBlur", 20.0).clamp(0.0, 150.0) as u32;
    let shadow_color = parse_cover_color(config["shadowColor"].as_str().unwrap_or("#5b21b6"))?;
    // One coverage mask is shared by the image, rounded border and shadow.
    // Fractional alpha is essential: deleting whole pixels produces stair steps.
    for (x, y, pixel) in scaled.enumerate_pixels_mut() {
        let coverage = rounded_cover_coverage(x, y, size, radius, 0.0);
        if coverage == 0.0 { *pixel = image::Rgba([0; 4]); continue; }
        let dashed_gap = border_type == "dashed" && ((x + y) / (bw.max(1) * 3)) % 2 == 1;
        if border_type != "none" && bw > 0 && !dashed_gap {
            let inner = rounded_cover_coverage(x, y, size, radius, bw as f64);
            let mut stroke = border;
            stroke.0[3] = (border.0[3] as f64 * (coverage - inner).max(0.0) / coverage).round() as u8;
            use image::Pixel;
            pixel.blend(&stroke);
        }
        pixel.0[3] = (pixel.0[3] as f64 * coverage).round() as u8;
    }
    let dst_x = (width as i64 - size as i64) / 2;
    let dst_y = (height as i64 - size as i64) / 2;
    if shadow && blur > 0 {
        let mut mask = image::GrayImage::new(width, height);
        for sy in 0..size {
            for sx in 0..size {
                let x = dst_x + sx as i64;
                let y = dst_y + sy as i64 + blur as i64 / 3;
                if x >= 0 && y >= 0 && x < width as i64 && y < height as i64 {
                    mask.put_pixel(
                        x as u32,
                        y as u32,
                        image::Luma([scaled.get_pixel(sx, sy).0[3]]),
                    );
                }
            }
        }
        let mask = image::imageops::blur(&mask, blur as f32 / 2.0);
        let mut layer = image::RgbaImage::new(width, height);
        for (x, y, p) in layer.enumerate_pixels_mut() {
            *p = image::Rgba([
                shadow_color.0[0],
                shadow_color.0[1],
                shadow_color.0[2],
                (mask.get_pixel(x, y).0[0] as u16 * shadow_color.0[3] as u16 / 510) as u8,
            ]);
        }
        image::imageops::overlay(&mut canvas, &layer, 0, 0);
    }
    image::imageops::overlay(&mut canvas, &scaled, dst_x, dst_y);
    let output = args["outputPath"]
        .as_str()
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            let mut p = input_path.to_path_buf();
            p.set_file_name(format!(
                "{}-cover.png",
                input_path.file_stem().unwrap_or_default().to_string_lossy()
            ));
            p
        });
    if !output.is_absolute() {
        return Err("outputPath must be absolute".into());
    }
    if output == input_path {
        return Err("outputPath must not overwrite source image".into());
    }
    let parent = output
        .parent()
        .ok_or("outputPath must include a directory")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut encoded = Vec::new();
    image::DynamicImage::ImageRgba8(canvas)
        .write_to(&mut Cursor::new(&mut encoded), image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    let actual = if output.exists() {
        let stem = output.file_stem().unwrap_or_default().to_string_lossy();
        let ext = output.extension().unwrap_or_default().to_string_lossy();
        let mut i = 1;
        loop {
            let p = parent.join(format!("{stem}-{i}.{ext}"));
            if !p.exists() {
                break p;
            }
            i += 1
        }
    } else {
        output
    };
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&actual)
        .and_then(|mut f| f.write_all(&encoded))
        .map_err(|e| e.to_string())?;
    Ok(
        json!({"path":actual,"width":width,"height":height,"format":"png","bytes":encoded.len(),"transparentBackground":transparent}),
    )
}

fn parse_cover_color(s: &str) -> Result<image::Rgba<u8>, String> {
    let value = s
        .strip_prefix('#')
        .ok_or("color must be #RRGGBB or #RRGGBBAA")?;
    if !value.is_ascii() || (value.len() != 6 && value.len() != 8) {
        return Err("color must be #RRGGBB or #RRGGBBAA".into());
    }
    let bytes = (0..value.len())
        .step_by(2)
        .map(|i| {
            u8::from_str_radix(&value[i..i + 2], 16).map_err(|_| "invalid hex color".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(image::Rgba([
        bytes[0],
        bytes[1],
        bytes[2],
        *bytes.get(3).unwrap_or(&255),
    ]))
}

fn validate_compression_arguments(args: &Value) -> Result<(), String> {
    if !args.is_object() {
        return Err("arguments must be an object".into());
    }
    for key in ["quality", "targetSizeKb"] {
        if args.get(key).is_some_and(|value| value.as_u64().is_none()) {
            return Err(format!("{key} must be a non-negative integer"));
        }
    }
    if args
        .get("scale")
        .is_some_and(|value| value.as_f64().is_none())
    {
        return Err("scale must be a number".into());
    }
    for key in ["format", "outputDirectory"] {
        if args.get(key).is_some_and(|value| !value.is_string()) {
            return Err(format!("{key} must be a string"));
        }
    }
    Ok(())
}
fn call(name: &str, args: Value) -> Result<Value, String> {
    match name {
        "piclite_create_cover" => create_cover(&args),
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
            validate_compression_arguments(&args)?;
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
    if !request.is_object()
        || request["jsonrpc"] != "2.0"
        || !request["method"].is_string()
        || request
            .get("id")
            .is_some_and(|id| !id.is_null() && !id.is_string() && !id.is_number())
    {
        return Some(
            json!({"jsonrpc":"2.0","id":null,"error":{"code":-32600,"message":"Invalid Request"}}),
        );
    }
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
    fn cover_composites_source_on_transparent_three_by_two_canvas() {
        let dir = std::env::temp_dir().join(format!("piclite-cover-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let source = dir.join("source.png");
        let mut image = image::RgbaImage::new(80, 40);
        for p in image.pixels_mut() {
            *p = image::Rgba([230, 30, 20, 255]);
        }
        image.save(&source).unwrap();
        let output = dir.join("result.png");
        let args = json!({"imagePath":source,"outputPath":output,"config":{"canvasW":300,"canvasH":200,"innerSize":100,"transparent":true,"enableShadow":false,"borderType":"none","borderRadius":0}});
        let result = call("piclite_create_cover", args).unwrap();
        assert_eq!(
            (
                result["width"].as_u64().unwrap(),
                result["height"].as_u64().unwrap()
            ),
            (300, 200)
        );
        let rendered = image::open(&output).unwrap().to_rgba8();
        assert_eq!(rendered.dimensions(), (300, 200));
        assert_eq!(
            rendered.get_pixel(5, 5).0[3],
            0,
            "canvas corners stay transparent"
        );
        assert!(
            rendered.get_pixel(150, 100).0[3] > 0,
            "source image is centered and rendered"
        );
        assert_eq!(rendered.get_pixel(150, 100).0[0], 230);
        assert_eq!(result["format"], "png");
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn mcp_cover_has_smooth_symmetric_corners_and_a_rounded_border() {
        let dir = std::env::temp_dir().join(format!("piclite-aa-cover-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let source = dir.join("source.png");
        image::RgbaImage::from_pixel(400,400,image::Rgba([230,30,20,255])).save(&source).unwrap();
        for (index,border) in ["none","solid","dashed"].iter().enumerate() {
            let output = dir.join(format!("cover-{index}.png"));
            call("piclite_create_cover", json!({"imagePath":source,"outputPath":output,"config":{"canvasW":200,"canvasH":200,"innerSize":158,"borderRadius":37.5,"borderType":border,"borderWidth":4,"borderColor":"#ffffff","enableShadow":false,"transparent":true}})).unwrap();
            let rendered=image::open(output).unwrap().to_rgba8();
            let mut partial=0; let mut max_error=0.0_f64;
            for y in 0..40 { for x in 0..40 {
                let mut expected=0;
                for sy in 0..32 { for sx in 0..32 {
                    let px=x as f64+(sx as f64+0.5)/32.0;
                    let py=y as f64+(sy as f64+0.5)/32.0;
                    let dx=(37.5-px).max(0.0); let dy=(37.5-py).max(0.0);
                    if dx*dx+dy*dy<=37.5*37.5 {expected+=1;}
                }}
                let alpha=rendered.get_pixel(x+21,y+21).0[3];
                if alpha>0&&alpha<255 { partial+=1; }
                max_error=max_error.max((alpha as f64/255.0-expected as f64/1024.0).abs());
                assert_eq!(alpha,rendered.get_pixel(178-x,y+21).0[3]);
            }}
            assert!(partial>40,"rounded boundary must contain fractional alpha");
            assert!(max_error<0.03,"coverage error {max_error}");
            if *border=="solid" { assert_eq!(rendered.get_pixel(22,100).0,[255,255,255,255]); assert!(rendered.get_pixel(25,25).0[3]==0); }
        }
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn cover_resampling_does_not_bleed_invisible_rgb_or_alias_fine_detail() {
        let source=image::RgbaImage::from_fn(256,256,|x,_| if x%2==0 {image::Rgba([255,0,0,255])}else{image::Rgba([0,255,0,0])});
        let scaled=resample_cover_source(&source,32,0.0,0.0,256.0);
        for p in scaled.pixels() { assert!(p.0[0]>250); assert!(p.0[1]<2); assert!((120..=136).contains(&p.0[3])); }
    }
    #[test]
    fn malformed_rpc_envelope_is_rejected() {
        let mut ready = false;
        let result = response(
            json!({"jsonrpc":"1.0","id":7,"method":"initialize"}),
            &mut ready,
        )
        .unwrap();
        assert_eq!(result["error"]["code"], -32600);
        assert!(!ready);
        for request in [
            json!([]),
            json!(null),
            json!({"jsonrpc":"2.0","id":{},"method":"ping"}),
            json!({"jsonrpc":"2.0","id":1,"method":false}),
        ] {
            assert_eq!(
                response(request, &mut ready).unwrap()["error"]["code"],
                -32600
            );
        }
        assert!(response(
            json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
            &mut ready
        )
        .is_none());
    }
    #[test]
    fn non_ascii_hex_color_returns_error_without_panicking() {
        assert!(parse_cover_color("#aé000").is_err());
        assert_eq!(parse_cover_color("#12345678").unwrap().0, [18, 52, 86, 120]);
    }
    #[test]
    fn compression_rejects_mistyped_options_instead_of_using_defaults() {
        for args in [
            json!({"quality":-1}),
            json!({"quality":"50"}),
            json!({"scale":"50"}),
            json!({"format":false}),
            json!({"targetSizeKb":-1}),
            json!({"outputDirectory":42}),
        ] {
            assert!(validate_compression_arguments(&args).is_err(), "{args}");
        }
        assert!(validate_compression_arguments(&json!({})).is_ok());
        assert!(validate_compression_arguments(&json!({"quality":86,"scale":50.0,"format":"keep","targetSizeKb":0,"outputDirectory":"/images"})).is_ok());
    }
    #[test]
    fn handshake_and_tools() {
        let mut ready = false;
        assert!(response(
            json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
            &mut ready
        )
        .is_none());
        assert!(response(
            json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25"}}),
            &mut ready
        )
        .unwrap()["result"]["capabilities"]["tools"]
            .is_object());
        assert_eq!(
            response(
                json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}),
                &mut ready
            )
            .unwrap()["result"]["tools"]
                .as_array()
                .unwrap()
                .len(),
            3
        );
        assert!(call("piclite_compress", json!({"paths":["relative.png"]})).is_err());
    }
}
