//! Pairing and device authorisation.
//!
//! Two independent flows share this module because both are "prove you may talk
//! to this gateway":
//! * AX runtimes redeem a one-time pairing code and then authenticate with
//!   Ed25519 (`crate::gateway`); only the public key is stored here.
//! * Phone control clients redeem a short-lived code, wait for a desktop
//!   confirmation, and then receive a long-lived credential that is stored
//!   hashed.

use crate::{
    domain::device::{AuthorizedClient, ClientPairingInfo, ClientRedeem, Device, PairingRequest},
    domain::unix_now,
    storage::Db,
    storage::repositories::devices::device,
};
use anyhow::{Result, anyhow};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use rand::RngCore;
use rusqlite::{OptionalExtension, params};
use sha2::{Digest, Sha256};
use uuid::Uuid;

impl Db {
    pub fn issue_pairing(&self) -> Result<String> {
        let mut bytes = [0u8; 24];
        rand::rngs::OsRng.fill_bytes(&mut bytes);
        let code = URL_SAFE_NO_PAD.encode(bytes);
        let hash = format!("{:x}", Sha256::digest(code.as_bytes()));
        self.0.lock().unwrap().execute(
            "INSERT INTO pairings(code_hash,expires_at) VALUES(?1,unixepoch()+600)",
            [hash],
        )?;
        Ok(code)
    }
    pub fn redeem_pairing(&self, request: &PairingRequest) -> Result<Device> {
        let hash = format!("{:x}", Sha256::digest(request.code.as_bytes()));
        let mut db = self.0.lock().unwrap();
        let tx = db.transaction()?;
        let changed=tx.execute("UPDATE pairings SET used_at=unixepoch() WHERE code_hash=?1 AND used_at IS NULL AND expires_at>unixepoch()",[hash])?;
        if changed != 1 {
            return Err(anyhow!("pairing code invalid, expired, or already used"));
        }
        let id = Uuid::new_v4().to_string();
        tx.execute("INSERT INTO devices(id,name,hostname,platform,arch,ax_version,protocol_version,capabilities_json,status,last_seen,public_key) VALUES(?1,?2,?3,?4,?5,?6,1,'{}','offline',unixepoch(),?7)",params![id,request.name,request.hostname,request.platform,request.arch,request.ax_version,request.public_key])?;
        let result = device(&tx, &id)?.ok_or_else(|| anyhow!("paired device missing"))?;
        tx.commit()?;
        Ok(result)
    }
    // ---- 手机设备配对与授权：临时配对码 → 桌面确认 → 设备授权 ----
    pub fn issue_client_pairing(&self) -> Result<ClientPairingInfo> {
        let mut bytes = [0u8; 24];
        rand::rngs::OsRng.fill_bytes(&mut bytes);
        let code = URL_SAFE_NO_PAD.encode(bytes);
        let short = {
            let alnum: String = code
                .chars()
                .filter(|c| c.is_ascii_alphanumeric())
                .take(4)
                .collect();
            format!("AX-{}", alnum.to_ascii_uppercase())
        };
        let hash = format!("{:x}", Sha256::digest(code.as_bytes()));
        self.0.lock().unwrap().execute(
            "INSERT INTO client_pairings(code_hash,expires_at) VALUES(?1,unixepoch()+300)",
            [hash],
        )?;
        Ok(ClientPairingInfo {
            code,
            short_code: short,
            expires_at: unix_now() + 300,
        })
    }
    /// 手机提交配对码：标记为待桌面确认，返回临时 device_id（配对码一次性）。
    pub fn redeem_client_pairing(
        &self,
        code: &str,
        name: &str,
        platform: &str,
    ) -> Result<ClientRedeem> {
        let hash = format!("{:x}", Sha256::digest(code.as_bytes()));
        let mut db = self.0.lock().unwrap();
        let tx = db.transaction()?;
        let device_id = Uuid::new_v4().to_string();
        let changed = tx.execute(
            "UPDATE client_pairings SET used_at=unixepoch(),device_id=?2,name=?3,platform=?4,status='pending' WHERE code_hash=?1 AND used_at IS NULL AND expires_at>unixepoch()",
            params![hash, device_id, name, platform],
        )?;
        if changed != 1 {
            return Err(anyhow!("配对码无效、已过期或已被使用"));
        }
        tx.commit()?;
        Ok(ClientRedeem {
            status: "pending".into(),
            device_id,
        })
    }
    pub fn pending_client_authorizations(&self) -> Result<Vec<AuthorizedClient>> {
        let db = self.0.lock().unwrap();
        let mut s = db.prepare("SELECT device_id,name,platform,used_at FROM client_pairings WHERE status='pending' AND expires_at>unixepoch() ORDER BY used_at")?;
        let rows = s.query_map([], |r| {
            Ok(AuthorizedClient {
                device_id: r.get(0)?,
                name: r.get(1)?,
                platform: r.get(2)?,
                status: "pending".into(),
                created_at: r.get::<_, Option<i64>>(3)?.unwrap_or(0),
                last_active: 0,
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(Into::into)
    }
    pub fn client_authorizations(&self) -> Result<Vec<AuthorizedClient>> {
        let db = self.0.lock().unwrap();
        let mut s = db.prepare("SELECT device_id,name,platform,created_at,last_active FROM client_authorizations WHERE revoked_at IS NULL ORDER BY created_at")?;
        let rows = s.query_map([], |r| {
            Ok(AuthorizedClient {
                device_id: r.get(0)?,
                name: r.get(1)?,
                platform: r.get(2)?,
                status: "authorized".into(),
                created_at: r.get(3)?,
                last_active: r.get(4)?,
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(Into::into)
    }
    /// 桌面端允许：生成设备长期凭证（明文一次性下发，哈希持久化），写入授权表。
    pub fn confirm_client_device(&self, device_id: &str) -> Result<String> {
        let mut bytes = [0u8; 24];
        rand::rngs::OsRng.fill_bytes(&mut bytes);
        let credential = URL_SAFE_NO_PAD.encode(bytes);
        let hash = format!("{:x}", Sha256::digest(credential.as_bytes()));
        let mut db = self.0.lock().unwrap();
        let tx = db.transaction()?;
        let changed = tx.execute(
            "UPDATE client_pairings SET status='confirmed',credential_pending=?2 WHERE device_id=?1 AND status='pending'",
            params![device_id, credential],
        )?;
        if changed != 1 {
            return Err(anyhow!("授权请求不存在或已处理"));
        }
        let row: (String, String, i64) = tx.query_row(
            "SELECT name,platform,used_at FROM client_pairings WHERE device_id=?1",
            [device_id],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get::<_, Option<i64>>(2)?.unwrap_or(0),
                ))
            },
        )?;
        tx.execute(
            "INSERT OR REPLACE INTO client_authorizations(device_id,name,platform,credential_hash,created_at,last_active) VALUES(?1,?2,?3,?4,?5,unixepoch())",
            params![device_id, row.0, row.1, hash, row.2],
        )?;
        tx.commit()?;
        Ok(credential)
    }
    pub fn deny_client_device(&self, device_id: &str) -> Result<()> {
        let changed = self.0.lock().unwrap().execute(
            "UPDATE client_pairings SET status='denied' WHERE device_id=?1 AND status='pending'",
            [device_id],
        )?;
        if changed == 0 {
            return Err(anyhow!("授权请求不存在或已处理"));
        }
        Ok(())
    }
    /// 手机轮询领取：confirmed → 返回一次性凭证；pending → None（继续等）；denied/过期 → Err。
    pub fn claim_client_credential(&self, code: &str) -> Result<Option<String>> {
        let hash = format!("{:x}", Sha256::digest(code.as_bytes()));
        let db = self.0.lock().unwrap();
        let row: Option<(String, Option<String>, i64)> = db
            .query_row(
                "SELECT status,credential_pending,expires_at FROM client_pairings WHERE code_hash=?1",
                [&hash],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?;
        match row {
            None => Err(anyhow!("配对码已失效，请刷新后重新扫码")),
            Some((_, _, expires)) if expires <= unix_now() => {
                Err(anyhow!("配对码已过期，请刷新后重新扫码"))
            }
            Some((status, _, _)) if status == "denied" => Err(anyhow!("配对请求已被拒绝")),
            Some((_, pending, _)) => {
                if let Some(credential) = pending {
                    db.execute("DELETE FROM client_pairings WHERE code_hash=?1", [&hash])?;
                    Ok(Some(credential))
                } else {
                    Ok(None)
                }
            }
        }
    }
    /// 校验设备凭证（哈希、未撤销），返回 device_id 供 touch。
    pub fn credential_device(&self, given: &str) -> Option<String> {
        let hash = format!("{:x}", Sha256::digest(given.as_bytes()));
        let db = self.0.lock().unwrap();
        db.query_row(
            "SELECT device_id FROM client_authorizations WHERE credential_hash=?1 AND revoked_at IS NULL",
            [hash],
            |r| r.get(0),
        )
        .optional()
        .ok()
        .flatten()
    }
    pub fn touch_client(&self, device_id: &str) {
        let _ = self.0.lock().unwrap().execute(
            "UPDATE client_authorizations SET last_active=unixepoch() WHERE device_id=?1",
            [device_id],
        );
    }
    pub fn has_client_authorization(&self) -> bool {
        let db = self.0.lock().unwrap();
        db.query_row(
            "SELECT 1 FROM client_authorizations WHERE revoked_at IS NULL LIMIT 1",
            [],
            |_| Ok(()),
        )
        .optional()
        .is_ok_and(|row| row.is_some())
    }
    pub fn revoke_client_authorization(&self, device_id: &str) -> Result<()> {
        let changed = self
            .0
            .lock()
            .unwrap()
            .execute(
                "UPDATE client_authorizations SET revoked_at=unixepoch() WHERE device_id=?1 AND revoked_at IS NULL",
                [device_id],
            )?;
        if changed == 0 {
            return Err(anyhow!("设备不存在或未授权"));
        }
        Ok(())
    }
}
