use super::*;

#[test]
fn followup_effort_survives_request_and_task_input() {
    let request: NewSessionMessage =
        serde_json::from_value(json!({"text":"继续","reasoning_effort":"minimal"})).unwrap();
    let input = session_input(
        request.text,
        request.permission_profile,
        request.reasoning_effort.as_deref(),
        request.images,
        request.files,
        "unused",
    )
    .map_err(|e| e.0)
    .unwrap();
    assert_eq!(input["reasoning_effort"], "minimal");
    let legacy: NewSessionMessage = serde_json::from_value(json!({"text":"hello"})).unwrap();
    assert!(legacy.reasoning_effort.is_none());
}
