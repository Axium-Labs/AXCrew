//! Pure domain models.
//!
//! Nothing here knows about SQLite, HTTP, tokio or AX: these types only describe
//! the data AXCrew reasons about, so any layer (API, orchestration, storage) may
//! depend on them without pulling a storage or transport detail along.

pub mod automation;
pub mod crew;
pub mod device;
pub mod session;
pub mod task;

/// Seconds since the Unix epoch, or `0` for clocks before it.
pub fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
