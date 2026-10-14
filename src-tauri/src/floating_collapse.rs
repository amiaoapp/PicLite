use super::*;

pub(super) const ICON_EDGE: f64 = 64.0;

#[derive(Clone, Copy)]
pub(super) struct ExpandedGeometry {
    position: PhysicalPosition<i32>,
    size: tauri::PhysicalSize<u32>,
}

fn icon_position(geometry: ExpandedGeometry, scale: f64) -> PhysicalPosition<i32> {
    PhysicalPosition::new(
        geometry.position.x + geometry.size.width as i32 - (ICON_EDGE * scale).round() as i32,
        geometry.position.y,
    )
}

fn expanded_position(
    icon: PhysicalPosition<i32>,
    size: tauri::PhysicalSize<u32>,
    icon_width: u32,
) -> PhysicalPosition<i32> {
    PhysicalPosition::new(icon.x - size.width as i32 + icon_width as i32, icon.y)
}

pub(super) fn set(
    window: &tauri::WebviewWindow,
    state: &DesktopState,
    collapsed: bool,
) -> Result<(), String> {
    if window.label() != "dropzone" {
        return Err("只有悬浮窗可以折叠".into());
    }
    let mut saved = state
        .floating_expanded_geometry
        .lock()
        .map_err(|e| e.to_string())?;
    if collapsed == state.floating_collapsed.load(Ordering::Relaxed) {
        return Ok(());
    }
    if collapsed {
        let geometry = ExpandedGeometry {
            position: window.outer_position().map_err(|e| e.to_string())?,
            size: window.inner_size().map_err(|e| e.to_string())?,
        };
        let scale = window.scale_factor().map_err(|e| e.to_string())?;
        *saved = Some(geometry);
        state.floating_collapsed.store(true, Ordering::Relaxed);
        let result = (|| {
            window.set_min_size(Some(LogicalSize::new(ICON_EDGE, ICON_EDGE)))?;
            window.set_resizable(false)?;
            window.set_size(LogicalSize::new(ICON_EDGE, ICON_EDGE))?;
            window.set_position(icon_position(geometry, scale))?;
            Ok::<(), tauri::Error>(())
        })();
        if let Err(error) = result {
            state.floating_collapsed.store(false, Ordering::Relaxed);
            let _ = window.set_resizable(true);
            let _ = window.set_min_size(Some(LogicalSize::new(246.0, 188.0)));
            let _ = window.set_size(geometry.size);
            let _ = window.set_position(geometry.position);
            *saved = None;
            return Err(error.to_string());
        }
    } else {
        let geometry = saved.as_ref().ok_or("无法读取展开前的窗口尺寸")?;
        // Restore beside the icon's current position, including any movement
        // made while folded, instead of jumping back to its old location.
        let position = expanded_position(
            window.outer_position().map_err(|e| e.to_string())?,
            geometry.size,
            window.inner_size().map_err(|e| e.to_string())?.width,
        );
        window.set_resizable(true).map_err(|e| e.to_string())?;
        window
            .set_min_size(Some(LogicalSize::new(246.0, 188.0)))
            .map_err(|e| e.to_string())?;
        window.set_size(geometry.size).map_err(|e| e.to_string())?;
        window.set_position(position).map_err(|e| e.to_string())?;
        state.floating_collapsed.store(false, Ordering::Relaxed);
        *saved = None;
    }
    keep_dropzone_on_screen(window);
    click_through::apply(window, state)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn folding_keeps_the_icon_at_the_top_right_on_scaled_negative_origin_monitors() {
        let geometry = ExpandedGeometry {
            position: PhysicalPosition::new(-960, 300),
            size: tauri::PhysicalSize::new(640, 460),
        };
        assert_eq!(
            icon_position(geometry, 2.0),
            PhysicalPosition::new(-448, 300)
        );
        assert_eq!(geometry.position, PhysicalPosition::new(-960, 300));
        assert_eq!(geometry.size, tauri::PhysicalSize::new(640, 460));
    }

    #[test]
    fn expanding_follows_a_dragged_icon_and_preserves_the_window_size() {
        let size = tauri::PhysicalSize::new(640, 460);
        assert_eq!(
            expanded_position(PhysicalPosition::new(-248, 500), size, 128),
            PhysicalPosition::new(-760, 500)
        );
        assert_eq!(
            expanded_position(PhysicalPosition::new(912, 40), size, 64),
            PhysicalPosition::new(336, 40)
        );
    }
}
