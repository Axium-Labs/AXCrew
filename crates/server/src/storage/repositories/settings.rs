//! `app_settings`: the small key/value store the desktop and phone clients share
//! for configuration that is not part of an aggregate (currently the iFlytek
//! speech credentials).

use crate::storage::Db;
use anyhow::Result;
use rusqlite::OptionalExtension;
use serde_json::{Value, json};

impl Db {
    /// 讯飞语音识别配置（桌面端写入，手机端读取）。未配置时返回 None。
    pub fn xfy_config(&self) -> Result<Option<Value>> {
        let db = self.0.lock().unwrap();
        let raw = db
            .query_row(
                "SELECT value_json FROM app_settings WHERE key='xfy'",
                [],
                |r| r.get::<_, String>(0),
            )
            .optional()?;
        Ok(raw.and_then(|value| serde_json::from_str(&value).ok()))
    }
    pub fn set_xfy_config(&self, appid: &str, api_key: &str, api_secret: &str) -> Result<()> {
        let value =
            json!({"appid": appid, "api_key": api_key, "api_secret": api_secret}).to_string();
        let db = self.0.lock().unwrap();
        db.execute(
            "INSERT INTO app_settings(key, value_json) VALUES('xfy', ?1) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json",
            [&value],
        )?;
        Ok(())
    }
}
