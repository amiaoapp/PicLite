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
        if !enabled {
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
        let material: Retained<NSView> = if let Some(view) = existing {
            view
        } else if glass_available {
            let glass = NSGlassEffectView::initWithFrame(mtm.alloc(), content.bounds());
            glass.setStyle(NSGlassEffectViewStyle::Clear);
            glass.setTintColor(None);
            glass.setCornerRadius(radius);
            // Give the material its own content container; leave Tauri's WKWebView untouched.
            let surface = NSView::initWithFrame(mtm.alloc(), content.bounds());
            glass.setContentView(Some(&surface));
            glass.into_super()
        } else {
            let effect = NSVisualEffectView::initWithFrame(mtm.alloc(), content.bounds());
            effect.setMaterial(NSVisualEffectMaterial::Popover);
            effect.setBlendingMode(NSVisualEffectBlendingMode::BehindWindow);
            effect.setState(NSVisualEffectState::Active);
            effect.into_super()
        };
        if glass_available {
            if let Some(glass) = material.downcast_ref::<NSGlassEffectView>() {
                glass.setCornerRadius(radius);
            }
        } else {
            // CALayer's public cornerRadius/masksToBounds APIs also work on macOS 11.
            material.setWantsLayer(true);
            unsafe {
                let layer: Option<Retained<AnyObject>> = msg_send![&material, layer];
                if let Some(layer) = layer {
                    let _: () = msg_send![&layer, setCornerRadius: radius];
                    let _: () = msg_send![&layer, setMasksToBounds: true];
                }
            }
        }
        material.setIdentifier(Some(&identifier));
        material.setFrame(content.bounds());
        material.setAutoresizingMask(
            NSAutoresizingMaskOptions::ViewWidthSizable
                | NSAutoresizingMaskOptions::ViewHeightSizable,
        );
        // Position below every pre-existing child, including WKWebView. AppKit retains it.
        // The view is retained locally and its parent is the retained window content view.
        if unsafe { material.superview() }.is_none() {
            content.addSubview_positioned_relativeTo(&material, NSWindowOrderingMode::Below, None);
        }
        Ok(MaterialState {
            backend: if glass_available {
                "nsglass-clear"
            } else {
                "nsvisualeffect"
            },
            enabled: true,
            reduced_transparency: reduced,
            radius,
        })
    }
}
