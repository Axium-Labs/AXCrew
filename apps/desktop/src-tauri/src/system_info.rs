//! Local system telemetry. Missing readings are null, never invented capacities.
use nvml_wrapper::Nvml;
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpuInfo {
    pub id: String,
    pub name: String,
    pub memory_total_mb: Option<u64>,
    pub memory_used_mb: Option<u64>,
    pub usage: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemInfo {
    pub cpu_usage: Option<f64>,
    pub memory_total_mb: Option<u64>,
    pub memory_used_mb: Option<u64>,
    pub memory_usage: Option<f64>,
    pub cpu_cores: Option<usize>,
    pub uptime_secs: Option<u64>,
    pub disk_total_mb: Option<u64>,
    pub disk_used_mb: Option<u64>,
    pub disk_usage: Option<f64>,
    pub disk_path: Option<String>,
    pub gpu_count: Option<usize>,
    pub gpu_memory_mb: Option<u64>,
    pub gpus: Option<Vec<GpuInfo>>,
}

#[cfg(windows)]
#[derive(Clone, Copy)]
struct CpuTimes {
    idle: u64,
    kernel: u64,
    user: u64,
}

#[cfg(windows)]
impl CpuTimes {
    fn usage_since(self, previous: Self) -> Option<f64> {
        // Windows kernel ticks include idle ticks. Use deltas across samples.
        let total = self
            .kernel
            .checked_sub(previous.kernel)?
            .checked_add(self.user.checked_sub(previous.user)?)?;
        let idle = self.idle.checked_sub(previous.idle)?;
        if total == 0 || idle > total {
            return None;
        }
        Some((total - idle) as f64 * 100.0 / total as f64)
    }
}

fn capacity(total: u64, free: u64) -> Option<(u64, u64, f64)> {
    if total == 0 || free > total {
        return None;
    }
    let used = total - free;
    Some((
        total / 1024 / 1024,
        used / 1024 / 1024,
        used as f64 * 100.0 / total as f64,
    ))
}

pub fn get_system_info() -> SystemInfo {
    #[cfg(target_os = "windows")]
    let (cpu_usage, memory, disk, uptime) = (
        windows::cpu_usage(),
        windows::memory(),
        windows::disk(),
        Some(windows::uptime()),
    );
    #[cfg(unix)]
    let (cpu_usage, memory, disk, uptime) = unix::snapshot();
    #[cfg(not(any(windows, unix)))]
    let (cpu_usage, memory, disk, uptime): (
        Option<f64>,
        Option<(u64, u64, f64)>,
        Option<(String, (u64, u64, f64))>,
        Option<u64>,
    ) = (None, None, None, None);
    let gpus = collect_gpus();
    SystemInfo {
        cpu_usage,
        memory_total_mb: memory.map(|value| value.0),
        memory_used_mb: memory.map(|value| value.1),
        memory_usage: memory.map(|value| value.2),
        cpu_cores: std::thread::available_parallelism()
            .ok()
            .map(|count| count.get()),
        uptime_secs: uptime,
        disk_total_mb: disk.as_ref().map(|value| value.1 .0),
        disk_used_mb: disk.as_ref().map(|value| value.1 .1),
        disk_usage: disk.as_ref().map(|value| value.1 .2),
        disk_path: disk.map(|value| value.0),
        gpu_count: gpus.as_ref().map(Vec::len),
        gpu_memory_mb: gpus.as_ref().and_then(|gpus| {
            gpus.iter()
                .try_fold(0u64, |total, gpu| total.checked_add(gpu.memory_total_mb?))
        }),
        gpus,
    }
}

fn collect_gpus() -> Option<Vec<GpuInfo>> {
    static DRIVER: OnceLock<Mutex<Option<Nvml>>> = OnceLock::new();
    let mut driver = DRIVER.get_or_init(|| Mutex::new(None)).lock().ok()?;
    if driver.is_none() {
        *driver = Some(Nvml::init().ok()?);
    }
    let nvml = driver.as_ref()?;
    let count = nvml.device_count().ok()?;
    Some(
        (0..count)
            .map(|index| {
                let device = nvml.device_by_index(index).ok();
                let memory = device
                    .as_ref()
                    .and_then(|gpu| gpu.memory_info().ok())
                    .filter(|value| value.total > 0 && value.used <= value.total);
                GpuInfo {
                    id: device
                        .as_ref()
                        .and_then(|gpu| gpu.uuid().ok())
                        .unwrap_or_else(|| format!("nvidia-{index}")),
                    name: device
                        .as_ref()
                        .and_then(|gpu| gpu.name().ok())
                        .unwrap_or_else(|| format!("NVIDIA GPU {index}")),
                    memory_total_mb: memory.as_ref().map(|value| value.total / 1024 / 1024),
                    memory_used_mb: memory.as_ref().map(|value| value.used / 1024 / 1024),
                    usage: device
                        .as_ref()
                        .and_then(|gpu| gpu.utilization_rates().ok())
                        .map(|value| value.gpu)
                        .filter(|value| *value <= 100),
                }
            })
            .collect(),
    )
}

#[cfg(unix)]
mod unix {
    use super::capacity;
    use std::{
        sync::{Mutex, OnceLock},
        time::Instant,
    };
    use sysinfo::{Disks, System};

    type Snapshot = (
        Option<f64>,
        Option<(u64, u64, f64)>,
        Option<(String, (u64, u64, f64))>,
        Option<u64>,
    );

    pub(super) fn snapshot() -> Snapshot {
        static CPU: OnceLock<Mutex<(System, Option<Instant>)>> = OnceLock::new();
        let Ok(mut state) = CPU.get_or_init(|| Mutex::new((System::new(), None))).lock() else {
            return (None, None, None, None);
        };
        let needs_sample = state.1.is_none_or(|last| last.elapsed().as_secs() > 10);
        state.0.refresh_cpu_usage();
        if needs_sample {
            std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
            state.0.refresh_cpu_usage();
        }
        state.1 = Some(Instant::now());
        state.0.refresh_memory();
        let cpu = state.0.global_cpu_usage();
        let cpu = (!state.0.cpus().is_empty() && cpu.is_finite()).then_some(f64::from(cpu));
        let memory = capacity(
            state.0.total_memory(),
            state.0.total_memory().saturating_sub(state.0.used_memory()),
        );
        // Pick the filesystem containing HOME (the APFS data volume on macOS),
        // falling back to root. Never add unrelated mounted volumes together.
        let home = std::env::var_os("HOME")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| "/".into());
        let home = home.canonicalize().unwrap_or(home);
        let disks = Disks::new_with_refreshed_list();
        let selected = disks
            .iter()
            .filter(|disk| home.starts_with(disk.mount_point()))
            .max_by_key(|disk| disk.mount_point().components().count());
        // APFS exposes /Users through a firmlink; the data filesystem's mount
        // point is not a textual prefix of that logical home path.
        #[cfg(target_os = "macos")]
        let selected = if home.starts_with("/Users") {
            disks
                .iter()
                .find(|disk| disk.mount_point() == std::path::Path::new("/System/Volumes/Data"))
                .or(selected)
        } else {
            selected
        };
        let disk = selected.and_then(|disk| {
            capacity(disk.total_space(), disk.available_space())
                .map(|value| (disk.mount_point().to_string_lossy().into_owned(), value))
        });
        (cpu, memory, disk, Some(System::uptime()))
    }
}

