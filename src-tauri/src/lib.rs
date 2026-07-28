mod ai;
mod asr_dashscope_realtime;
mod backup;
mod device;
mod fonts;
mod mcp;
mod mcp_runtime;
mod ocr_packages;
mod skills;

use ai::{
    ai_binary_request, ai_chat_completion_stream, ai_json_request, ai_multipart_request,
    cancel_ai_request, AiRequestManager,
};
use asr_dashscope_realtime::{
    dashscope_asr_connect, dashscope_asr_disconnect, dashscope_asr_finish, dashscope_asr_send_pcm,
    DashscopeAsrManager,
};
use backup::{export_app_data, import_app_data, import_app_data_from_file};
use device::get_device_id;
use fonts::list_system_fonts;
use mcp::{send_mcp_message, start_mcp_stdio_server, stop_mcp_server, McpServerManager};
use mcp_runtime::{
    cancel_mcp_runtime_install, inspect_mcp_runtime, install_mcp_runtime, RuntimeInstallManager,
};
use ocr_packages::{list_ocr_providers, run_ocr_provider};
use skills::{import_skill_zip, install_builtin_skills};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        // 系统通知（待办到期提醒，与桌面端 main.rs 保持一致）
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .manage(McpServerManager::new())
        .manage(RuntimeInstallManager::new())
        .manage(AiRequestManager::new())
        .manage(DashscopeAsrManager::new());

    builder
        .invoke_handler(tauri::generate_handler![
            start_mcp_stdio_server,
            stop_mcp_server,
            send_mcp_message,
            inspect_mcp_runtime,
            install_mcp_runtime,
            cancel_mcp_runtime_install,
            get_device_id,
            list_system_fonts,
            export_app_data,
            import_app_data,
            import_app_data_from_file,
            import_skill_zip,
            install_builtin_skills,
            ai_json_request,
            ai_binary_request,
            ai_multipart_request,
            ai_chat_completion_stream,
            cancel_ai_request,
            list_ocr_providers,
            run_ocr_provider,
            dashscope_asr_connect,
            dashscope_asr_send_pcm,
            dashscope_asr_finish,
            dashscope_asr_disconnect,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
