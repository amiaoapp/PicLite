use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SystemMemory {
    total_bytes: u64,
    available_bytes: u64,
}

#[tauri::command]
pub(crate) fn get_system_memory() -> Option<SystemMemory> {
    let (total_bytes, available_bytes) = read_memory()?;
    (total_bytes > 0).then_some(SystemMemory {
        total_bytes,
        available_bytes: available_bytes.min(total_bytes),
    })
}

#[cfg(target_os = "windows")]
fn read_memory() -> Option<(u64, u64)> {
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    let mut status = MEMORYSTATUSEX {
        dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
        ..Default::default()
    };
    // The structure's length is required before calling this API.
    (unsafe { GlobalMemoryStatusEx(&mut status) } != 0)
        .then_some((status.ullTotalPhys, status.ullAvailPhys))
}

#[cfg(target_os = "macos")]
fn read_memory() -> Option<(u64, u64)> {
    // Keep one host send right for the process so polling does not acquire a
    // new reference each time.
    static HOST_PORT: std::sync::OnceLock<libc::mach_port_t> = std::sync::OnceLock::new();
    #[allow(deprecated)]
    let host = *HOST_PORT.get_or_init(|| unsafe { libc::mach_host_self() });
    let mut total = 0u64;
    let mut size = std::mem::size_of_val(&total);
    let mut stats: libc::vm_statistics64 = unsafe { std::mem::zeroed() };
    let mut count = libc::HOST_VM_INFO64_COUNT;
    // These APIs fill the supplied buffers with physical memory and VM counters.
    unsafe {
        if libc::sysctlbyname(
            c"hw.memsize".as_ptr(),
            (&mut total as *mut u64).cast(),
            &mut size,
            std::ptr::null_mut(),
            0,
        ) != 0
        {
            return None;
        }
        let status = libc::host_statistics64(
            host,
            libc::HOST_VM_INFO64,
            (&mut stats as *mut libc::vm_statistics64).cast(),
            &mut count,
        );
        if status != libc::KERN_SUCCESS {
            return None;
        }
    }
    // File caches can be reclaimed, so count resident anonymous, wired and
    // compressed pages, subtracting purgeable pages from anonymous memory.
    let used_pages = u64::from(
        stats
            .internal_page_count
            .saturating_sub(stats.purgeable_count),
    ) + u64::from(stats.wire_count)
        + u64::from(stats.compressor_page_count);
    let page_size = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
    (page_size > 0).then(|| (total, total.saturating_sub(used_pages * page_size as u64)))
}

#[cfg(target_os = "linux")]
fn read_memory() -> Option<(u64, u64)> {
    let info = std::fs::read_to_string("/proc/meminfo").ok()?;
    let bytes = |key: &str| {
        info.lines()
            .find_map(|line| line.strip_prefix(key))?
            .split_whitespace()
            .next()?
            .parse::<u64>()
            .ok()?
            .checked_mul(1024)
    };
    Some((bytes("MemTotal:")?, bytes("MemAvailable:")?))
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn read_memory() -> Option<(u64, u64)> {
    None
}