#[cfg(target_os = "windows")]
mod windows {
    use super::{capacity, CpuTimes};
    use std::{
        mem,
        path::{Component, Path, Prefix},
        sync::{Mutex, OnceLock},
        time::{Duration, Instant},
    };

    #[repr(C)]
    #[derive(Default)]
    struct FileTime {
        low: u32,
        high: u32,
    }
    impl FileTime {
        fn ticks(&self) -> u64 {
            (u64::from(self.high) << 32) | u64::from(self.low)
        }
    }

    #[repr(C)]
    struct MemoryStatusEx {
        length: u32,
        load: u32,
        total_phys: u64,
        avail_phys: u64,
        total_page_file: u64,
        avail_page_file: u64,
        total_virtual: u64,
        avail_virtual: u64,
        avail_ext_virtual: u64,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GetSystemTimes(idle: *mut FileTime, kernel: *mut FileTime, user: *mut FileTime) -> i32;
        fn GlobalMemoryStatusEx(memory: *mut MemoryStatusEx) -> i32;
        fn GetWindowsDirectoryW(buffer: *mut u16, size: u32) -> u32;
        fn GetDiskFreeSpaceExW(
            directory: *const u16,
            available: *mut u64,
            total: *mut u64,
            free: *mut u64,
        ) -> i32;
        fn GetTickCount64() -> u64;
    }

