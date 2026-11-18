#[cfg(target_os = "macos")]
use tauri::Manager;
use tauri_plugin_autostart::ManagerExt;

#[cfg(target_os = "macos")]
fn launch_domain() -> Result<String, String> {
    let output = std::process::Command::new("/usr/bin/id").arg("-u").output().map_err(|e| e.to_string())?;
    let uid = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !output.status.success() || uid.is_empty() || !uid.bytes().all(|c| c.is_ascii_digit()) {
        return Err("无法读取登录用户".into());
    }
    Ok(format!("gui/{uid}"))
}

#[cfg(any(target_os = "macos", test))]
fn service_disabled(output: &str, label: &str) -> bool {
    output.lines().any(|line| line.trim().strip_prefix(&format!("\"{label}\" => "))
        .is_some_and(|value| value.trim() == "disabled"))
}

#[cfg(target_os = "macos")]
fn macos_disabled(app: &tauri::AppHandle) -> Result<bool, String> {
    let output = std::process::Command::new("/bin/launchctl")
        .args(["print-disabled", &launch_domain()?]).output().map_err(|e| e.to_string())?;
    if !output.status.success() { return Err("无法读取系统登录项状态".into()); }
    Ok(service_disabled(&String::from_utf8_lossy(&output.stdout), &app.package_info().name))
}

#[tauri::command]
pub async fn get_launch_at_login(app: tauri::AppHandle) -> Result<bool, String> {
    if !app.autolaunch().is_enabled().map_err(|e| e.to_string())? { return Ok(false); }
    #[cfg(target_os = "macos")]
    {
        if macos_disabled(&app)? { return Ok(false); }
        // An old registration can survive moving or replacing an app.
        let plist_path = app.path().home_dir().map_err(|e| e.to_string())?
            .join("Library/LaunchAgents").join(format!("{}.plist", app.package_info().name));
        let value = plist::Value::from_file(plist_path).map_err(|e| e.to_string())?;
        let executable = value.as_dictionary().and_then(|v| v.get("ProgramArguments"))
            .and_then(|v| v.as_array()).and_then(|v| v.first()).and_then(|v| v.as_string());
        if !executable.is_some_and(|path| std::path::Path::new(path).is_file()) { return Ok(false); }
    }
    Ok(true)
}

#[tauri::command]
pub async fn set_launch_at_login(app: tauri::AppHandle, enabled: bool) -> Result<bool, String> {
    if enabled {
        #[cfg(target_os = "macos")]
        {
            let path = std::env::current_exe().map_err(|e| e.to_string())?;
            if path.to_string_lossy().contains("/AppTranslocation/") {
                return Err("请先将 PicLite 拖入应用程序文件夹，再开启登录时启动".into());
            }
        }
        app.autolaunch().enable().map_err(|e| e.to_string())?;
        #[cfg(target_os = "macos")]
        {
            // Writing a plist alone does not undo macOS's disabled override.
            let service = format!("{}/{}", launch_domain()?, app.package_info().name);
            let output = std::process::Command::new("/bin/launchctl").args(["enable", &service])
                .output().map_err(|e| e.to_string())?;
            if !output.status.success() {
                return Err(format!("无法启用系统登录项：{}", String::from_utf8_lossy(&output.stderr).trim()));
            }
        }
    } else {
        app.autolaunch().disable().map_err(|e| e.to_string())?;
    }
    let actual = get_launch_at_login(app).await?;
    if actual != enabled { return Err("系统未保存登录时启动设置，请重试".into()); }
    Ok(actual)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reads_exact_service_override_not_other_apps_or_file_presence() {
        let output = "disabled services = {\n\t\"PicLite Preview\" => disabled\n\t\"PicLite\" => enabled\n}";
        assert!(!service_disabled(output, "PicLite"));
        assert!(service_disabled(output, "PicLite Preview"));
        assert!(service_disabled("\t\"PicLite\" => disabled", "PicLite"));
        assert!(!service_disabled("", "PicLite"));
    }
}
