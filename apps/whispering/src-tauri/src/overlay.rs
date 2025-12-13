use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindowBuilder};
use log::info;

const OVERLAY_WIDTH: f64 = 172.0;
const OVERLAY_HEIGHT: f64 = 36.0;

#[cfg(target_os = "macos")]
const OVERLAY_TOP_OFFSET: f64 = 46.0;
#[cfg(any(target_os = "windows", target_os = "linux"))]
const OVERLAY_TOP_OFFSET: f64 = 4.0;

#[cfg(target_os = "macos")]
const OVERLAY_BOTTOM_OFFSET: f64 = 15.0;

#[cfg(any(target_os = "windows", target_os = "linux"))]
const OVERLAY_BOTTOM_OFFSET: f64 = 40.0;

/// Overlay position setting
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum OverlayPosition {
    None,
    Top,
    Bottom,
}

impl Default for OverlayPosition {
    fn default() -> Self {
        // Enable overlay by default on all platforms
        OverlayPosition::Bottom
    }
}

/// Forces a window to be topmost using Win32 API (Windows only)
/// This is more reliable than Tauri's set_always_on_top which can be overridden
#[cfg(target_os = "windows")]
fn force_overlay_topmost(overlay_window: &tauri::webview::WebviewWindow) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW,
    };

    // Clone because run_on_main_thread takes 'static
    let overlay_clone = overlay_window.clone();

    // Make sure the Win32 call happens on the UI thread
    let _ = overlay_clone.clone().run_on_main_thread(move || {
        if let Ok(hwnd) = overlay_clone.hwnd() {
            unsafe {
                // Force Z-order: make this window topmost without changing size/pos or stealing focus
                let _ = SetWindowPos(
                    hwnd.0 as isize,
                    HWND_TOPMOST,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
                );
            }
        }
    });
}

fn get_monitor_with_cursor(app_handle: &AppHandle) -> Option<tauri::Monitor> {
    // For now, just return the primary monitor
    // TODO: Add cursor position detection like in Handy
    app_handle.primary_monitor().ok().flatten()
}

#[allow(dead_code)]
fn is_mouse_within_monitor(
    mouse_pos: (i32, i32),
    monitor_pos: &PhysicalPosition<i32>,
    monitor_size: &PhysicalSize<u32>,
) -> bool {
    let (mouse_x, mouse_y) = mouse_pos;
    let PhysicalPosition {
        x: monitor_x,
        y: monitor_y,
    } = *monitor_pos;
    let PhysicalSize {
        width: monitor_width,
        height: monitor_height,
    } = *monitor_size;

    mouse_x >= monitor_x
        && mouse_x < (monitor_x + monitor_width as i32)
        && mouse_y >= monitor_y
        && mouse_y < (monitor_y + monitor_height as i32)
}

fn calculate_overlay_position(app_handle: &AppHandle, position: OverlayPosition) -> Option<(f64, f64)> {
    if let Some(monitor) = get_monitor_with_cursor(app_handle) {
        let work_area = monitor.work_area();
        let scale = monitor.scale_factor();
        let work_area_width = work_area.size.width as f64 / scale;
        let work_area_height = work_area.size.height as f64 / scale;
        let work_area_x = work_area.position.x as f64 / scale;
        let work_area_y = work_area.position.y as f64 / scale;

        let x = work_area_x + (work_area_width - OVERLAY_WIDTH) / 2.0;
        let y = match position {
            OverlayPosition::Top => work_area_y + OVERLAY_TOP_OFFSET,
            OverlayPosition::Bottom | OverlayPosition::None => {
                // don't subtract the overlay height it puts it too far up
                work_area_y + work_area_height - OVERLAY_BOTTOM_OFFSET
            }
        };

        return Some((x, y));
    }
    None
}

