use super::*;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PointerPosition {
    x: f64,
    y: f64,
    focused: bool,
}

fn logical_position(
    cursor: PhysicalPosition<f64>,
    origin: PhysicalPosition<i32>,
    scale: f64,
    focused: bool,
) -> PointerPosition {
    PointerPosition {
        x: (cursor.x - origin.x as f64) / scale,
        y: (cursor.y - origin.y as f64) / scale,
        focused,
    }
}

// Inactive WKWebView/WebView2 windows can stop delivering mouse enter/leave
// events after keyboard app switching. Read the OS cursor without activating
// the floating window or changing click-through behavior.
#[tauri::command]
pub(super) async fn get_floating_pointer_position(
    window: tauri::WebviewWindow,
    state: State<'_, DesktopState>,
) -> Result<Option<PointerPosition>, String> {
    if window.label() != "dropzone"
        || !window.is_visible().map_err(|e| e.to_string())?
        || click_through::ignore_at_cursor(&window, &state)
    {
        return Ok(None);
    }
    Ok(Some(logical_position(
        window.cursor_position().map_err(|e| e.to_string())?,
        window.inner_position().map_err(|e| e.to_string())?,
        window.scale_factor().map_err(|e| e.to_string())?,
        window.is_focused().map_err(|e| e.to_string())?,
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cursor_coordinates_follow_window_position_and_monitor_scale() {
        for scale in [1.0, 1.25, 1.5, 2.0] {
            let origin = PhysicalPosition::new(-1920, 100);
            let point = logical_position(
                PhysicalPosition::new(-1920.0 + 120.0 * scale, 100.0 + 90.0 * scale),
                origin,
                scale,
                false,
            );
            assert_eq!((point.x, point.y), (120.0, 90.0));
            assert!(!point.focused);
            let outside = logical_position(PhysicalPosition::new(-2000.0, 80.0), origin, scale, true);
            assert!(outside.x < 0.0 && outside.y < 0.0);
            assert!(outside.focused);
        }
    }
}