    fn cpu_times() -> Option<CpuTimes> {
        let (mut idle, mut kernel, mut user) = (
            FileTime::default(),
            FileTime::default(),
            FileTime::default(),
        );
        // The three output structs are valid writable FILETIME allocations.
        if unsafe { GetSystemTimes(&mut idle, &mut kernel, &mut user) } == 0 {
            return None;
        }
        Some(CpuTimes {
            idle: idle.ticks(),
            kernel: kernel.ticks(),
            user: user.ticks(),
        })
    }

    pub(super) fn cpu_usage() -> Option<f64> {
        static PREVIOUS: OnceLock<Mutex<Option<(Instant, CpuTimes)>>> = OnceLock::new();
        let mut previous = PREVIOUS.get_or_init(|| Mutex::new(None)).lock().ok()?;
        let mut current = cpu_times()?;
        let mut now = Instant::now();
        // After leaving Settings or suspending the PC, take a fresh sample
        // instead of reporting an average over the whole inactive interval.
        let (started, baseline) = previous
            .filter(|(started, _)| now.duration_since(*started) <= Duration::from_secs(10))
            .unwrap_or((now, current));
        let minimum = Duration::from_millis(250);
        if now.duration_since(started) < minimum {
            // This collector runs on Tauri's blocking pool, never its UI thread.
            std::thread::sleep(minimum - now.duration_since(started));
            current = cpu_times()?;
            now = Instant::now();
        }
        *previous = Some((now, current));
        current.usage_since(baseline)
    }

    pub(super) fn memory() -> Option<(u64, u64, f64)> {
        // All-zero bytes are valid for this C integer-only structure.
        let mut status: MemoryStatusEx = unsafe { mem::zeroed() };
        status.length = mem::size_of::<MemoryStatusEx>() as u32;
        if unsafe { GlobalMemoryStatusEx(&mut status) } == 0 {
            return None;
        }
        capacity(status.total_phys, status.avail_phys)
    }

    pub(super) fn disk() -> Option<(String, (u64, u64, f64))> {
        let mut buffer = vec![0u16; 32768];
        let length =
            unsafe { GetWindowsDirectoryW(buffer.as_mut_ptr(), buffer.len() as u32) } as usize;
        if length == 0 || length >= buffer.len() {
            return None;
        }
        let windows = String::from_utf16(&buffer[..length]).ok()?;
        let Component::Prefix(prefix) = Path::new(&windows).components().next()? else {
            return None;
        };
        let drive = match prefix.kind() {
            Prefix::Disk(drive) | Prefix::VerbatimDisk(drive) => drive,
            _ => return None,
        };
        let path = format!("{}:\\", char::from(drive));
        let wide: Vec<u16> = path.encode_utf16().chain(Some(0)).collect();
        let (mut available, mut total) = (0, 0);
        // NUL-terminated path and valid u64 outputs; final optional output is unused.
        if unsafe {
            GetDiskFreeSpaceExW(
                wide.as_ptr(),
                &mut available,
                &mut total,
                std::ptr::null_mut(),
            )
        } == 0
        {
            return None;
        }
        Some((path, capacity(total, available)?))
    }

    pub(super) fn uptime() -> u64 {
        (unsafe { GetTickCount64() }) / 1000
    }
}
