//! Process configuration: the command line plus the environment variables that
//! shape startup.

use anyhow::Result;
use clap::Parser;
use std::{net::SocketAddr, path::PathBuf};

#[derive(Parser)]
pub struct Args {
    #[arg(long, default_value = "127.0.0.1:8765")]
    pub listen: SocketAddr,
    #[arg(long, default_value = "crew.sqlite3")]
    pub database: PathBuf,
    #[arg(long, default_value = "ax")]
    pub ax: PathBuf,
    #[arg(long, default_value_t = 4)]
    pub concurrency: usize,
}

impl Args {
    /// The fixed admin token, if configured.
    ///
    /// Listening beyond loopback without one would publish an unauthenticated
    /// control plane, so that combination is refused at startup.
    pub fn admin_token(&self) -> Result<Option<String>> {
        let token = std::env::var("AX_CREW_ADMIN_TOKEN")
            .ok()
            .filter(|value| !value.is_empty());
        if !self.listen.ip().is_loopback() && token.is_none() {
            anyhow::bail!("AX_CREW_ADMIN_TOKEN is required when listening beyond loopback");
        }
        Ok(token)
    }

    /// Issued tokens live next to the database, so a database directory carries
    /// everything the gateway needs to restart identically.
    pub fn token_path(&self) -> PathBuf {
        self.database.with_file_name("gateway.tokens.json")
    }
}
