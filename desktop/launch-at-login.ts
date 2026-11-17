import { invoke } from "@tauri-apps/api/core";

// Both settings windows read the native registration, including macOS's
// disabled-service override, rather than trusting a saved checkbox.
export const getLaunchAtLogin = () => invoke<boolean>("get_launch_at_login");
export const setLaunchAtLogin = (enabled: boolean) => invoke<boolean>("set_launch_at_login", { enabled });
