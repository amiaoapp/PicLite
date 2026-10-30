#!/usr/bin/env python3
"""Run the production AppKit helpers in a disposable native window (no package build).
Requires macOS 26+, an interactive desktop, and compiled debug Rust dependencies.
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
use objc2_app_kit::{NSAutoresizingMaskOptions, NSGlassEffectView, NSGlassEffectViewStyle,
    NSUserInterfaceItemIdentification, NSView, NSVisualEffectBlendingMode, NSVisualEffectMaterial,
    NSVisualEffectState, NSVisualEffectView, NSWindow, NSWindowOrderingMode};
use objc2_foundation::{NSString, NSRect, NSPoint, NSSize};
use std::ffi::CStr;
'''+helpers+r'''
fn main() { unsafe {
    let mtm = MainThreadMarker::new().unwrap();
    let app_class = AnyClass::get(CStr::from_bytes_with_nul(b"NSApplication\0").unwrap()).unwrap();
    let app: Retained<AnyObject> = msg_send![app_class, sharedApplication];
    let _: () = msg_send![&app, setActivationPolicy: 2isize];
    let rect = NSRect::new(NSPoint::new(0., 0.), NSSize::new(640., 420.));
    let window: Retained<NSWindow> = msg_send![mtm.alloc::<NSWindow>(), initWithContentRect: rect, styleMask: 15usize, backing: 2usize, defer: false];
    let content = window.contentView().unwrap();
    // Use an actual WKWebView, with a Wry-like full-size parent.
    let wk = AnyClass::get(CStr::from_bytes_with_nul(b"WKWebView\0").unwrap()).unwrap();
    let allocated: objc2::rc::Allocated<NSView> = msg_send![wk, alloc];
    let web: Retained<NSView> = msg_send![allocated, initWithFrame: content.bounds()];
    content.addSubview(&web);
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
    for initial in [false, true] {
        window.setTitlebarAppearsTransparent(initial);
        titlebar_material(&window, mtm, true);
        titlebar_material(&window, mtm, true);
        assert!(window.titlebarAppearsTransparent());
        assert_eq!(window.styleMask(), style);
        assert_eq!(window.contentLayoutRect(), layout);
        assert_eq!(button.frame(), button_frame);
        let effects: Vec<_> = host.subviews().iter().filter(|v| v.identifier().is_some_and(|id| id.to_string().starts_with(TITLEBAR_IDENTIFIER))).map(|v| v.clone()).collect();
        assert_eq!(effects.len(), 1);
        let effect = effects[0].downcast_ref::<NSVisualEffectView>().unwrap();
        assert_eq!(effect.material(), NSVisualEffectMaterial::Titlebar);
        assert_eq!(effect.blendingMode(), NSVisualEffectBlendingMode::BehindWindow);
        assert!(effect.mouseDownCanMoveWindow(), "native titlebar effect must preserve window dragging");
        assert_eq!(effect.frame(), host.bounds());
        titlebar_material(&window, mtm, false);
        assert_eq!(window.titlebarAppearsTransparent(), initial);
        assert!(!host.subviews().iter().any(|v| v.identifier().is_some_and(|id| id.to_string().starts_with(TITLEBAR_IDENTIFIER))));
    }
    titlebar_material(&window, mtm, true);
    assert!(host.subviews().iter().any(|v| v.downcast_ref::<NSVisualEffectView>().is_some()));
    titlebar_material(&window, mtm, false);
    let material = make_material(mtm, &content, 10., true);
    let glass = material.downcast_ref::<NSGlassEffectView>().unwrap();
    assert_eq!(glass.style(), NSGlassEffectViewStyle::Regular);
    assert!(glass.tintColor().is_none());
    material.setIdentifier(Some(&NSString::from_str(IDENTIFIER)));
    fit_material(&material, &content);
    fit_material(&material, &content);
    assert_eq!(content.subviews().len(), 2);
    assert_eq!(content.subviews().objectAtIndex(0), material);
    assert_eq!(web.superview().unwrap(), content);
    for radius in [10., 0., 24., 0.] {
        clip_floating_tree(&content, radius);
        for view in [&*content, &*web, &*material] {
            let layer: Retained<AnyObject> = msg_send![view, layer];
            let actual: f64 = msg_send![&layer, cornerRadius];
            let masks: bool = msg_send![&layer, masksToBounds];
            assert_eq!(actual, radius);
            assert_eq!(masks, radius > 0.);
        }
    }
    // Remove glass: standard/off still updates the root and actual WebView clip.
    material.removeFromSuperview();
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
        clip_floating_tree(&floating_root, radius);
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
    println!("PASS actual Rust/AppKit: Regular nil-tint material, single sibling under WKWebView, native titlebar enable/repeat/restore(false + true), fallback, unchanged content/traffic lights/style, native root + WKWebView radius10/0/24/0 and standard/off 24/0");
}}
'''
path = scratch / "probe.rs"
path.write_text(rust)
deps = repo / "src-tauri/target/debug/deps"
command = ["rustc", "--edition=2021", str(path), "-o", str(scratch / "probe"), "-L", f"dependency={deps}", "-l", "framework=WebKit"]
for name in ["objc2", "objc2_app_kit", "objc2_foundation"]:
    library = max(deps.glob(f"lib{name}-*.rlib"), key=lambda p: p.stat().st_mtime)
    command += ["--extern", f"{name}={library}"]
subprocess.run(command, check=True)
subprocess.run([str(scratch / "probe")], check=True, timeout=30)
