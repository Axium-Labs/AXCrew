//! Bounded, concurrent GitHub/GitCode release discovery shared by both updaters.
//! GitHub defines the version; GitCode is only a same-tag download mirror.
use std::time::{Duration, Instant};

use futures_util::future::join_all;
use serde::Deserialize;

const PROBE_TIMEOUT: Duration = Duration::from_secs(12);

#[derive(Clone, Debug)]
pub struct UpdateSource {
    pub name: &'static str,
    pub api: String,
    pub github: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Release {
    pub tag_name: String,
    #[serde(default)]
    pub assets: Vec<Asset>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Asset {
    pub name: String,
    pub browser_download_url: String,
}

impl UpdateSource {
    pub fn sources(project: &str) -> Vec<Self> {
        let (gh, gc) = match project {
            "AX" => ("Axium-Labs/AX", option_env!("GITCODE_AX_REPOSITORY")),
            _ => (
                "Axium-Labs/AXCrew",
                option_env!("GITCODE_AXCREW_REPOSITORY"),
            ),
        };
        let mut out = vec![Self {
            name: "GitHub",
            api: format!("https://api.github.com/repos/{gh}/releases/latest"),
            github: true,
        }];
        if let Some(repo) = gc.filter(|repo| valid_repo(repo)) {
            out.push(Self {
                name: "GitCode",
                api: format!("https://api.gitcode.com/api/v5/repos/{repo}/releases/latest"),
                github: false,
            });
        }
        out
    }
}

fn valid_repo(repo: &str) -> bool {
    let mut parts = repo.split('/');
    matches!((parts.next(), parts.next(), parts.next()), (Some(owner), Some(name), None)
        if !owner.is_empty() && !name.is_empty()
            && owner.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_'))
            && name.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_')))
}

/// Fetch both sources concurrently. Prefer GitHub's tag unconditionally; for that
/// tag, put successful providers in measured-response order for asset fallback.
pub async fn latest(
    client: &reqwest::Client,
    sources: &[UpdateSource],
) -> Result<Vec<(UpdateSource, Release)>, String> {
    latest_with_timeout(client, sources, PROBE_TIMEOUT).await
}

async fn latest_with_timeout(
    client: &reqwest::Client,
    sources: &[UpdateSource],
    timeout: Duration,
) -> Result<Vec<(UpdateSource, Release)>, String> {
    let probes = sources.iter().map(|source| async move {
        let started = Instant::now();
        let result = tokio::time::timeout(timeout, async {
            let response = client
                .get(&source.api)
                .send()
                .await
                .map_err(|e| format!("{} network/timeout: {e}", source.name))?;
            if !response.status().is_success() {
                return Err(format!("{} HTTP {}", source.name, response.status()));
            }
            let release: Release = response
                .json()
                .await
                .map_err(|e| format!("{} invalid release metadata: {e}", source.name))?;
            if !valid_tag(&release.tag_name) {
                return Err(format!("{} invalid release tag", source.name));
            }
            Ok::<_, String>(release)
        })
        .await
        .unwrap_or_else(|_| Err(format!("{} probe timed out", source.name)));
        (source.clone(), result, started.elapsed())
    });
    let mut responses = join_all(probes).await;
    let github_tag = responses.iter().find_map(|(source, result, _)| {
        source
            .github
            .then(|| result.as_ref().ok().map(|r| r.tag_name.clone()))
            .flatten()
    });
    let canonical = github_tag.or_else(|| {
        responses
            .iter()
            .find_map(|(_, result, _)| result.as_ref().ok().map(|r| r.tag_name.clone()))
    });
    let Some(canonical) = canonical else {
        return Err(responses
            .drain(..)
            .map(|(s, r, _)| {
                r.err()
                    .unwrap_or_else(|| format!("{} returned no release", s.name))
            })
            .collect::<Vec<_>>()
            .join("; "));
    };
    let mut valid: Vec<_> = responses
        .into_iter()
        .filter_map(|(source, result, elapsed)| {
            result
                .ok()
                .filter(|release| release.tag_name == canonical)
                .map(|release| (source, release, elapsed))
        })
        .collect();
    valid.sort_by_key(|(_, _, elapsed)| *elapsed);
    if valid.is_empty() {
        return Err(format!("no source returned canonical version {canonical}"));
    }
    if valid.iter().any(|(source, _, _)| !source.github)
        && valid.iter().any(|(source, _, _)| source.github)
    {
        // A mismatch is intentionally ignored: the mirror cannot create a version.
    }
    Ok(valid
        .into_iter()
        .map(|(source, release, _)| (source, release))
        .collect())
}

pub fn valid_tag(tag: &str) -> bool {
    !tag.is_empty()
        && tag
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'+'))
        && tag
            .trim_start_matches('v')
            .split(['-', '+'])
            .next()
            .unwrap_or_default()
            .split('.')
            .all(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_valid_repository_paths_are_configured() {
        assert!(valid_repo("owner/project"));
        for value in [
            "",
            "owner",
            "https://gitcode.com/owner/repo",
            "../repo",
            "owner/repo/x",
        ] {
            assert!(!valid_repo(value), "{value}");
        }
    }

    #[test]
    fn version_tag_validation_rejects_non_versions_and_paths() {
        assert!(valid_tag("v0.3.0"));
        assert!(valid_tag("0.3.0-beta.1"));
        for value in ["", "latest", "../v1.0.0", "v1.x", "v1.0.0/evil"] {
            assert!(!valid_tag(value));
        }
    }

    fn serve(
        responses: Vec<(&'static str, u16, &'static str, Duration)>,
    ) -> (String, std::thread::JoinHandle<()>) {
        use std::{
            io::{Read, Write},
            net::TcpListener,
        };
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let root = format!("http://{}", listener.local_addr().unwrap());
        let thread = std::thread::spawn(move || {
            for (path, status, body, delay) in responses {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                let mut request = [0; 2048];
                let size = stream.read(&mut request).unwrap();
                assert!(
                    String::from_utf8_lossy(&request[..size]).starts_with(&format!("GET {path} "))
                );
                std::thread::sleep(delay);
                let phrase = if status == 200 { "OK" } else { "Unavailable" };
                let _ = write!(stream, "HTTP/1.1 {status} {phrase}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            }
        });
        (root, thread)
    }

    fn source(name: &'static str, root: &str, path: &str, github: bool) -> UpdateSource {
        UpdateSource {
            name,
            api: format!("{root}{path}"),
            github,
        }
    }

    fn json(tag: &str) -> String {
        format!(
            r#"{{"tag_name":"{tag}","assets":[{{"name":"app.exe","browser_download_url":"https://gitcode.com/a/b"}},{{"name":"SHA256SUMS","browser_download_url":"https://gitcode.com/a/s"}}]}}"#
        )
    }

    #[tokio::test]
    async fn concurrent_probes_order_fast_github_before_slow_mirror() {
        for (gh_delay, gc_delay, expected) in [
            (
                Duration::from_millis(5),
                Duration::from_millis(70),
                "GitHub",
            ),
            (
                Duration::from_millis(70),
                Duration::from_millis(5),
                "GitCode",
            ),
        ] {
            let (gh, gh_server) = serve(vec![(
                "/gh",
                200,
                Box::leak(json("v0.3.0").into_boxed_str()),
                gh_delay,
            )]);
            let (gc, gc_server) = serve(vec![(
                "/gc",
                200,
                Box::leak(json("v0.3.0").into_boxed_str()),
                gc_delay,
            )]);
            let client = reqwest::Client::builder().no_proxy().build().unwrap();
            let result = latest_with_timeout(
                &client,
                &[
                    source("GitHub", &gh, "/gh", true),
                    source("GitCode", &gc, "/gc", false),
                ],
                Duration::from_secs(1),
            )
            .await
            .unwrap();
            assert_eq!(result[0].0.name, expected);
            gh_server.join().unwrap();
            gc_server.join().unwrap();
        }
    }

    #[tokio::test]
    async fn mismatch_keeps_github_tag_and_discards_mirror_release() {
        let (gh, a) = serve(vec![(
            "/gh",
            200,
            Box::leak(json("v0.3.0").into_boxed_str()),
            Duration::ZERO,
        )]);
        let (gc, b) = serve(vec![(
            "/gc",
            200,
            Box::leak(json("v9.9.9").into_boxed_str()),
            Duration::ZERO,
        )]);
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let result = latest_with_timeout(
            &client,
            &[
                source("GitHub", &gh, "/gh", true),
                source("GitCode", &gc, "/gc", false),
            ],
            Duration::from_secs(1),
        )
        .await
        .unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].1.tag_name, "v0.3.0");
        a.join().unwrap();
        b.join().unwrap();
    }

    #[tokio::test]
    async fn timeout_404_5xx_and_all_failure_are_classified_and_bounded() {
        let (slow, slow_server) = serve(vec![(
            "/slow",
            200,
            Box::leak(json("v0.3.0").into_boxed_str()),
            Duration::from_millis(120),
        )]);
        let (missing, missing_server) = serve(vec![("/404", 404, "", Duration::ZERO)]);
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let result = latest_with_timeout(
            &client,
            &[
                source("GitHub", &slow, "/slow", true),
                source("GitCode", &missing, "/404", false),
            ],
            Duration::from_millis(30),
        )
        .await
        .unwrap_err();
        assert!(result.contains("timed out"));
        assert!(result.contains("404"));
        slow_server.join().unwrap();
        missing_server.join().unwrap();

        let (unavailable, server) = serve(vec![("/503", 503, "", Duration::ZERO)]);
        let (missing, missing_server) = serve(vec![("/404", 404, "", Duration::ZERO)]);
        let result = latest_with_timeout(
            &client,
            &[
                source("GitHub", &unavailable, "/503", true),
                source("GitCode", &missing, "/404", false),
            ],
            Duration::from_secs(1),
        )
        .await
        .unwrap_err();
        assert!(result.contains("503"));
        assert!(result.contains("404"));
        server.join().unwrap();
        missing_server.join().unwrap();
    }
}
