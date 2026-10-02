//! Crew and member business rules.
//!
//! Only the checks that need no database access live here; the API layer runs
//! them before handing a payload to storage. Checks that must read other rows
//! (does the crew exist, does the device exist, does this member already own
//! sessions) stay inside the storage transaction that performs the write, so they
//! cannot race with it.

use crate::domain::crew::{NewCrew, NewMember};
use anyhow::{Result, anyhow};
use serde_json::Value;

/// Rejects an unnamed crew.
pub fn validate_new_crew(body: &NewCrew) -> Result<()> {
    if body.name.trim().is_empty() {
        return Err(anyhow!("crew name required"));
    }
    Ok(())
}

/// Rejects a member whose concurrency, permission profile or capability lists
/// cannot be stored.
pub fn validate_new_member(body: &NewMember) -> Result<()> {
    if body.max_concurrency < 1 {
        return Err(anyhow!("max_concurrency must be positive"));
    }
    if !matches!(body.permission_profile.as_str(), "ask" | "allow" | "deny") {
        return Err(anyhow!("permission_profile must be ask, allow, or deny"));
    }
    for (field, value) in [("skills", &body.skills), ("mcp_servers", &body.mcp_servers)] {
        if !value
            .as_array()
            .is_some_and(|list| list.iter().all(Value::is_string))
        {
            return Err(anyhow!("{field} must be an array of names"));
        }
    }
    Ok(())
}

/// The same constraints as [`validate_new_member`], reported as one error because
/// the edit endpoint has always answered with a single message.
pub fn validate_member_update(body: &NewMember) -> Result<()> {
    if body.name.trim().is_empty()
        || body.max_concurrency < 1
        || !matches!(body.permission_profile.as_str(), "ask" | "allow" | "deny")
        || ![&body.skills, &body.mcp_servers]
            .iter()
            .all(|v| v.as_array().is_some_and(|a| a.iter().all(Value::is_string)))
    {
        return Err(anyhow!("invalid member configuration"));
    }
    Ok(())
}
