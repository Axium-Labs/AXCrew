//! LAN phone credentials cannot administer gateway trust or provider secrets.
pub fn allowed(method: &str, path: &str) -> bool {
    let path = path.split('?').next().unwrap_or("");
    if path.contains('%')
        || path.contains('\\')
        || path.contains("..")
        || !path.starts_with("/api/")
    {
        return false;
    }
    let p: Vec<_> = path.trim_start_matches('/').split('/').collect();
    matches!(
        (method, p.as_slice()),
        (
            "GET",
            [
                "api",
                "settings"
                    | "devices"
                    | "crews"
                    | "tasks"
                    | "sessions"
                    | "permissions"
                    | "automations"
                    | "events"
                    | "projects"
                    | "usage",
            ],
        ) | ("GET", ["api", "devices", _, "capabilities"])
            | ("GET", ["api", "crews", _, "members"])
            | ("GET", ["api", "sessions", _, "history"])
            | ("GET", ["api", "tasks" | "sessions", _])
            | ("GET", ["api", "automations", "runs"])
            | ("GET", ["api", "ax", "local"])
            | ("GET", ["api", "ax", "local", _])
            | ("POST", ["api", "sessions" | "tasks" | "automations"])
            | ("POST", ["api", "sessions", "attach"])
            | ("POST", ["api", "sessions", _, "message" | "answer"])
            | ("POST", ["api", "tasks", _, "start" | "cancel" | "retry"])
            | ("POST", ["api", "permissions", _, "resolve"])
            | ("POST", ["api", "automations", _, "run" | "toggle"])
            | ("POST", ["api", "environments", _, "model"])
            | ("POST", ["api", "devices", _, "rename"])
            | ("PUT", ["api", "automations", _])
            | ("DELETE", ["api", "automations" | "sessions", _])
            | ("DELETE", ["api", "ax", "local", _])
    )
}
