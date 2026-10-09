//! Token-usage aggregation over the local AX stores.
//!
//! Purely a read-side projection: it walks the same transcripts `ax::transcript`
//! replays and sums the usage AX already recorded, so Crew never stores or
//! estimates token counts of its own.

use anyhow::Result;
use serde_json::{Value, json};
use std::{
    collections::HashSet,
    fs,
    io::{BufRead, BufReader},
};

#[derive(Default, serde::Serialize)]
struct Counts {
    input: u64,
    output: u64,
    cached: u64,
    messages: u64,
    tools: u64,
    skills: u64,
    unreported: u64,
}
impl Counts {
    fn add(&mut self, other: &Self) {
        self.input += other.input;
        self.output += other.output;
        self.cached += other.cached;
        self.messages += other.messages;
        self.tools += other.tools;
        self.skills += other.skills;
        self.unreported += other.unreported;
    }
}
fn count_message(message: &Value) -> Counts {
    let mut counts = Counts::default();
    match message["role"].as_str() {
        Some("user") => counts.messages = 1,
        Some("tool") => counts.tools = 1,
        Some("system")
            if message["content"]
                .as_str()
                .unwrap_or("")
                .starts_with("[ax-skill:") =>
        {
            counts.skills = 1
        }
        Some("assistant") => {
            let usage = &message["metadata"]["usage"]["reported"];
            let input = usage["input_tokens"]
                .as_u64()
                .or_else(|| usage["prompt_tokens"].as_u64());
            let output = usage["output_tokens"]
                .as_u64()
                .or_else(|| usage["completion_tokens"].as_u64());
            if let (Some(input), Some(output)) = (input, output) {
                counts.input = input;
                counts.output = output;
                counts.cached = usage
                    .pointer("/input_tokens_details/cached_tokens")
                    .or_else(|| usage.pointer("/prompt_tokens_details/cached_tokens"))
                    .and_then(Value::as_u64)
                    .unwrap_or(0);
            } else {
                counts.unreported = 1;
            }
        }
        _ => {}
    }
    counts
}
/// What could not be counted, as `{code, count}` so each client words it in its
/// own language; empty when everything was read.
fn usage_warnings(projects: usize, sessions: usize, lines: usize) -> Vec<Value> {
    [
        ("unreadable_projects", projects),
        ("unreadable_sessions", sessions),
        ("damaged_lines", lines),
    ]
    .into_iter()
    .filter(|(_, count)| *count > 0)
    .map(|(code, count)| json!({"code": code, "count": count}))
    .collect()
}
/// Aggregates reported local history. Cached tokens are a subset of input, never added twice.
pub fn usage(days: i64, offset: i64, crew: &HashSet<String>) -> Result<Value> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?
        .as_secs() as i64;
    let today = (now - offset * 60).div_euclid(86400);
    let start = today - days + 1;
    let mut totals = Counts::default();
    let mut daily = std::collections::BTreeMap::<(i64, String, String), Counts>::new();
    let mut ranking = Vec::new();
    // Problems are counted and reported as one readable sentence each; raw
    // OS/JSON errors and session IDs mean nothing to the person reading Usage.
    let (mut unreadable_projects, mut unreadable, mut damaged) = (0_usize, 0_usize, 0_usize);
    for project in super::projects() {
        let sessions = match super::sessions(&project) {
            Ok(s) => s,
            Err(_) => {
                unreadable_projects += 1;
                continue;
            }
        };
        for session in sessions {
            let id = session["id"].as_str().unwrap_or("");
            if (session["updated_at"].as_i64().unwrap_or(0) - offset * 60).div_euclid(86400) < start
            {
                continue;
            }
            let file = match fs::File::open(super::transcript_path(&project, id)) {
                Ok(file) => file,
                // An indexed session whose history was never written or was
                // removed simply has no reported usage; it is not an error.
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
                Err(_) => {
                    unreadable += 1;
                    continue;
                }
            };
            let client = if crew.contains(id) { "AX Crew" } else { "AX" }.to_owned();
            let mut sum = Counts::default();
            let mut last_model = "Unreported".to_owned();
            let mut messages = Vec::<Value>::new();
            for line in BufReader::new(file).lines() {
                match line.and_then(|s| serde_json::from_str(&s).map_err(std::io::Error::other)) {
                    Ok(message) => messages.push(message),
                    Err(_) => damaged += 1,
                }
            }
            let mut turn_model = "Unreported".to_owned();
            for (index, message) in messages.iter().enumerate() {
                if message["role"] == "user" {
                    turn_model = messages[index + 1..]
                        .iter()
                        .take_while(|row| row["role"] != "user")
                        .find_map(|row| {
                            row.pointer("/metadata/usage/model").and_then(Value::as_str)
                        })
                        .unwrap_or("Unreported")
                        .to_owned();
                }
                let day =
                    (message["created_at"].as_i64().unwrap_or(0) - offset * 60).div_euclid(86400);
                if let Some(model) = message
                    .pointer("/metadata/usage/model")
                    .and_then(Value::as_str)
                {
                    last_model = model.to_owned();
                }
                if day < start || day > today {
                    continue;
                }
                let counts = count_message(message);
                // Associate user/tool rows only with a model actually reported in that turn.
                let model = message
                    .pointer("/metadata/usage/model")
                    .and_then(Value::as_str)
                    .unwrap_or(&turn_model)
                    .to_owned();
                daily
                    .entry((day, model, client.clone()))
                    .or_default()
                    .add(&counts);
                totals.add(&counts);
                sum.add(&counts);
            }
            if sum.input + sum.output + sum.messages + sum.tools + sum.skills + sum.unreported > 0 {
                ranking.push(json!({"id":id,"title":session["title"],"model":last_model,"client":client,"counts":sum}));
            }
        }
    }
    ranking.sort_by_key(|v| {
        std::cmp::Reverse(
            v["counts"]["input"].as_u64().unwrap_or(0)
                + v["counts"]["output"].as_u64().unwrap_or(0),
        )
    });
    let daily = daily.into_iter().map(|((day,model,client),counts)|json!({"day":day,"model":model,"client":client,"counts":counts})).collect::<Vec<_>>();
    let warnings = usage_warnings(unreadable_projects, unreadable, damaged);
    Ok(
        json!({"days":days,"start":start,"today":today,"totals":totals,"daily":daily,"ranking":ranking,"warnings":warnings}),
    )
}

#[cfg(test)]
mod tests {
    #[test]
    fn warnings_are_codes_without_raw_errors_or_session_ids() {
        assert!(super::usage_warnings(0, 0, 0).is_empty());
        let warnings = super::usage_warnings(1, 0, 3);
        assert_eq!(
            warnings,
            vec![
                serde_json::json!({"code":"unreadable_projects","count":1}),
                serde_json::json!({"code":"damaged_lines","count":3}),
            ]
        );
    }
    #[test]
    fn usage_counts_reported_tokens_and_keeps_cache_inside_input() {
        let row = serde_json::json!({"role":"assistant","metadata":{"usage":{"reported":{"prompt_tokens":100,"completion_tokens":20,"prompt_tokens_details":{"cached_tokens":80}}}}});
        let count = super::count_message(&row);
        assert_eq!(
            (count.input, count.output, count.cached, count.unreported),
            (100, 20, 80, 0)
        );
        assert_eq!(
            super::count_message(&serde_json::json!({"role":"assistant"})).unreported,
            1
        );
        assert_eq!(
            super::count_message(&serde_json::json!({"role":"user"})).messages,
            1
        );
    }
}
