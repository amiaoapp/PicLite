//! SVG stays vector unless the caller explicitly requests a bitmap format.
//! Kept outside the existing raster compression strategy.
use image::DynamicImage;
use oxvg_ast::{parse::roxmltree::{parse_with_options, ParsingOptions}, serialize::Node as _, visitor::Info};
use oxvg_optimiser::Jobs;

pub fn is_svg(data: &[u8]) -> bool {
    std::str::from_utf8(data).ok().is_some_and(|text| {
        text.trim_start_matches('\u{feff}').trim_start().starts_with('<')
            && roxmltree::Document::parse_with_options(text, roxmltree::ParsingOptions { allow_dtd: true, nodes_limit: 1_000_000, ..Default::default() }).ok().is_some_and(|doc| doc.root_element().tag_name().name() == "svg")
    })
}

fn tree(data: &[u8]) -> Result<resvg::usvg::Tree, String> {
    // No filesystem or network resource resolution. Embedded data images work.
    let mut options = resvg::usvg::Options::default();
    options.image_href_resolver.resolve_string = Box::new(|_, _| None);
    static FONTS: std::sync::OnceLock<std::sync::Arc<resvg::usvg::fontdb::Database>> = std::sync::OnceLock::new();
    options.fontdb = FONTS.get_or_init(|| {
        let mut database = resvg::usvg::fontdb::Database::new(); database.load_system_fonts();
        std::sync::Arc::new(database)
    }).clone();
    resvg::usvg::Tree::from_data(data, &options).map_err(|e| format!("SVG 无法解析：{e}"))
}

pub fn dimensions(data: &[u8]) -> Result<(u32, u32), String> {
    let tree = tree(data)?;
    let size = tree.size().to_int_size();
    Ok((size.width(), size.height()))
}

pub fn decode(data: &[u8]) -> Result<DynamicImage, String> {
    let tree = tree(data)?;
    let size = tree.size().to_int_size();
    if u64::from(size.width()) * u64::from(size.height()) > 64 * 1024 * 1024 {
        return Err("SVG 超过 6400 万像素".into());
    }
    let mut pixmap = resvg::tiny_skia::Pixmap::new(size.width(), size.height()).ok_or("无法创建 SVG 画布")?;
    resvg::render(&tree, resvg::tiny_skia::Transform::identity(), &mut pixmap.as_mut());
    // tiny-skia stores premultiplied RGBA; image encoders expect straight RGBA.
    let bytes: Vec<u8> = pixmap.pixels().iter().flat_map(|pixel| {
        let p = pixel.demultiply(); [p.red(), p.green(), p.blue(), p.alpha()]
    }).collect();
    Ok(DynamicImage::ImageRgba8(image::RgbaImage::from_raw(size.width(), size.height(), bytes).ok_or("SVG 像素无效")?))
}

fn optimizer_config(strip_metadata: bool) -> Jobs {
    // Same conservative jobs as the SVGO browser worker. Preserve paths, IDs,
    // numeric precision, CSS, gradients, masks, animation and viewBox.
    serde_json::from_value(serde_json::json!({
        "removeDoctype": true, "removeXMLProcInst": true, "removeComments": {},
        "removeMetadata": strip_metadata,
    })).expect("static SVG optimizer configuration")
}

