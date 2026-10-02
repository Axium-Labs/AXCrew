fn main() {
  // Guard against a broken release build.
  //
  // Tauri decides at *compile time* whether the window loads the Vite dev server
  // (`build.devUrl` -> http://localhost:1420) or the frontend embedded in the binary.
  // That follows the `tauri/custom-protocol` Cargo feature: without it the `tauri` crate
  // reports `cargo:dev=true` and the assets are NOT embedded, so a "release" binary shows
  // `ERR_CONNECTION_REFUSED / localhost 拒绝连接` on any machine that is not running `vite`.
  //
  // `cargo tauri build` (and `npm run tauri:build` / `npm run pack:portable`) enable the
  // feature; a bare `cargo build --release` does not. Fail loudly instead of shipping it.
  if std::env::var("PROFILE").as_deref() == Ok("release")
    && std::env::var("DEP_TAURI_DEV").as_deref() == Ok("true")
  {
    panic!(
      "refusing to link a release binary without the `tauri/custom-protocol` feature: it would \
       try to load http://localhost:1420 at runtime instead of the embedded frontend and show \
       ERR_CONNECTION_REFUSED. Build with `cargo tauri build` / `npm run pack:portable`, not \
       with a bare `cargo build --release`."
    );
  }

  tauri_build::build()
}
