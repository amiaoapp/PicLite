#!/usr/bin/env python3
"""Run the production AppKit helpers in a disposable native window (no package build).
Requires macOS, an interactive desktop, and compiled debug Rust dependencies.
"""
from pathlib import Path
import subprocess

repo = Path(__file__).resolve().parents[1]
source = (repo / "src-tauri/src/native_material.rs").read_text()
# Compile the actual helpers, so this test cannot silently drift to a Swift reimplementation.
helpers = source.split('    const IDENTIFIER:', 1)[1].split('    pub(super) fn apply(', 1)[0]
helpers = 'const IDENTIFIER:' + helpers
scratch = Path.home() / ".hermes/cache/scratch/piclite-appkit-test"
scratch.mkdir(parents=True, exist_ok=True)
rust = r'''
use objc2::{msg_send, rc::Retained, runtime::{AnyClass, AnyObject}, MainThreadMarker};
use objc2_app_kit::{NSColor, NSUserInterfaceItemIdentification, NSView, NSWindow};
use objc2_foundation::{NSString, NSRect, NSPoint, NSSize};
use std::ffi::CStr;
'''+helpers+r'''
fn main() { unsafe {
    let mtm = MainThreadMarker::new().unwrap();
    let app_class = AnyClass::get(CStr::from_bytes_with_nul(b"NSApplication\0").unwrap()).unwrap();
    let app: Retained<AnyObject> = msg_send![app_class, sharedApplication];
    let _: () = msg_send![&app, setActivationPolicy: 2isize];
    let rect = NSRect::new(NSPoint::new(0., 0.), NSSize::new(640., 420.));
    struct EmptyAssets;
    impl tauri::Assets<tauri::Wry> for EmptyAssets {
        fn get(&self, _: &tauri::utils::assets::AssetKey) -> Option<std::borrow::Cow<'_, [u8]>> { None }
        fn iter(&self) -> Box<tauri::utils::assets::AssetsIter<'_>> { Box::new(std::iter::empty()) }
        fn csp_hashes(&self, _: &tauri::utils::assets::AssetKey) -> Box<dyn Iterator<Item=tauri::utils::assets::CspHash<'_>> + '_> { Box::new(std::iter::empty()) }
    }
    let mut config = tauri::utils::config::Config::default();
    config.identifier = "com.piclite.native-titlebar-test".into();
    config.app.windows.clear();
    config.app.macos_private_api = true;
    let context = tauri::Context::new(config, Box::new(EmptyAssets), None, None,
        tauri::PackageInfo { name: "PicLite probe".into(), version: "0.1.0".parse().unwrap(), authors: "", description: "", crate_name: "probe" },
        tauri::Pattern::Brownfield,
        tauri::runtime_authority!(Default::default(), Default::default()), None);
    let tauri_app = tauri::Builder::default().build(context).unwrap();
    let tauri_window = tauri::WebviewWindowBuilder::new(&tauri_app, "main", tauri::WebviewUrl::External("http://127.0.0.1:1433".parse().unwrap()))
        .title("PicLite titlebar probe").inner_size(640., 420.).transparent(true).build().unwrap();
    let window = Retained::retain(tauri_window.ns_window().unwrap() as *mut NSWindow).unwrap();
    let content = window.contentView().unwrap();
    let wk = AnyClass::get(CStr::from_bytes_with_nul(b"WKWebView\0").unwrap()).unwrap();
    fn find_web(view: &NSView) -> Option<Retained<NSView>> {
        let wk = AnyClass::get(CStr::from_bytes_with_nul(b"WKWebView\0").unwrap()).unwrap();
        if unsafe { msg_send![view, isKindOfClass: wk] } { return Some(unsafe { Retained::retain(view as *const NSView as *mut NSView).unwrap() }); }
        view.subviews().iter().find_map(|v| find_web(&v))
    }
    let web = find_web(&content).expect("actual Tauri WKWebView");
    println!("TAURI content={:?} web={:?}", content.frame(), web.frame());
    let mut ancestor = Some(content.clone());
    while let Some(v) = ancestor { println!("ANCESTOR {} frame={:?} bounds={:?}", v.class().name().to_string_lossy(), v.frame(), v.bounds()); ancestor=v.superview(); }
    window.center();
    window.orderFrontRegardless();
    window.setFrame_display(window.frame(), true);
    window.displayIfNeeded();
    // Settle AppKit's lazy titlebar geometry before taking the baseline.
    window.setTitlebarAppearsTransparent(true);
    window.setTitlebarAppearsTransparent(false);
    window.contentView().unwrap().superview().unwrap().layoutSubtreeIfNeeded();
    let layout = window.contentLayoutRect();
    let style = window.styleMask();
    let button: Retained<NSView> = msg_send![&window, standardWindowButton: 0usize];
    let button_frame = button.frame();
    let host = button.superview().unwrap();
    println!("TITLEBAR {} frame={:?} bounds={:?} layout={:?} style={:?} web={:?} content={:?}", host.class().name().to_string_lossy(), host.frame(), host.bounds(), layout, style, web.frame(), content.frame());
    // Transparent Tauri/Wry windows implicitly enable FullSizeContentView.
    // A native titlebar must never obscure the first 32 points of the DOM.
    standard_backing(&window, false, 18.).unwrap();
    assert!(window.isOpaque());
    assert_eq!(window.backgroundColor().alphaComponent(), 1.);
    assert_eq!(window.styleMask().0 & 32768, 0, "Tauri full-size content overlaps native titlebar");
    assert_eq!(content.frame().size.height, window.contentLayoutRect().size.height);
    assert_eq!(web.frame().size.height, content.bounds().size.height);
    assert_eq!(content.bounds().size, rect.size, "initial Tauri viewport must be preserved");
    for appearance in ["NSAppearanceNameAqua", "NSAppearanceNameDarkAqua"] {
        let cls = AnyClass::get(CStr::from_bytes_with_nul(b"NSAppearance\0").unwrap()).unwrap();
        let appearance: Retained<AnyObject> = msg_send![cls, appearanceNamed: &*NSString::from_str(appearance)];
        let _: () = msg_send![&window, setAppearance: &*appearance];
        for repeat in 0..4 {
            for (width, height) in [(820.,540.), (1120.,700.)] {
                window.setContentSize(NSSize::new(width,height));
                standard_backing(&window, false, 18.).unwrap();
                assert!(window.isOpaque());
                assert_eq!(window.backgroundColor().alphaComponent(), 1.);
                window.contentView().unwrap().superview().unwrap().layoutSubtreeIfNeeded();
                assert_eq!(window.styleMask().0 & 32768, 0);
                assert!(!window.titlebarAppearsTransparent());
                assert_eq!(content.frame().size, NSSize::new(width,height));
                assert_eq!(web.frame().size, content.bounds().size);
                assert_eq!(window.contentLayoutRect().size, content.bounds().size);
                let web_rect: NSRect = msg_send![&web, convertRect: web.bounds(), toView: std::ptr::null::<NSView>()];
                let title_rect: NSRect = msg_send![&host, convertRect: host.bounds(), toView: std::ptr::null::<NSView>()];
                assert!(web_rect.origin.y + web_rect.size.height <= title_rect.origin.y + 0.01, "native titlebar must not intersect WKWebView");
                println!("BOUNDARY repeat={repeat} web={web_rect:?} titlebar={title_rect:?} style={:?}", window.styleMask());
                assert!(!host.subviews().iter().any(|v| v.identifier().is_some_and(|id| id.to_string().starts_with(TITLEBAR_IDENTIFIER))));
            }
        }
    }
    assert_eq!(button.frame().size, button_frame.size);
    assert!(!content.subviews().iter().any(|v| v.identifier().is_some_and(|id| id.to_string() == IDENTIFIER)));
    assert_eq!(web.superview().unwrap(), content);
    for radius in [10., 0., 24., 0.] {
        clip_floating_tree(&content, radius);
        for view in [&*content, &*web] {
            let layer: Retained<AnyObject> = msg_send![view, layer];
            let actual: f64 = msg_send![&layer, cornerRadius];
            let masks: bool = msg_send![&layer, masksToBounds];
            assert_eq!(actual, radius);
            assert_eq!(masks, radius > 0.);
        }
    }
    // Standard backing still updates the root and actual WebView clip.
    for radius in [24., 0.] {
        clip_floating_tree(&content, radius);
        for view in [&*content, &*web] {
            let layer: Retained<AnyObject> = msg_send![view, layer];
            let actual: f64 = msg_send![&layer, cornerRadius];
            assert_eq!(actual, radius);
        }
    }
    window.orderOut(None);
    let floating: Retained<NSWindow> = msg_send![mtm.alloc::<NSWindow>(), initWithContentRect: rect, styleMask: 0usize, backing: 2usize, defer: false];
    floating.setOpaque(false);
    floating.setBackgroundColor(Some(&objc2_app_kit::NSColor::clearColor()));
    let floating_root = floating.contentView().unwrap();
    let allocated: objc2::rc::Allocated<NSView> = msg_send![wk, alloc];
    let floating_web: Retained<NSView> = msg_send![allocated, initWithFrame: floating_root.bounds()];
    floating_root.addSubview(&floating_web);
    for radius in [10., 0.] {
        standard_backing(&floating, true, radius).unwrap();
        let frame = floating_root.superview().unwrap();
        clip_view(&frame, radius);
        floating.invalidateShadow();
        for view in [&*floating_root, &*floating_web, &*frame] {
            let layer: Retained<AnyObject> = msg_send![view, layer];
            let actual: f64 = msg_send![&layer, cornerRadius];
            let masks: bool = msg_send![&layer, masksToBounds];
            assert_eq!(actual, radius);
            assert_eq!(masks, radius > 0.);
        }
        assert!(!floating.isOpaque());
        assert_eq!(floating.backgroundColor().alphaComponent(), 0.);
    }
    assert!(!floating.isOpaque());
    let floating_style = floating.styleMask();
    let floating_bounds = floating_root.bounds();
    titlebar_material(&floating);
    assert_eq!(floating.styleMask(), floating_style);
    assert_eq!(floating_root.bounds(), floating_bounds);
    println!("PASS real Tauri/Wry: opaque backing, no titlebar/WKWebView intersection, preserved 820x540/1120x700 viewports, Aqua/Dark Aqua, repeated standard application; transparent floating backing and native radius10/0/24/0");
}}
'''
path = scratch / "probe.rs"
path.write_text(rust)
deps = repo / "src-tauri/target/debug/deps"
command = ["rustc", "--edition=2021", str(path), "-o", str(scratch / "probe"), "-L", f"dependency={deps}", "-l", "framework=WebKit"]
for name in ["objc2", "objc2_app_kit", "objc2_foundation", "tauri"]:
    library = max(deps.glob(f"lib{name}-*.rlib"), key=lambda p: p.stat().st_mtime)
    command += ["--extern", f"{name}={library}"]
subprocess.run(command, check=True)
subprocess.run([str(scratch / "probe")], check=True, timeout=30)
