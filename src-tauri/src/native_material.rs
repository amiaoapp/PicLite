//! Standard native backing, floating clipping, and decorated titlebar safety.
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
    // Keep the old IPC signature, but the retired feature cannot be enabled.
    let _ = enabled;
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
                let _ = send.try_send(macos::apply(&target, radius));
            })
            .map_err(|error| error.to_string())?;
        receive
            .recv()
            .await
            .ok_or("Native appearance dispatcher closed")?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
        Ok(MaterialState {
            backend: "opaque",
            enabled: false,
            reduced_transparency: false,
            radius,
        })
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::MaterialState;
    use objc2::{msg_send, rc::Retained, runtime::AnyObject, MainThreadMarker};
    use objc2_app_kit::{NSColor, NSUserInterfaceItemIdentification, NSView, NSWindow};

    const IDENTIFIER: &str = "com.piclite.native-material";
    const TITLEBAR_IDENTIFIER: &str = "com.piclite.native-titlebar";

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
        // Reset full-size ancestors and WKWebView descendants, including zero.
        clip_view(view, radius);
        for child in view.subviews().iter() {
            if child.frame().size == view.bounds().size {
                clip_floating_tree(&child, radius);
            }
        }
    }

    fn titlebar_material(window: &NSWindow) {
        // Wry transparent(true) can put WKWebView under decorated native chrome.
        // Preserve its viewport while moving it below the titlebar.
        let button: Option<Retained<NSView>> =
            unsafe { msg_send![window, standardWindowButton: 0usize] };
        let Some(host) = button.and_then(|button| unsafe { button.superview() }) else {
            return;
        };
        for view in host.subviews().iter() {
            if view
                .identifier()
                .is_some_and(|id| id.to_string().starts_with(TITLEBAR_IDENTIFIER))
            {
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
        window.setTitlebarAppearsTransparent(false);
    }

    fn standard_backing(window: &NSWindow, floating: bool, radius: f64) -> Result<(), String> {
        let content = window
            .contentView()
            .ok_or("Window has no native content view")?;
        // Clean up an old tagged sibling if a pre-removal caller installed one.
        for view in content.subviews().iter() {
            if view
                .identifier()
                .is_some_and(|id| id.to_string() == IDENTIFIER)
            {
                view.removeFromSuperview();
            }
        }
        titlebar_material(window);
        if floating {
            clip_floating_tree(&content, radius);
            if let Some(frame) = unsafe { content.superview() } {
                clip_view(&frame, radius);
            }
            window.invalidateShadow();
        }
        window.setOpaque(!floating);
        let background = if floating {
            NSColor::clearColor()
        } else {
            NSColor::windowBackgroundColor()
        };
        window.setBackgroundColor(Some(&background));
        Ok(())
    }

    pub(super) fn apply(
        window: &tauri::WebviewWindow,
        radius: f64,
    ) -> Result<MaterialState, String> {
        let _mtm =
            MainThreadMarker::new().ok_or("AppKit appearance must run on the main thread")?;
        let floating = window.label() == "dropzone";
        window
            .set_background_color(Some(tauri::window::Color(
                0,
                0,
                0,
                if floating { 0 } else { 255 },
            )))
            .map_err(|error| error.to_string())?;
        let native = unsafe {
            &*(window.ns_window().map_err(|error| error.to_string())? as *const NSWindow)
        };
        standard_backing(native, floating, radius)?;
        Ok(MaterialState {
            backend: "opaque",
            enabled: false,
            reduced_transparency: false,
            radius,
        })
    }
}
