//! Automations: the persisted schedule definition plus the pure wall-clock maths
//! that decides when a schedule fires next. No database or runtime dependency —
//! the scheduler in `crate::orchestration` is the only caller.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Automation {
    pub id: String,
    pub name: String,
    pub message: String,
    pub schedule_kind: String,
    pub interval_minutes: i64,
    pub daily_time: String,
    pub weekdays: String,
    pub utc_offset_minutes: i64,
    pub member_id: Option<String>,
    pub model: Option<String>,
    pub approval: String,
    pub silent: bool,
    pub strict_schedule: bool,
    pub hide_from_chat: bool,
    pub lean_context: bool,
    pub folder: Option<String>,
    pub enabled: bool,
    pub created_at: i64,
    pub last_run_at: Option<i64>,
    pub next_run_at: Option<i64>,
    pub run_count: i64,
    pub last_status: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct NewAutomation {
    pub name: String,
    pub message: String,
    #[serde(default = "schedule_kind")]
    pub schedule_kind: String,
    #[serde(default = "sixty")]
    pub interval_minutes: i64,
    #[serde(default = "morning")]
    pub daily_time: String,
    #[serde(default)]
    pub weekdays: String,
    #[serde(default = "utc_eight")]
    pub utc_offset_minutes: i64,
    #[serde(default)]
    pub member_id: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default = "approval")]
    pub approval: String,
    #[serde(default)]
    pub silent: bool,
    #[serde(default)]
    pub strict_schedule: bool,
    #[serde(default)]
    pub hide_from_chat: bool,
    #[serde(default)]
    pub lean_context: bool,
    #[serde(default)]
    pub folder: Option<String>,
    #[serde(default = "enabled")]
    pub enabled: bool,
}

fn sixty() -> i64 {
    60
}
fn utc_eight() -> i64 {
    480
}
fn schedule_kind() -> String {
    "interval".into()
}
fn morning() -> String {
    "09:00".into()
}
fn approval() -> String {
    "default".into()
}
fn enabled() -> bool {
    true
}

/// Wall-clock weekday of a Unix day, Monday = 1 … Sunday = 7.
pub fn weekday_of(local_day: i64) -> i64 {
    (local_day + 3).rem_euclid(7) + 1
}

/// Next trigger in Unix seconds for a local-time schedule.
pub fn next_run(
    kind: &str,
    interval_minutes: i64,
    daily_time: &str,
    weekdays: &str,
    utc_offset_minutes: i64,
    from: i64,
) -> i64 {
    if kind != "daily" && kind != "weekly" {
        return from + interval_minutes.max(1) * 60;
    }
    let (hour, minute) = daily_time
        .split_once(':')
        .and_then(|(hour, minute)| Some((hour.parse::<i64>().ok()?, minute.parse::<i64>().ok()?)))
        .unwrap_or((9, 0));
    let allowed = weekdays
        .split(',')
        .filter_map(|day| day.trim().parse::<i64>().ok())
        .collect::<Vec<_>>();
    let offset = utc_offset_minutes * 60;
    let local = from + offset;
    let target = hour.clamp(0, 23) * 3600 + minute.clamp(0, 59) * 60;
    for step in 0..9 {
        let day = local.div_euclid(86400) + step;
        if kind == "weekly" && !allowed.is_empty() && !allowed.contains(&weekday_of(day)) {
            continue;
        }
        let candidate = day * 86400 + target;
        if candidate > local {
            return candidate - offset;
        }
    }
    from + 86400
}

#[cfg(test)]
mod schedule_tests {
    use super::{next_run, weekday_of};

    const OFFSET: i64 = 480;

    #[test]
    fn interval_schedules_ahead_of_the_last_run() {
        assert_eq!(
            next_run("interval", 15, "09:00", "", OFFSET, 1_000),
            1_000 + 900
        );
        assert_eq!(next_run("interval", 0, "09:00", "", OFFSET, 1_000), 1_060);
    }

    #[test]
    fn daily_lands_on_the_local_wall_clock_time() {
        let from = 1_790_237_713;
        let next = next_run("daily", 60, "09:00", "", OFFSET, from);
        assert!(next > from && next - from <= 86_400);
        assert_eq!((next + OFFSET * 60).rem_euclid(86_400), 9 * 3_600);
    }

    #[test]
    fn weekly_lands_on_an_allowed_weekday() {
        let from = 1_790_237_713;
        let next = next_run("weekly", 60, "08:45", "1", OFFSET, from);
        assert!(next > from && next - from <= 7 * 86_400);
        assert_eq!(weekday_of((next + OFFSET * 60).div_euclid(86_400)), 1);
        assert_eq!((next + OFFSET * 60).rem_euclid(86_400), 8 * 3_600 + 45 * 60);
    }

    #[test]
    fn weekdays_are_numbered_from_monday() {
        // 1970-01-01 was a Thursday.
        assert_eq!(weekday_of(0), 4);
        assert_eq!(weekday_of(4), 1);
        assert_eq!(weekday_of(3), 7);
    }
}
