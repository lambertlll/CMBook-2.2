// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai;
mod app_setup;
mod asr_dashscope_inference;
mod asr_dashscope_realtime;
mod backup;
mod device;
mod file_open;
mod fonts;
mod fuzzy_search;
mod keywords;
mod mcp;
mod mcp_runtime;
mod ocr_packages;
mod screenshot;
mod skills;
mod tray;
mod window;

use ai::{
    ai_binary_request, ai_chat_completion_stream, ai_json_request, ai_multipart_request,
    cancel_ai_request, AiRequestManager,
};
use asr_dashscope_realtime::{
    dashscope_asr_connect, dashscope_asr_disconnect, dashscope_asr_finish, dashscope_asr_send_pcm,
    DashscopeAsrManager,
};
use asr_dashscope_inference::{
    dashscope_inference_connect, dashscope_inference_disconnect, dashscope_inference_finish,
    dashscope_inference_send_pcm,
};
use backup::{export_app_data, import_app_data, import_app_data_from_file};
use device::get_device_id;
use fonts::list_system_fonts;
use fuzzy_search::{fuzzy_search, fuzzy_search_parallel};
use keywords::rank_keywords;
use mcp::{send_mcp_message, start_mcp_stdio_server, stop_mcp_server, McpServerManager};
use mcp_runtime::{
    cancel_mcp_runtime_install, inspect_mcp_runtime, install_mcp_runtime, RuntimeInstallManager,
};
use ocr_packages::{list_ocr_providers, run_ocr_provider};
use screenshot::{cleanup_temp_screenshot_dir, screenshot};
use skills::{import_skill_zip, install_builtin_skills};
use tray::update_tray_menu_labels;

/// 清理失效的系统代理环境变量（HTTP_PROXY/HTTPS_PROXY/ALL_PROXY）。
///
/// 背景：代理软件退出后 Windows 系统设置常残留指向 localhost 的代理地址
/// （如 http://localhost:15236/），但代理进程已不在运行。reqwest（含
/// tauri-plugin-http、AI 流式请求）默认读环境代理 → 所有出网请求走失效
/// 代理 → "error sending request"。AI 端点（阿里云 MaaS 等）直连更稳。
///
/// 策略：仅当代理地址指向本机（localhost/127.0.0.1）且该端口无监听时移除，
/// 不影响真正可用的代理（如公司内网代理）。
fn sanitize_proxy_env() {
    for key in ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"] {
        let Some(value) = std::env::var(key).ok().filter(|v| !v.is_empty()) else {
            continue
        };
        let Some(host_port) = extract_proxy_host_port(&value) else {
            continue
        };
        // 只处理指向本机的代理
        let is_local = matches!(
            host_port.0.as_str(),
            "localhost" | "127.0.0.1" | "::1" | "[::1]"
        );
        if !is_local {
            continue
        }
        let port = host_port.1;
        // 端口无监听 → 视为失效代理，移除
        if std::net::TcpStream::connect(("127.0.0.1", port)).is_err() {
            std::env::remove_var(key);
            eprintln!(
                "[proxy-sanitize] removed dead local proxy env {key}={value} (no listener on port {port})"
            );
        }
    }
}

/// 从代理 URL 提取 (host, port)，如 http://localhost:15236/ → ("localhost", 15236)
fn extract_proxy_host_port(value: &str) -> Option<(String, u16)> {
    let trimmed = value.trim();
    let rest = trimmed
        .strip_prefix("http://")
        .or_else(|| trimmed.strip_prefix("https://"))?;
    let authority = rest.split('/').next().unwrap_or(rest);
    let (host, port_str) = match authority.rsplit_once(':') {
        Some((h, p)) if !p.is_empty() => (h, p),
        _ => return None,
    };
    let port: u16 = port_str.parse().ok()?;
    Some((host.to_string(), port))
}

fn main() {
    sanitize_proxy_env();
    tauri::Builder::default()
        // 单实例插件必须最先加载，避免 Windows 文件关联二次启动时继续初始化托盘等资源。
        .plugin(tauri_plugin_single_instance::init(
            window::handle_single_instance,
        ))
        // 敏感凭据加密存储（系统钥匙串/凭据管理器）
        .plugin(tauri_plugin_keyring::init())
        // 核心插件
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        // MCP 服务器管理器
        .manage(file_open::PendingOpenFiles::default())
        .manage(McpServerManager::new())
        .manage(RuntimeInstallManager::new())
        .manage(AiRequestManager::new())
        .manage(DashscopeAsrManager::new())
        // 系统级插件
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        // UI 相关插件
        .plugin(tauri_plugin_dialog::init())
        // 系统通知（待办到期提醒）
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // 注册命令处理器
        .invoke_handler(tauri::generate_handler![
            screenshot,
            fuzzy_search,
            fuzzy_search_parallel,
            rank_keywords,
            export_app_data,
            import_app_data,
            import_app_data_from_file,
            import_skill_zip,
            install_builtin_skills,
            start_mcp_stdio_server,
            stop_mcp_server,
            send_mcp_message,
            inspect_mcp_runtime,
            install_mcp_runtime,
            cancel_mcp_runtime_install,
            get_device_id,
            list_system_fonts,
            ai_json_request,
            ai_binary_request,
            ai_multipart_request,
            ai_chat_completion_stream,
            cancel_ai_request,
            update_tray_menu_labels,
            list_ocr_providers,
            run_ocr_provider,
            file_open::drain_pending_open_files,
            dashscope_asr_connect,
            dashscope_asr_send_pcm,
            dashscope_asr_finish,
            dashscope_asr_disconnect,
            dashscope_inference_connect,
            dashscope_inference_send_pcm,
            dashscope_inference_finish,
            dashscope_inference_disconnect,
        ])
        // 应用设置 - 在所有插件和命令注册后
        .setup(app_setup::setup_app)
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| match event {
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen {
                has_visible_windows,
                ..
            } => {
                window::handle_macos_reopen(&app_handle, has_visible_windows);
            }
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Opened { urls } => {
                file_open::handle_opened_urls(&app_handle, urls);
            }
            tauri::RunEvent::Exit => {
                cleanup_temp_screenshot_dir(&app_handle);
            }
            _ => {}
        });
}
