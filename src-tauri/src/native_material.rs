//! Native AppKit materials. Independently implemented against Apple's public APIs.
//! The material is a sibling below the existing content, never a replacement for it.
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialState {
    backend: &'static str,
    enabled: bool,
    reduced_transparency: bool,
    radius: f64,
}

#[tauri::command]
pub async fn set_window_material(
    window: tauri::WebviewWindow,
    enabled: bool,
    radius: Option<f64>,
) -> Result<MaterialState, String> {
    let radius = radius
        .filter(|n| n.is_finite())
        .unwrap_or(18.0)
        .clamp(0.0, 80.0);
    #[cfg(target_os = "macos")]
    {
        let (send, mut receive) = tauri::async_runtime::channel(1);
        let target = window.clone();
        window
            .run_on_main_thread(move || {
                let _ = send.try_send(macos::apply(&target, enabled, radius));
            })
            .map_err(|error| error.to_string())?;
        receive
            .recv()
            .await
            .ok_or("Native material dispatcher closed")?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, enabled);
        Ok(MaterialState {
            backend: "unsupported",
            enabled: false,
            reduced_transparency: false,
            radius,
        })
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::MaterialState;
    use objc2::{
        msg_send,
        rc::Retained,
        runtime::{AnyClass, AnyObject},
        MainThreadMarker,
    };
    use objc2_app_kit::{
        NSAutoresizingMaskOptions, NSColor, NSGlassEffectView, NSGlassEffectViewStyle,
        NSUserInterfaceItemIdentification, NSView, NSVisualEffectBlendingMode,
        NSVisualEffectMaterial, NSVisualEffectState, NSVisualEffectView, NSWindow,
        NSWindowOrderingMode, NSWorkspace,
    };
    use objc2_foundation::NSString;
    use std::ffi::CStr;

    const IDENTIFIER: &str = "com.piclite.native-material";
    const TITLEBAR_IDENTIFIER: &str = "com.piclite.native-titlebar";

    fn make_material(
        mtm: MainThreadMarker,
        host: &NSView,
        radius: f64,
        glass: bool,
    ) -> Retained<NSView> {
        if glass {
            let effect = NSGlassEffectView::initWithFrame(mtm.alloc(), host.bounds());
            // Regular softens desktop lettering; Clear is intended for unobstructed backgrounds.
            effect.setStyle(NSGlassEffectViewStyle::Regular);
            effect.setTintColor(None);
            effect.setCornerRadius(radius);
            let surface = NSView::initWithFrame(mtm.alloc(), host.bounds());
            effect.setContentView(Some(&surface));
            effect.into_super()
        } else {
            let effect = NSVisualEffectView::initWithFrame(mtm.alloc(), host.bounds());
            effect.setMaterial(NSVisualEffectMaterial::Popover);
            effect.setBlendingMode(NSVisualEffectBlendingMode::BehindWindow);
            effect.setState(NSVisualEffectState::Active);
            effect.into_super()
        }
    }

    fn fit_material(view: &NSView, host: &NSView) {
        view.setFrame(host.bounds());
        view.setAutoresizingMask(
            NSAutoresizingMaskOptions::ViewWidthSizable
                | NSAutoresizingMaskOptions::ViewHeightSizable,
        );
        if unsafe { view.superview() }.is_none() {
            host.addSubview_positioned_relativeTo(view, NSWindowOrderingMode::Below, None);
        }
    }

    fn clip_view(view: &NSView, radius: f64) {
        view.setWantsLayer(true);
        unsafe {
            let layer: Option<Retained<AnyObject>> = msg_send![view, layer];
            if let Some(layer) = layer {
                let _: () = msg_send![&layer, setCornerRadius: radius];
                let _: () = msg_send![&layer, setMasksToBounds: radius > 0.0];
            }
        }
    }

    fn clip_floating_tree(view: &NSView, radius: f64) {
        // Wry may put a rounded backing layer above the material. Reset every
        // full-size ancestor/child, including WKWebView, so numeric zero is square.
        clip_view(view, radius);
        for child in view.subviews().iter() {
            if child.frame().size == view.bounds().size {
                clip_floating_tree(&child, radius);
            }
        }
    }

    fn titlebar_material(window: &NSWindow, _mtm: MainThreadMarker, _enabled: bool) {
        // Wry's transparent(true) implicitly enables FullSizeContentView, even
        // with the default decorated titlebar. Its WKWebView then occupies the
        // titlebar's 32-point strip. Preserve the current viewport while moving
        // it below native chrome; never install a material above application UI.
        let button: Option<Retained<NSView>> =
            unsafe { msg_send![window, standardWindowButton: 0usize] };
        let Some(host) = button.and_then(|button| unsafe { button.superview() }) else {
            return; // Borderless floating windows retain their own geometry.
        };
        for view in host.subviews().iter() {
            if view.identifier().is_some_and(|id| {
                let id = id.to_string();
                id == TITLEBAR_IDENTIFIER || id == format!("{TITLEBAR_IDENTIFIER}.transparent")
            }) {
                view.removeFromSuperview();
            }
        }
        let style = window.styleMask();
        if style.contains(objc2_app_kit::NSWindowStyleMask::FullSizeContentView) {
            let viewport = window.contentView().map(|view| view.bounds().size);
            window.setStyleMask(style & !objc2_app_kit::NSWindowStyleMask::FullSizeContentView);
            if let Some(size) = viewport {
                window.setContentSize(size);
            }
        }
        // Let AppKit draw and clip its appearance-aware native titlebar material.
        window.setTitlebarAppearsTransparent(false);
    }

    pub(super) fn apply(
        window: &tauri::WebviewWindow,
        requested: bool,
        radius: f64,
    ) -> Result<MaterialState, String> {
        let mtm = MainThreadMarker::new().ok_or("AppKit material must run on the main thread")?;
        let reduced = NSWorkspace::sharedWorkspace().accessibilityDisplayShouldReduceTransparency();
        let enabled = requested && !reduced;
        // The floating logo/card shell always needs a clear backing, even without glass.
        let transparent_shell = window.label() == "dropzone";
        // set_background_color changes both the Wry backing store and native background.
        window
            .set_background_color(Some(tauri::window::Color(
                0,
                0,
                0,
                if enabled || transparent_shell { 0 } else { 255 },
            )))
            .map_err(|error| error.to_string())?;
        let ns_window = unsafe {
            &*(window.ns_window().map_err(|error| error.to_string())? as *const NSWindow)
        };
        let content = ns_window
            .contentView()
            .ok_or("Window has no native content view")?;
        let identifier = NSString::from_str(IDENTIFIER);
        let existing = content
            .subviews()
            .iter()
            .find(|view| view.identifier().as_deref() == Some(&identifier))
            .map(|v| v.clone());
        if transparent_shell {
            clip_floating_tree(&content, radius);
            // NSThemeFrame may carry its own rounded mask above the content root.
            if let Some(frame) = unsafe { content.superview() } {
                clip_view(&frame, radius);
            }
            ns_window.invalidateShadow();
        }
        if !enabled {
            titlebar_material(ns_window, mtm, false);
            if let Some(view) = existing {
                view.removeFromSuperview();
            }
            ns_window.setOpaque(!transparent_shell);
            let background = if transparent_shell {
                NSColor::clearColor()
            } else {
                NSColor::windowBackgroundColor()
            };
            ns_window.setBackgroundColor(Some(&background));
            return Ok(MaterialState {
                backend: "opaque",
                enabled: false,
                reduced_transparency: reduced,
                radius,
            });
        }
        ns_window.setOpaque(false);
        ns_window.setBackgroundColor(Some(&NSColor::clearColor()));
        let glass_available =
            AnyClass::get(CStr::from_bytes_with_nul(b"NSGlassEffectView\0").unwrap()).is_some();
        titlebar_material(ns_window, mtm, true);
        let material: Retained<NSView> =
            existing.unwrap_or_else(|| make_material(mtm, &content, radius, glass_available));
        if glass_available {
            if let Some(glass) = material.downcast_ref::<NSGlassEffectView>() {
                glass.setStyle(NSGlassEffectViewStyle::Regular);
                glass.setTintColor(None);
                glass.setCornerRadius(radius);
            }
        } else {
            clip_view(&material, radius);
        }
        material.setIdentifier(Some(&identifier));
        fit_material(&material, &content);
        if transparent_shell {
            clip_floating_tree(&content, radius);
        }
        Ok(MaterialState {
            backend: if glass_available {
                "nsglass-regular"
            } else {
                "nsvisualeffect"
            },
            enabled: true,
            reduced_transparency: reduced,
            radius,
        })
    }
}
