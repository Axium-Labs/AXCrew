use super::AxModel;

#[test]
fn desktop_bridge_preserves_provider_efforts_and_defaults() {
    let model: AxModel = serde_json::from_value(serde_json::json!({
        "provider":"vendor","id":"model","display_name":"Model",
        "reasoning_efforts":["minimal","high","ultra"],"default_reasoning_effort":"high"
    }))
    .unwrap();
    let value = serde_json::to_value(model).unwrap();
    assert_eq!(
        value["reasoning_efforts"],
        serde_json::json!(["minimal", "high", "ultra"])
    );
    assert_eq!(value["default_reasoning_effort"], "high");
    let legacy: AxModel = serde_json::from_value(
        serde_json::json!({"provider":"vendor","id":"model","display_name":"Model"}),
    )
    .unwrap();
    assert!(legacy.reasoning_efforts.is_empty());
}
