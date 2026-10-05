//! AX Crew gateway entry point.
//!
//! Deliberately thin: read the configuration, build the application state, start
//! the two scheduler loops, mount the router and serve. Every handler lives in
//! `ax_crew::api`, and all startup work lives in `ax_crew::app::App::build`.

use anyhow::Result;
use ax_crew::{api, app::App, config::Args};
use clap::Parser;

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    let app = App::build(&args)?;
    tokio::spawn(app.scheduler.clone().run());
    tokio::spawn(app.scheduler.clone().run_automations());
    tokio::spawn(ax_crew::orchestration::distributed::run(app.db.clone()));
    let routes = api::router(app);
    let listener = tokio::net::TcpListener::bind(args.listen).await?;
    eprintln!("AX Crew listening on {}", args.listen);
    axum::serve(listener, routes).await?;
    Ok(())
}