/// Creates the recording overlay window and keeps it hidden by default
pub fn create_recording_overlay(app_handle: &AppHandle) {
    info!("[OVERLAY] Creating overlay window...");
    if let Some((x, y)) = calculate_overlay_position(app_handle, OverlayPosition::default()) {
        info!("[OVERLAY] Calculated position: x={}, y={}", x, y);
        // In dev mode, use external URL to Vite dev server
        // In production, use bundled app assets
        #[cfg(debug_assertions)]
        let overlay_url = tauri::WebviewUrl::External("http://localhost:1420/src/overlay/index.html".parse().unwrap());
        #[cfg(not(debug_assertions))]
        let overlay_url = tauri::WebviewUrl::App("src/overlay/index.html".into());
        
        match WebviewWindowBuilder::new(
            app_handle,
            "recording_overlay",
            overlay_url,
        )
        .title("Recording")
        .position(x, y)
        .resizable(false)
        .inner_size(OVERLAY_WIDTH, OVERLAY_HEIGHT)
        .shadow(false)
        .maximizable(false)
        .minimizable(false)
        .closable(false)
        .accept_first_mouse(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .transparent(true)
        .focused(false)
        .visible(false)
        .build()
        {
            Ok(_window) => {
                info!("[OVERLAY] ✓ Recording overlay window created successfully (hidden)");
            }
            Err(e) => {
                info!("[OVERLAY] ✗ Failed to create recording overlay window: {}", e);
            }
        }
    } else {
        info!("[OVERLAY] ✗ Failed to calculate overlay position");
    }
}

/// Shows the recording overlay window with fade-in animation
pub fn show_recording_overlay(app_handle: &AppHandle, position: OverlayPosition) {
    info!("[OVERLAY] show_recording_overlay called");
    info!("[OVERLAY] Position setting: {:?}", position);
    
    if position == OverlayPosition::None {
        info!("[OVERLAY] Position is None, not showing overlay");
        return;
    }

    if let Some(overlay_window) = app_handle.get_webview_window("recording_overlay") {
        info!("[OVERLAY] Found overlay window, showing it");
        // Update position before showing to prevent flicker from position changes
        if let Some((x, y)) = calculate_overlay_position(app_handle, position) {
            let _ = overlay_window
                .set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }));
        }

        let _ = overlay_window.show();
        info!("[OVERLAY] Window shown");

        // On Windows, aggressively re-assert "topmost" in the native Z-order after showing
        #[cfg(target_os = "windows")]
        force_overlay_topmost(&overlay_window);

        // Emit event to trigger fade-in animation with recording state
        let _ = overlay_window.emit("show-overlay", "recording");
        info!("[OVERLAY] Emitted show-overlay event with state: recording");
    } else {
        info!("[OVERLAY] ERROR: Overlay window 'recording_overlay' not found!");
    }
}

/// Shows the transcribing overlay window
pub fn show_transcribing_overlay(app_handle: &AppHandle, position: OverlayPosition) {
    if position == OverlayPosition::None {
        return;
    }

    update_overlay_position(app_handle, position);

    if let Some(overlay_window) = app_handle.get_webview_window("recording_overlay") {
        let _ = overlay_window.show();

        // On Windows, aggressively re-assert "topmost" in the native Z-order after showing
        #[cfg(target_os = "windows")]
        force_overlay_topmost(&overlay_window);

        // Emit event to switch to transcribing state
        let _ = overlay_window.emit("show-overlay", "transcribing");
    }
}

/// Updates the overlay window position based on provided setting
pub fn update_overlay_position(app_handle: &AppHandle, position: OverlayPosition) {
    
    if let Some(overlay_window) = app_handle.get_webview_window("recording_overlay") {
        if let Some((x, y)) = calculate_overlay_position(app_handle, position) {
            let _ = overlay_window
                .set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }));
        }
    }
}

/// Hides the recording overlay window with fade-out animation
pub fn hide_recording_overlay(app_handle: &AppHandle) {
    // Always hide the overlay regardless of settings - if setting was changed while recording,
    // we still want to hide it properly
    if let Some(overlay_window) = app_handle.get_webview_window("recording_overlay") {
        // Emit event to trigger fade-out animation
        let _ = overlay_window.emit("hide-overlay", ());
        // Hide the window after a short delay to allow animation to complete
        let window_clone = overlay_window.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(300));
            let _ = window_clone.hide();
        });
    }
}

pub fn emit_mic_levels(app_handle: &AppHandle, levels: &Vec<f32>) {
    // Emit to the recording overlay if it's open
    if let Some(overlay_window) = app_handle.get_webview_window("recording_overlay") {
        let _ = overlay_window.emit("mic-level", levels);
    }
}

// Tauri command wrappers

#[tauri::command]
pub fn show_recording_overlay_command(app: tauri::AppHandle, position: String) {
    info!("[OVERLAY] show_recording_overlay_command invoked from frontend with position: {}", position);
    let pos = match position.as_str() {
        "Top" => OverlayPosition::Top,
        "Bottom" => OverlayPosition::Bottom,
        "None" => OverlayPosition::None,
        _ => OverlayPosition::default(),
    };
    show_recording_overlay(&app, pos);
    info!("[OVERLAY] show_recording_overlay_command completed");
}

#[tauri::command]
pub fn show_transcribing_overlay_command(app: tauri::AppHandle, position: String) {
    let pos = match position.as_str() {
        "Top" => OverlayPosition::Top,
        "Bottom" => OverlayPosition::Bottom,
        "None" => OverlayPosition::None,
        _ => OverlayPosition::default(),
    };
    show_transcribing_overlay(&app, pos);
}

#[tauri::command]
pub fn hide_recording_overlay_command(app: tauri::AppHandle) {
    hide_recording_overlay(&app);
}

#[tauri::command]
pub fn update_overlay_position_command(app: tauri::AppHandle, position: String) {
    info!("[OVERLAY] update_overlay_position_command invoked with position: {}", position);
    let pos = match position.as_str() {
        "Top" => OverlayPosition::Top,
        "Bottom" => OverlayPosition::Bottom,
        "None" => OverlayPosition::None,
        _ => OverlayPosition::default(),
    };
    update_overlay_position(&app, pos);
}
