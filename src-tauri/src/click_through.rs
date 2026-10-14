use super::*;

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ToggleRegion {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl ToggleRegion {
    fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && y >= self.y && x < self.x + self.width && y < self.y + self.height
    }
    pub(super) fn valid(&self) -> bool {
        [self.x, self.y, self.width, self.height]
            .into_iter()
            .all(|v| v.is_finite() && v >= 0.0 && v <= 4096.0)
            && self.width <= 128.0
            && self.height <= 128.0
    }
}

pub(super) fn ignore_at_cursor(window: &tauri::WebviewWindow, state: &DesktopState) -> bool {
    if !state.floating_click_through.load(Ordering::Relaxed) {
        return false;
    }
    let region = state.floating_toggle_region.lock().ok().and_then(|v| *v);
    let (Some(region), Ok(cursor), Ok(origin), Ok(scale)) = (
        region,
        window.cursor_position(),
        window.inner_position(),
        window.scale_factor(),
    ) else {
        return true;
    };
    !region.contains(
        (cursor.x - origin.x as f64) / scale,
        (cursor.y - origin.y as f64) / scale,
    )
}

pub(super) fn start(app: AppHandle) {
    thread::spawn(move || loop {
        let state = app.state::<DesktopState>();
        if state.quitting.load(Ordering::Relaxed) {
            break;
        }
        if let Some(window) = app.get_webview_window("dropzone") {
            let _ = apply(&window, &state);
        } else {
            if let Ok(mut last) = state.floating_cursor_ignored.lock() {
                *last = None;
            }
        }
        thread::sleep(Duration::from_millis(
            if state.floating_click_through.load(Ordering::Relaxed) {
                25
            } else {
                120
            },
        ));
    });
}

// UI commands and cursor polling share the applied state. A region update can
// otherwise restore mouse events between polls and leave the cached flag stale.
pub(super) fn apply(window: &tauri::WebviewWindow, state: &DesktopState) -> Result<(), String> {
    let ignored = ignore_at_cursor(window, state);
    let mut last = state
        .floating_cursor_ignored
        .lock()
        .map_err(|e| e.to_string())?;
    if *last != Some(ignored) {
        window
            .set_ignore_cursor_events(ignored)
            .map_err(|e| e.to_string())?;
        *last = Some(ignored);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_the_toggle_receives_clicks_while_the_rest_of_the_window_passes_through() {
        let region = ToggleRegion {
            x: 240.0,
            y: 280.0,
            width: 29.0,
            height: 29.0,
        };
        assert!(region.valid());
        assert!(region.contains(255.0, 295.0));
        assert!(!region.contains(239.0, 295.0));
        assert!(!region.contains(269.0, 295.0));
        // A monitor at a negative desktop origin and a 2x DPI scale.
        let (origin_x, origin_y, scale) = (-1920.0, 100.0, 2.0);
        assert!(region.contains((-1410.0 - origin_x) / scale, (690.0 - origin_y) / scale));
        assert!(!ToggleRegion {
            x: f64::NAN,
            ..region
        }
        .valid());
    }
}
