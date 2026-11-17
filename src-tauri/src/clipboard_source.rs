//! Filters automatic clipboard ingress only. Explicit paste and compression
//! never pass through this policy and no clipboard representation is rewritten.
use serde::Deserialize;

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct SourcePolicy {
    pub clipboard_exclude_office: bool,
    pub clipboard_excluded_apps: Vec<String>,
}
impl Default for SourcePolicy {
    fn default() -> Self {
        Self {
            clipboard_exclude_office: true,
            clipboard_excluded_apps: Vec::new(),
        }
    }
}

#[derive(Default, Debug)]
pub(crate) struct SourceIdentity {
    /// A pasteboard-provided bundle ID or Windows clipboard owner executable.
    pub owner: Option<String>,
    pub owner_aliases: Vec<String>,
    /// macOS has no public general-pasteboard owner API. Use the application
    /// active when a new generation is observed if no owner marker is present.
    pub active: Vec<String>,
    pub formats: Vec<String>,
}

fn app_key(value: &str) -> String {
    value
        .trim()
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or_default()
        .to_lowercase()
        .trim_end_matches(".exe")
        .trim_end_matches(".app")
        .to_string()
}
fn office_app(value: &str) -> bool {
    matches!(
        app_key(value).as_str(),
        "com.microsoft.excel"
            | "com.microsoft.word"
            | "com.microsoft.powerpoint"
            | "com.microsoft.onenote.mac"
            | "com.microsoft.onenote"
            | "com.microsoft.outlook"
            | "com.microsoft.access"
            | "com.microsoft.publisher"
            | "excel"
            | "winword"
            | "powerpnt"
            | "onenote"
            | "outlook"
            | "msaccess"
            | "mspub"
            | "microsoft excel"
            | "microsoft word"
            | "microsoft powerpoint"
            | "microsoft onenote"
            | "microsoft outlook"
            | "word"
            | "powerpoint"
    )
}
fn office_format(value: &str) -> bool {
    let value = value.to_lowercase();
    [
        "com.microsoft.excel",
        "com.microsoft.word",
        "com.microsoft.powerpoint",
        "com.microsoft.onenote",
        "biff",
        "xml spreadsheet",
        "onenote internal",
    ]
    .iter()
    .any(|prefix| value.starts_with(prefix))
}
impl SourcePolicy {
    pub fn excludes(&self, source: &SourceIdentity) -> bool {
        let apps: Vec<&str> = match &source.owner {
            Some(owner) => std::iter::once(owner.as_str())
                .chain(source.owner_aliases.iter().map(String::as_str))
                .collect(),
            None => source.active.iter().map(String::as_str).collect(),
        };
        (self.clipboard_exclude_office
            && (apps.iter().any(|app| office_app(app))
                || source.formats.iter().any(|format| office_format(format))))
            || apps.iter().any(|app| {
                self.clipboard_excluded_apps
                    .iter()
                    .map(|rule| app_key(rule))
                    .any(|rule| !rule.is_empty() && rule == app_key(app))
            })
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn current_source() -> SourceIdentity {
    objc2::rc::autoreleasepool(|_| macos_source(&objc2_app_kit::NSPasteboard::generalPasteboard()))
}

#[cfg(target_os = "macos")]
fn macos_source(board: &objc2_app_kit::NSPasteboard) -> SourceIdentity {
    use objc2_app_kit::{NSRunningApplication, NSWorkspace};
    use objc2_foundation::NSString;
    let owner = ["org.nspasteboard.source", "com.microsoft.appbundleid"]
        .iter()
        .find_map(|key| {
            board
                .stringForType(&NSString::from_str(key))
                .map(|v| v.to_string())
                .filter(|v| !v.trim().is_empty())
        });
    let formats = board
        .types()
        .map(|types| types.iter().map(|v| v.to_string()).collect())
        .unwrap_or_default();
    let owner_aliases = owner
        .as_ref()
        .map(|id| {
            NSRunningApplication::runningApplicationsWithBundleIdentifier(&NSString::from_str(id))
                .iter()
                .filter_map(|app| app.localizedName().map(|name| name.to_string()))
                .collect()
        })
        .unwrap_or_default();
    let mut active = Vec::new();
    if owner.is_none() {
        if let Some(app) = NSWorkspace::sharedWorkspace().frontmostApplication() {
            if let Some(id) = app.bundleIdentifier() {
                active.push(id.to_string());
            }
            if let Some(name) = app.localizedName() {
                active.push(name.to_string());
            }
        }
    }
    SourceIdentity {
        owner,
        owner_aliases,
        active,
        formats,
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn current_source() -> SourceIdentity {
    use windows_sys::Win32::{
        Foundation::CloseHandle,
        System::{
            DataExchange::GetClipboardOwner,
            Threading::{
                OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
            },
        },
        UI::WindowsAndMessaging::GetWindowThreadProcessId,
    };
    // Use the actual clipboard owner, never whichever app happened to become
    // foreground after copying. Only request process-name access.
    let owner = unsafe {
        let window = GetClipboardOwner();
        let mut pid = 0;
        if !window.is_null() {
            GetWindowThreadProcessId(window, &mut pid);
        }
        let process = if pid == 0 {
            std::ptr::null_mut()
        } else {
            OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid)
        };
        if process.is_null() {
            None
        } else {
            let mut buffer = vec![0u16; 32768];
            let mut length = buffer.len() as u32;
            let ok = QueryFullProcessImageNameW(process, 0, buffer.as_mut_ptr(), &mut length);
            CloseHandle(process);
            (ok != 0).then(|| String::from_utf16_lossy(&buffer[..length as usize]))
        }
    };
    SourceIdentity {
        owner,
        ..Default::default()
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub(crate) fn current_source() -> SourceIdentity {
    SourceIdentity::default()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn office_defaults_cover_both_platforms_without_blocking_other_microsoft_apps() {
        let policy = SourcePolicy::default();
        for owner in [
            "com.microsoft.Excel",
            "com.microsoft.onenote.mac",
            r"C:\Program Files\Office\EXCEL.EXE",
            "ONENOTE.EXE",
            "Microsoft PowerPoint",
        ] {
            assert!(
                policy.excludes(&SourceIdentity {
                    owner: Some(owner.into()),
                    ..Default::default()
                }),
                "{owner}"
            );
        }
        for owner in [
            "com.microsoft.edgemac",
            "msedge.exe",
            "Photos",
            "myexceltool.exe",
        ] {
            assert!(
                !policy.excludes(&SourceIdentity {
                    owner: Some(owner.into()),
                    ..Default::default()
                }),
                "{owner}"
            );
        }
    }
    #[test]
    fn explicit_owner_wins_over_foreground_and_office_formats_survive_app_switching() {
        let mut source = SourceIdentity {
            owner: Some("photos.exe".into()),
            active: vec!["Microsoft Excel".into()],
            ..Default::default()
        };
        assert!(!SourcePolicy::default().excludes(&source));
        source.owner = None;
        assert!(SourcePolicy::default().excludes(&source));
        source.active.clear();
        source.formats.push("com.microsoft.excel.BIFF8".into());
        assert!(SourcePolicy::default().excludes(&source));
        assert!(!SourcePolicy {
            clipboard_exclude_office: false,
            ..Default::default()
        }
        .excludes(&source));
    }
    #[test]
    fn custom_rules_are_exact_case_insensitive_names_paths_or_bundle_ids() {
        let policy = SourcePolicy {
            clipboard_exclude_office: false,
            clipboard_excluded_apps: vec![
                " Notes.app ".into(),
                "com.example.editor".into(),
                "CUSTOM.EXE".into(),
                "".into(),
            ],
        };
        for owner in [
            "Notes",
            "/Applications/Notes.app",
            "com.example.editor",
            "custom.exe",
        ] {
            assert!(policy.excludes(&SourceIdentity {
                owner: Some(owner.into()),
                ..Default::default()
            }));
        }
        assert!(!policy.excludes(&SourceIdentity {
            owner: Some("NotesPlus".into()),
            ..Default::default()
        }));
        assert!(!policy.excludes(&SourceIdentity::default()));
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn microsoft_bundle_marker_is_read_without_altering_rich_clipboard_content() {
        use objc2::runtime::ProtocolObject;
        use objc2_app_kit::{NSPasteboard, NSPasteboardItem, NSPasteboardWriting};
        use objc2_foundation::{NSArray, NSData, NSString};
        objc2::rc::autoreleasepool(|_| {
            let board = NSPasteboard::pasteboardWithUniqueName();
            let item = NSPasteboardItem::new();
            let key = NSString::from_str("com.microsoft.appbundleid");
            assert!(item.setString_forType(&NSString::from_str("com.microsoft.Excel"), &key));
            let html_key = NSString::from_str("public.html");
            let html = b"<table><tr><td>PicLite test</td></tr></table>";
            assert!(item.setData_forType(&NSData::with_bytes(html), &html_key));
            board.clearContents();
            assert!(board.writeObjects(&NSArray::from_slice(&[ProtocolObject::<
                dyn NSPasteboardWriting,
            >::from_ref(&*item)])));
            let generation = board.changeCount();
            let source = macos_source(&board);
            assert_eq!(source.owner.as_deref(), Some("com.microsoft.Excel"));
            assert!(
                source.active.is_empty(),
                "explicit owner must survive foreground app switching"
            );
            assert!(SourcePolicy::default().excludes(&source));
            assert!(!SourcePolicy {
                clipboard_exclude_office: false,
                ..Default::default()
            }
            .excludes(&source));
            assert_eq!(board.changeCount(), generation);
            assert_eq!(
                unsafe { board.dataForType(&html_key).unwrap().as_bytes_unchecked() },
                html
            );
            board.clearContents();
        });
    }
}
