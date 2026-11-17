use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

/// Session-only switch. It must never overwrite the user's clipboard preference
/// or pause folder watchers. A revision also catches a quick pause/resume.
#[derive(Default)]
pub(crate) struct ClipboardMonitorControl {
    paused: AtomicBool,
    revision: AtomicU64,
}

impl ClipboardMonitorControl {
    pub fn paused(&self) -> bool { self.paused.load(Ordering::SeqCst) }
    pub fn revision(&self) -> u64 { self.revision.load(Ordering::SeqCst) }
    pub fn set_paused(&self, paused: bool) {
        if self.paused.swap(paused, Ordering::SeqCst) != paused {
            self.revision.fetch_add(1, Ordering::SeqCst);
        }
    }
    pub fn enabled(&self, configured: bool) -> bool { configured && !self.paused() }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn session_pause_keeps_the_saved_preference_and_detects_quick_resume() {
        let control = ClipboardMonitorControl::default();
        assert!(control.enabled(true));
        control.set_paused(true);
        assert!(!control.enabled(true));
        let revision = control.revision();
        control.set_paused(true);
        assert_eq!(control.revision(), revision);
        control.set_paused(false);
        assert!(control.enabled(true));
        assert!(!control.enabled(false));
        assert!(control.revision() > revision);
        assert!(!ClipboardMonitorControl::default().paused());
    }
}
