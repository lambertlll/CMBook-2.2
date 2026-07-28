use tauri::Emitter;
use tauri::{
    image::Image,
    menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, Runtime,
};

pub const TRAY_ID: &str = "main";
pub const ID_SHOW_MAIN: &str = "show-main";
pub const ID_START_MEETING: &str = "start-meeting";
pub const ID_NEW_NOTE: &str = "new-note";
pub const ID_NEW_FOLDER: &str = "new-folder";
pub const ID_PIN_WINDOW: &str = "pin-window";
pub const ID_HIDE_WINDOW: &str = "hide-window";
pub const ID_SETTINGS: &str = "settings";
pub const ID_QUIT: &str = "quit";

#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayMenuLabels {
    open: String,
    show_main: String,
    start_meeting: String,
    new_note: String,
    new_folder: String,
    settings: String,
    window: String,
    pin_toggle: String,
    hide_window: String,
    quit: String,
}

pub fn create_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::tray::TrayIcon<R>> {
    let menu = build_tray_menu(app, None)?;
    let icon = Image::from_bytes(include_bytes!("../icons/icon.png"))?;

    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .menu(&menu)
        .tooltip("CMBook")
        .on_menu_event(move |app, event| {
            handle_menu_event(app, event.id.0.as_str());
        })
        .on_tray_icon_event(move |tray, event| {
            if let tauri::tray::TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                ..
            } = event
            {
                let app_handle = tray.app_handle();
                focus_main_window(&app_handle);
            }
        })
        .build(app)?;

    Ok(tray)
}

/// 前端语言切换后同步托盘菜单文案（「快速记录」区已随记录 Tab 一并移除）
#[tauri::command]
pub fn update_tray_menu_labels(app: AppHandle, labels: TrayMenuLabels) -> Result<(), String> {
    let tray = app
        .tray_by_id(TRAY_ID)
        .ok_or_else(|| "Tray icon not found".to_string())?;
    let menu = build_tray_menu(&app, Some(&labels)).map_err(|error| error.to_string())?;

    tray.set_menu(Some(menu)).map_err(|error| error.to_string())
}

fn build_tray_menu<R: Runtime>(
    app: &AppHandle<R>,
    labels: Option<&TrayMenuLabels>,
) -> tauri::Result<Menu<R>> {
    let default_labels = default_tray_menu_labels();
    let labels = labels.unwrap_or(&default_labels);

    let open_section = MenuItem::with_id(app, "section-open", &labels.open, false, None::<&str>)?;
    let settings = MenuItem::with_id(app, ID_SETTINGS, &labels.settings, true, None::<&str>)?;
    let show_main = MenuItem::with_id(app, ID_SHOW_MAIN, &labels.show_main, true, None::<&str>)?;
    let start_meeting = MenuItem::with_id(
        app,
        ID_START_MEETING,
        &labels.start_meeting,
        true,
        None::<&str>,
    )?;
    let new_note = MenuItem::with_id(app, ID_NEW_NOTE, &labels.new_note, true, None::<&str>)?;
    let new_folder = MenuItem::with_id(app, ID_NEW_FOLDER, &labels.new_folder, true, None::<&str>)?;

    let window_section =
        MenuItem::with_id(app, "section-window", &labels.window, false, None::<&str>)?;
    let pin_window = MenuItem::with_id(app, ID_PIN_WINDOW, &labels.pin_toggle, true, None::<&str>)?;
    let hide_window =
        MenuItem::with_id(app, ID_HIDE_WINDOW, &labels.hide_window, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, ID_QUIT, &labels.quit, true, None::<&str>)?;
    let separator_2 = PredefinedMenuItem::separator(app)?;
    let separator_3 = PredefinedMenuItem::separator(app)?;

    let menu_items: Vec<&dyn IsMenuItem<R>> = vec![
        &open_section,
        &show_main,
        &start_meeting,
        &new_note,
        &new_folder,
        &settings,
        &separator_2,
        &window_section,
        &pin_window,
        &hide_window,
        &separator_3,
        &quit,
    ];

    Menu::with_items(app, &menu_items)
}

fn default_tray_menu_labels() -> TrayMenuLabels {
    TrayMenuLabels {
        open: "Open".to_string(),
        show_main: "Show Main Window".to_string(),
        start_meeting: "Start Meeting".to_string(),
        new_note: "New Note".to_string(),
        new_folder: "New Folder".to_string(),
        settings: "Settings".to_string(),
        window: "Window".to_string(),
        pin_toggle: "Pin/Unpin".to_string(),
        hide_window: "Hide to Tray".to_string(),
        quit: "Quit CMBook".to_string(),
    }
}

fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    match id {
        ID_SHOW_MAIN => focus_main_window(app),
        ID_SETTINGS => {
            focus_main_window(app);
            emit_to_main(app, "open-settings", "");
        }
        ID_HIDE_WINDOW => {
            if let Some(webview) = app.get_webview_window("main") {
                let _ = webview.hide();
            }
        }
        ID_QUIT => {
            app.exit(0);
        }
        _ => emit_tray_action(app, id),
    }
}

fn focus_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(webview) = app.get_webview_window("main") {
        let _ = webview.show();
        let _ = webview.unminimize();
        let _ = webview.set_focus();
    }
}

fn emit_tray_action<R: Runtime>(app: &AppHandle<R>, action: &str) {
    focus_main_window(app);
    emit_to_main(app, "tray-action", action);
}

fn emit_to_main<R: Runtime, S: serde::Serialize + Clone>(
    app: &AppHandle<R>,
    event: &str,
    payload: S,
) {
    if let Some(webview) = app.get_webview_window("main") {
        let _ = webview.emit(event, payload);
    }
}