pub fn optimize(original: Vec<u8>, settings: &super::WatcherSettings) -> Result<super::OptimizedImage, String> {
    let text = std::str::from_utf8(&original).map_err(|_| "SVG 必须使用 UTF-8 编码")?;
    let doc = roxmltree::Document::parse_with_options(text, roxmltree::ParsingOptions { allow_dtd: true, nodes_limit: 1_000_000, ..Default::default() }).map_err(|e| format!("SVG 无效：{e}"))?;
    let root = doc.root_element();
    if root.tag_name().name() != "svg" { return Err("文件不是 SVG".into()); }
    let (width, height) = dimensions(&original)?;
    let (target_width, target_height) = super::target_dimensions(width, height, settings);
    let resized = (target_width, target_height) != (width, height);
    let mut source = text.to_string();
    if resized {
        let mut replacements = Vec::new();
        let mut attrs = String::new();
        for (name, value) in [("width", target_width), ("height", target_height)] {
            if let Some(attr) = root.attributes().find(|a| a.name() == name && a.namespace().is_none()) {
                replacements.push((attr.range_value(), value.to_string()));
            } else {
                attrs.push_str(&format!(" {name}=\"{value}\""));
            }
        }
        if root.attribute("viewBox").is_none() { attrs.push_str(&format!(" viewBox=\"0 0 {width} {height}\"")); }
        let start = root.range().start;
        let insert = start + source[start..].find(|c: char| c.is_whitespace() || c == '>' || c == '/').ok_or("SVG 根元素无效")?;
        replacements.push((insert..insert, attrs));
        replacements.sort_by_key(|(range, _)| std::cmp::Reverse(range.start));
        for (range, value) in replacements { source.replace_range(range, &value); }
    }
    let jobs = optimizer_config(settings.strip_metadata);
    let optimized = parse_with_options(&source, ParsingOptions { allow_dtd: true, nodes_limit: 1_000_000, ..Default::default() }, |dom, allocator| {
        jobs.run(dom, &Info::new(allocator)).map_err(|e| e.to_string())?;
        dom.serialize().map_err(|e| e.to_string())
    }).map_err(|e| e.to_string())??;
    let bytes = optimized.into_bytes();
    Ok(super::OptimizedImage {
        bytes: if !resized && settings.prevent_larger && bytes.len() >= original.len() { original } else { bytes },
        extension: "svg".into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::GenericImageView;
    const SVG: &[u8] = include_bytes!("../../tests/fixtures/vector-features.svg");
    fn settings() -> crate::WatcherSettings {
        serde_json::from_value(serde_json::json!({
            "inputFolder":"", "outputFolder":"", "mode":"auto", "quality":82,
            "scale":100, "format":"keep", "resize":false, "maxWidth":1920,
            "maxHeight":1080, "stripMetadata":true, "preventLarger":true
        })).unwrap()
    }

    #[test]
    fn svg_optimizer_preserves_exact_rendered_pixels_and_references() {
        let output = crate::optimize_image_data(SVG.to_vec(), "svg".into(), &settings()).unwrap();
        assert_eq!(output.extension, "svg");
        assert!(output.bytes.len() < SVG.len());
        assert_eq!(decode(SVG).unwrap().to_rgba8(), decode(&output.bytes).unwrap().to_rgba8());
        let xml = String::from_utf8(output.bytes).unwrap();
        for text in ["viewBox=", "id=\"paint\"", "id=\"mask\"", "id=\"edge\"", "Original artwork attribution"] {
            assert!(xml.contains(text), "missing {text}");
        }
        assert!(!xml.contains("editor notes"));
        assert!(!xml.contains("PicLite vector regression fixture"));
    }

    #[test]
    fn svg_resize_stays_vector_and_keeps_metadata_when_requested() {
        let mut settings = settings(); settings.scale = 50.0; settings.strip_metadata = false;
        let output = crate::optimize_image_data(SVG.to_vec(), "svg".into(), &settings).unwrap();
        assert_eq!(dimensions(&output.bytes).unwrap(), (48, 32));
        assert!(String::from_utf8_lossy(&output.bytes).contains("PicLite vector regression fixture"));
        assert!(String::from_utf8_lossy(&output.bytes).contains("0 0 96 64"));
    }

    #[test]
    fn svg_convert_uses_explicit_formats_and_preserves_transparency() {
        for (mime, ext) in [("image/png", "png"), ("image/webp", "webp"), ("image/jpeg", "jpg"), ("image/bmp", "bmp"), ("image/tiff", "tiff"), ("image/x-icon", "ico"), ("image/qoi", "qoi"), ("image/x-tga", "tga"), ("image/x-portable-pixmap", "ppm"), ("image/x-portable-arbitrarymap", "pam")] {
            let mut settings = settings(); settings.format = mime.into(); settings.prevent_larger = false; settings.mode = "manual".into(); settings.quality = 100;
            let output = crate::optimize_image_data(SVG.to_vec(), "svg".into(), &settings).unwrap();
            assert_eq!(output.extension, ext);
            let decoded = image::load_from_memory_with_format(&output.bytes, image::ImageFormat::from_extension(ext).unwrap()).unwrap();
            assert_eq!(decoded.dimensions(), (96, 64));
            if ["png", "webp", "tiff", "ico", "qoi", "tga", "pam"].contains(&ext) {
                assert_eq!(decoded.to_rgba8().get_pixel(0, 0).0[3], 0, "lost transparency in {ext}");
            }
        }
    }

    #[test]
    fn svg_does_not_read_external_images_and_rejects_malformed_xml() {
        let svg = br#"<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><image href="file:///etc/passwd" width="8" height="8"/></svg>"#;
        assert!(decode(svg).unwrap().to_rgba8().pixels().all(|p| p.0[3] == 0));
        assert!(optimize(b"<svg><broken>".to_vec(), &settings()).is_err());
        let mut settings = settings(); settings.format = "image/svg+xml".into();
        let png = crate::encode_static(image::DynamicImage::new_rgb8(2, 2), "png", 100).unwrap();
        assert!(crate::optimize_image_data(png, "png".into(), &settings).is_err());
    }
}
