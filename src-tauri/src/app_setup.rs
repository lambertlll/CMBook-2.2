use crate::file_open;
use crate::screenshot::cleanup_temp_screenshot_dir;
use crate::tray::create_tray;
use crate::window;
use tauri::App;
#[cfg(target_os = "windows")]
use tauri::Manager;

/// 获取 macOS 主版本号和次版本号，例如 13.4 → (13, 4)
/// 非 macOS 平台返回 None
#[cfg(target_os = "macos")]
fn get_macos_version() -> Option<(u32, u32)> {
    use std::process::Command;
    let output = Command::new("sw_vers")
        .arg("-productVersion")
        .output()
        .ok()?;
    let version_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let parts: Vec<&str> = version_str.split('.').collect();
    let major = parts.first()?.parse::<u32>().ok()?;
    let minor = parts.get(1).and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);
    Some((major, minor))
}

pub fn setup_app(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let app_handle = app.handle();

    // macOS 版本检查 — 低于 macOS 11 (Big Sur) 直接弹窗退出
    // macOS 11-12 由前端 browser-check.js 做精细检测（Safari 是否更新到 16.2+）
    #[cfg(target_os = "macos")]
    {
        if let Some((major, minor)) = get_macos_version() {
            if major < 11 {
                use tauri_plugin_dialog::DialogExt;
                let handle = app_handle.clone();
                let msg = format!(
                    "您的 macOS 版本为 {}.{}，招悟需要 macOS 11 (Big Sur) 或更高版本。\n\n\
                     请升级 macOS 系统后重试，或联系管理员更换设备。",
                    major, minor
                );
                handle
                    .dialog()
                    .message(&msg)
                    .title("系统版本不支持")
                    .blocking_show();
                handle.exit(0);
                return Ok(());
            }
        }
    }

    cleanup_temp_screenshot_dir(&app_handle);

    // 在 Windows 上明确禁用窗口装饰
    #[cfg(target_os = "windows")]
    {
        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.set_decorations(false);
            let _ = window.set_title("CMBook");
        }
    }

    // 设置窗口事件监听器
    window::setup_window_events(&app_handle)?;

    // 创建系统托盘
    let _tray = create_tray(&app_handle)?;

    file_open::handle_initial_open_files(&app_handle);

    Ok(())
}
