use tauri::{image::Image, Manager, UserAttentionType};

const TRAY_ID: &str = "main-tray";

#[cfg(windows)]
fn dot_icon() -> Image<'static> {
    let mut rgba = vec![0; 16 * 16 * 4];
    paint_dot(&mut rgba, 16, 16, 8.0, 8.0, 6.0);
    Image::new_owned(rgba, 16, 16)
}

fn paint_dot(rgba: &mut [u8], width: u32, height: u32, cx: f32, cy: f32, radius: f32) {
    for y in 0..height {
        for x in 0..width {
            let distance = ((x as f32 + 0.5 - cx).powi(2) + (y as f32 + 0.5 - cy).powi(2)).sqrt();
            if distance <= radius {
                let start = ((y * width + x) * 4) as usize;
                // Match the desktop's iris accent; the pale rim remains visible
                // against both dark and light Windows taskbars.
                let color = if distance > radius - 1.0 {
                    [235, 232, 250, 255]
                } else {
                    [139, 128, 196, 255]
                };
                rgba[start..start + 4].copy_from_slice(&color);
            }
        }
    }
}

#[cfg(windows)]
fn play_sound() {
    #[link(name = "winmm")]
    unsafe extern "system" {
        fn PlaySoundA(sound: *const u8, module: *mut std::ffi::c_void, flags: u32) -> i32;
    }
    // Static memory is required by SND_ASYNC. This original short chime is
    // embedded in the executable and does not depend on WebView autoplay.
    static SOUND: &[u8] = include_bytes!("../assets/completion.wav");
    unsafe {
        PlaySoundA(
            SOUND.as_ptr(),
            std::ptr::null_mut(),
            0x0001 | 0x0002 | 0x0004 | 0x0010,
        );
    }
}

#[tauri::command]
pub fn completion_attention(
    app: tauri::AppHandle,
    unread_count: u32,
    alert: bool,
) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };
    let unread = unread_count > 0;
    #[cfg(windows)]
    window
        .set_overlay_icon(unread.then(dot_icon))
        .map_err(|e| e.to_string())?;
    #[cfg(not(windows))]
    window
        .set_badge_count(unread.then_some(i64::from(unread_count)))
        .map_err(|e| e.to_string())?;
    if let (Some(tray), Some(original)) = (app.tray_by_id(TRAY_ID), app.default_window_icon()) {
        let icon = if unread {
            let (width, height) = (original.width(), original.height());
            let mut rgba = original.rgba().to_vec();
            let radius = width.min(height) as f32 * 0.18;
            paint_dot(
                &mut rgba,
                width,
                height,
                width as f32 - radius,
                height as f32 - radius,
                radius,
            );
            Image::new_owned(rgba, width, height)
        } else {
            original.clone()
        };
        tray.set_icon(Some(icon)).map_err(|e| e.to_string())?;
        tray.set_tooltip(Some(if unread {
            "AX Crew · Unread completions"
        } else {
            "AX Crew"
        }))
        .map_err(|e| e.to_string())?;
    }
    // Recheck natively to avoid flashing or sounding after the user returned
    // during the queued frontend IPC call. Never take focus from their work.
    if alert && unread && !window.is_focused().unwrap_or(true) {
        window
            .request_user_attention(Some(UserAttentionType::Informational))
            .map_err(|e| e.to_string())?;
        #[cfg(windows)]
        play_sound();
    } else if !unread || window.is_focused().unwrap_or(false) {
        window
            .request_user_attention(None)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
