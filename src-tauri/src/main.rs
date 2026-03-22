#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    collections::HashMap,
    env,
    error::Error,
    fs::{self, OpenOptions},
    io::Write,
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
use std::time::UNIX_EPOCH;
#[cfg(target_os = "windows")]
use std::fs::File;
#[cfg(target_os = "windows")]
use std::io::Cursor;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{
    ipc::InvokeError, Manager, RunEvent, Webview, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use url::Url;
#[cfg(target_os = "windows")]
use zip::ZipArchive;

const APP_TITLE: &str = "BELGESELSEMOFLIX 1.0";
const APP_FOOTER: &str = "BELGESELSEMO.COM.TR";
const MAIN_WINDOW_LABEL: &str = "main";
const HOST: &str = "127.0.0.1";
const DEFAULT_PORT: u16 = 8000;
const MAX_PORT: u16 = 8100;
const STARTUP_TIMEOUT: Duration = Duration::from_secs(600);
const FILEQ_API_KEY: &str = "318co5vm9gtiulsx1jd";
const FILEQ_API_URL: &str = "https://fileq.net/api/file/list";
const FILEQ_STATS_URL: &str = "https://fileq.net/api/account/stats";
const FILEQ_CACHE_TTL: Duration = Duration::from_secs(900);
const DOWNLOAD_TAB_LABEL: &str = "Indirmeler";
const HOME_TAB_LABEL: &str = "Ana Uygulama";
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[cfg(target_os = "windows")]
const WEBVIEW2_BOOTSTRAPPER_URL: &str = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";

type DynError = Box<dyn Error + Send + Sync>;

struct AppState {
    server_process: Mutex<Option<Child>>,
    shell: Mutex<ShellState>,
}

#[derive(Default)]
struct ShellState {
    status_title: String,
    status_detail: String,
    home_url: Option<String>,
    active_tab: ActiveTab,
    managed_title: Option<String>,
    managed_url: Option<String>,
    downloads_url: Option<String>,
}

#[derive(Clone, Copy, Serialize, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum ActiveTab {
    #[default]
    Home,
    Managed,
    Downloads,
}

#[derive(Serialize)]
struct ShellSnapshot {
    app_title: &'static str,
    footer_text: &'static str,
    status_title: String,
    status_detail: String,
    home_url: Option<String>,
    active_tab: ActiveTab,
    home_tab_label: &'static str,
    managed_tab_label: String,
    managed_open: bool,
    managed_url: Option<String>,
    downloads_tab_label: &'static str,
    downloads_url: Option<String>,
    is_maximized: bool,
}

fn main() {
    let app = tauri::Builder::default()
        .manage(AppState {
            server_process: Mutex::new(None),
            shell: Mutex::new(ShellState {
                status_title: "Hazırlanıyor...".into(),
                status_detail: "Yerel PHP sunucusu arka planda başlatılıyor.".into(),
                ..Default::default()
            }),
        })
        .invoke_handler(tauri::generate_handler![
            shell_ready,
            shell_minimize,
            shell_toggle_maximize,
            shell_close,
            shell_select_tab,
            desktop_open_managed_url,
            desktop_storage_load,
            desktop_storage_save,
            desktop_storage_remove,
            desktop_fetch_fileq_files,
            desktop_fetch_fileq_stats
        ])
        .setup(|app| {
            #[cfg(target_os = "windows")]
            if let Err(error) = ensure_windows_webview2_runtime() {
                return Err(std::io::Error::other(error.to_string()).into());
            }

            let main_window = WebviewWindowBuilder::new(
                app,
                MAIN_WINDOW_LABEL,
                WebviewUrl::App("index.html".into()),
            )
            .title(APP_TITLE)
            .inner_size(1440.0, 900.0)
            .min_inner_size(1180.0, 760.0)
            .resizable(true)
            .decorations(false)
            .initialization_script_for_all_frames(home_initialization_script())
            .build()?;

            let _ = sync_shell(&main_window);

            let app_handle = app.handle().clone();
            thread::spawn(move || match start_php_server(&app_handle) {
                Ok(url) => {
                    {
                        let state = app_handle.state::<AppState>();
                        let mut shell = state.shell.lock().expect("state lock bozuldu");
                        shell.home_url = Some(url);
                        shell.status_title = "Hazır".into();
                        shell.status_detail = "Ana uygulama hazır.".into();
                        shell.active_tab = ActiveTab::Home;
                    }
                    let _ = sync_main_shell(&app_handle);
                }
                Err(error) => {
                    let detail = format!(
                        "{}\n\nDetaylar icin uygulama loglarini kontrol edin.",
                        error
                    );
                    set_status(&app_handle, "Başlatma Hatası", &detail);
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("tauri uygulamasi olusturulamadi");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
            stop_php_server(app_handle);
        }
    });
}

#[tauri::command]
fn shell_ready(window: WebviewWindow) -> Result<(), InvokeError> {
    sync_shell(&window).map_err(|error| InvokeError::from(error.to_string()))
}

#[tauri::command]
fn shell_minimize(window: WebviewWindow) -> Result<(), InvokeError> {
    window
        .minimize()
        .map_err(|error| InvokeError::from(error.to_string()))
}

#[tauri::command]
fn shell_toggle_maximize(window: WebviewWindow) -> Result<(), InvokeError> {
    if window
        .is_maximized()
        .map_err::<InvokeError, _>(Into::into)?
    {
        window
            .unmaximize()
            .map_err(|error| InvokeError::from(error.to_string()))?;
    } else {
        window
            .maximize()
            .map_err(|error| InvokeError::from(error.to_string()))?;
    }
    sync_shell(&window).map_err(|error| InvokeError::from(error.to_string()))
}

#[tauri::command]
fn shell_close(window: WebviewWindow) -> Result<(), InvokeError> {
    window.app_handle().exit(0);
    Ok(())
}

#[tauri::command]
fn shell_select_tab(app: tauri::AppHandle, tab: String) -> Result<(), InvokeError> {
    {
        let state = app.state::<AppState>();
        let mut shell = state
            .shell
            .lock()
            .map_err(|_| InvokeError::from("state lock bozuldu"))?;

        match tab.as_str() {
            "home" => shell.active_tab = ActiveTab::Home,
            "downloads" => shell.active_tab = ActiveTab::Downloads,
            "managed" => {
                if shell.managed_url.is_some() {
                    shell.active_tab = ActiveTab::Managed;
                }
            }
            _ => return Err(InvokeError::from("gecersiz sekme")),
        }
    }

    sync_main_shell(&app).map_err(|error| InvokeError::from(error.to_string()))
}

#[tauri::command]
fn desktop_open_managed_url(
    app: tauri::AppHandle,
    url: String,
    title_hint: Option<String>,
) -> Result<(), InvokeError> {
    let parsed = Url::parse(&url).map_err(|_| InvokeError::from("gecersiz url"))?;
    open_managed_url(&app, parsed, title_hint).map_err(|error| InvokeError::from(error.to_string()))
}

#[tauri::command]
fn desktop_storage_load(app: tauri::AppHandle) -> Result<Value, InvokeError> {
    let data_dir = desktop_data_dir(&app).map_err(|error| InvokeError::from(error.to_string()))?;
    load_desktop_storage_entries(&data_dir).map_err(|error| InvokeError::from(error.to_string()))
}

#[tauri::command]
fn desktop_storage_save(
    app: tauri::AppHandle,
    entries: HashMap<String, String>,
) -> Result<Value, InvokeError> {
    let data_dir = desktop_data_dir(&app).map_err(|error| InvokeError::from(error.to_string()))?;
    save_desktop_storage_entries(&data_dir, &entries)
        .map_err(|error| InvokeError::from(error.to_string()))
}

#[tauri::command]
fn desktop_storage_remove(
    app: tauri::AppHandle,
    keys: Vec<String>,
) -> Result<Value, InvokeError> {
    let data_dir = desktop_data_dir(&app).map_err(|error| InvokeError::from(error.to_string()))?;
    remove_desktop_storage_entries(&data_dir, &keys)
        .map_err(|error| InvokeError::from(error.to_string()))
}

#[tauri::command]
fn desktop_fetch_fileq_files(app: tauri::AppHandle) -> Result<Value, InvokeError> {
    let data_dir = desktop_data_dir(&app).map_err(|error| InvokeError::from(error.to_string()))?;
    fetch_fileq_files_payload(&data_dir).map_err(|error| InvokeError::from(error.to_string()))
}

#[tauri::command]
fn desktop_fetch_fileq_stats(app: tauri::AppHandle) -> Result<Value, InvokeError> {
    let data_dir = desktop_data_dir(&app).map_err(|error| InvokeError::from(error.to_string()))?;
    fetch_fileq_stats_payload(&data_dir).map_err(|error| InvokeError::from(error.to_string()))
}

fn start_php_server(app: &tauri::AppHandle) -> Result<String, DynError> {
    let root_dir = runtime_root(app)?;
    let resource_dir = resource_root(&root_dir);
    let port = pick_available_port()?;
    let log_path = startup_log_path(app)?;

    let mut log_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)?;
    writeln!(log_file, "== BELGESELSEMOFLIX startup ==")?;
    writeln!(log_file, "resource_dir={}", resource_dir.display())?;
    writeln!(log_file, "port={port}")?;

    let desktop_data_dir = desktop_data_dir(app)?;
    writeln!(log_file, "desktop_data_dir={}", desktop_data_dir.display())?;

    let webapp_dir = resolve_runtime_webapp_dir(&resource_dir, &desktop_data_dir, &mut log_file)?;
    writeln!(log_file, "webapp_dir={}", webapp_dir.display())?;

    let mut command = startup_command(&resource_dir, &webapp_dir, port, &mut log_file)?;
    let error_log = log_file.try_clone()?;
    command
        .env("BELGESELSEMOFLIX_LOG_PATH", &log_path)
        .env("BELGESELSEMOFLIX_DESKTOP_DATA_DIR", &desktop_data_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(error_log));

    let child = command.spawn()?;
    {
        let state = app.state::<AppState>();
        let mut guard = state.server_process.lock().expect("state lock bozuldu");
        *guard = Some(child);
    }

    if let Err(error) = wait_for_server(app, port) {
        stop_php_server(app);
        return Err(format!("{} (log: {})", error, log_path.display()).into());
    }

    let background_data_dir = desktop_data_dir.clone();
    let background_log_path = log_path.clone();
    thread::spawn(move || {
        if let Ok(mut log_file) = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&background_log_path)
        {
            if let Err(error) = prefetch_desktop_data(&background_data_dir, &mut log_file) {
                let _ = writeln!(log_file, "desktop_data_prefetch_failed={error}");
            } else {
                let _ = writeln!(log_file, "desktop_data_prefetch=ok");
            }

            if let Err(error) = prefetch_premium_cache(&background_data_dir, &mut log_file) {
                let _ = writeln!(log_file, "premium_prefetch_failed={error}");
            } else {
                let _ = writeln!(log_file, "premium_prefetch=ok");
            }

            if let Err(error) = prefetch_fileq_cache(&background_data_dir, &mut log_file) {
                let _ = writeln!(log_file, "fileq_prefetch_failed={error}");
            } else {
                let _ = writeln!(log_file, "fileq_prefetch=ok");
            }
        }
    });

    Ok(format!("http://{HOST}:{port}/index.php"))
}

fn stop_php_server(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    let mut guard = match state.server_process.lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };

    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn open_managed_url(
    _app: &tauri::AppHandle,
    url: Url,
    _title_hint: Option<String>,
) -> Result<(), DynError> {
    if !is_allowed_managed_url(&url) {
        return Err("yalnizca fileq.net ve play.google.com izinli".into());
    }

    open_in_system_browser(url.as_str())
}

fn sync_main_shell(app: &tauri::AppHandle) -> Result<(), DynError> {
    let window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or("shell penceresi bulunamadi")?;
    sync_shell(&window)
}

fn sync_shell(window: &WebviewWindow) -> Result<(), DynError> {
    sync_shell_webview(window.as_ref())
}

fn sync_shell_webview(webview: &Webview) -> Result<(), DynError> {
    let state = webview.app_handle().state::<AppState>();
    let shell = state.shell.lock().expect("state lock bozuldu");
    let snapshot = ShellSnapshot {
        app_title: APP_TITLE,
        footer_text: APP_FOOTER,
        status_title: shell.status_title.clone(),
        status_detail: shell.status_detail.clone(),
        home_url: shell.home_url.clone(),
        active_tab: shell.active_tab,
        home_tab_label: HOME_TAB_LABEL,
        managed_tab_label: shell
            .managed_title
            .clone()
            .unwrap_or_else(|| "Play Store".into()),
        managed_open: shell.managed_url.is_some(),
        managed_url: shell.managed_url.clone(),
        downloads_tab_label: DOWNLOAD_TAB_LABEL,
        downloads_url: shell.downloads_url.clone(),
        is_maximized: webview.window().is_maximized().unwrap_or(false),
    };
    drop(shell);

    let payload = serde_json::to_string(&snapshot)?;
    let script = format!(
        "window.__BELGESELSEMOFLIX_SHELL && window.__BELGESELSEMOFLIX_SHELL.sync({payload});"
    );
    webview.eval(&script)?;
    Ok(())
}

fn set_status(app: &tauri::AppHandle, title: &str, detail: &str) {
    let state = app.state::<AppState>();
    if let Ok(mut shell) = state.shell.lock() {
        shell.status_title = title.into();
        shell.status_detail = detail.into();
    }
    let _ = sync_main_shell(app);
}

fn is_allowed_managed_url(url: &Url) -> bool {
    if !matches!(url.scheme(), "http" | "https") {
        return false;
    }

    let Some(host) = url.host_str() else {
        return false;
    };

    host == "fileq.net" || host.ends_with(".fileq.net") || host == "play.google.com"
}

fn home_initialization_script() -> &'static str {
    r#"
(() => {
  const invoke = (cmd, args = {}) => {
    const internal = window.__TAURI_INTERNALS__;
    if (!internal || typeof internal.invoke !== 'function') {
      return Promise.reject(new Error('Tauri invoke bulunamadi'));
    }
    return internal.invoke(cmd, args);
  };

  const relayToShell = (payload) => {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'belgeselsemoflix-shell-command', payload }, '*');
        return Promise.resolve();
      }
    } catch (_) {}

    if (payload.command === 'desktop_open_managed_url') {
      return invoke('desktop_open_managed_url', payload.args || {});
    }

    return Promise.reject(new Error('Gecersiz shell komutu'));
  };

  const isAllowedManagedHost = (host) =>
    host === 'fileq.net' || host.endsWith('.fileq.net') || host === 'play.google.com';

  const managedTitleForHost = (host) => {
    if (host === 'play.google.com') {
      return 'Play Store';
    }
    if (host === 'fileq.net' || host.endsWith('.fileq.net')) {
      return 'Indirme';
    }
    return 'Harici Baglanti';
  };

  let playerPopupGuardActive = false;
  const originalWindowOpen = typeof window.open === 'function' ? window.open.bind(window) : null;

  const notifyBlockedPopup = () => {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({
          type: 'belgeselsemoflix-popup-blocked',
          message: "Harici reklam popup'u engellendi"
        }, '*');
      }
    } catch (_) {}
  };

  const tryHandleExternalUrl = (rawUrl) => {
    if (!rawUrl) {
      return false;
    }

    let parsed;
    try {
      parsed = new URL(String(rawUrl), window.location.href);
    } catch (_) {
      return false;
    }

    const host = parsed.hostname || '';
    if (!isAllowedManagedHost(host)) {
      return false;
    }

    relayToShell({
      command: 'desktop_open_managed_url',
      args: { url: parsed.toString(), titleHint: managedTitleForHost(host) }
    }).catch(() => {});
    return true;
  };

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object') {
      return;
    }

    if (data.type === 'belgeselsemoflix-player-popup-guard') {
      playerPopupGuardActive = !!data.active;
    }
  });

  window.open = function(url, ...args) {
    if (!playerPopupGuardActive) {
      return originalWindowOpen ? originalWindowOpen(url, ...args) : null;
    }

    if (tryHandleExternalUrl(url)) {
      return null;
    }

    notifyBlockedPopup();
    return null;
  };

  document.addEventListener('click', (event) => {
    if (!playerPopupGuardActive) {
      return;
    }

    const link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!link) {
      return;
    }

    const href = link.getAttribute('href');
    const target = (link.getAttribute('target') || '').toLowerCase();
    if (target !== '_blank' && !href) {
      return;
    }

    if (tryHandleExternalUrl(href)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    notifyBlockedPopup();
  }, true);

  window.__BELGESELSEMOFLIX_DESKTOP = {
    isDesktop: true,
    openManagedUrl(url, titleHint) {
      return relayToShell({
        command: 'desktop_open_managed_url',
        args: { url, titleHint }
      });
    },
    loadPersistentStorage() {
      return invoke('desktop_storage_load');
    },
    savePersistentStorage(entries) {
      return invoke('desktop_storage_save', { entries });
    },
    removePersistentStorage(keys) {
      return invoke('desktop_storage_remove', { keys });
    },
    fetchFileQFiles() {
      return invoke('desktop_fetch_fileq_files');
    },
    fetchFileQStats() {
      return invoke('desktop_fetch_fileq_stats');
    },
    openDownloads() {
      return Promise.resolve();
    }
  };
})();
"#
}

fn open_in_system_browser(url: &str) -> Result<(), DynError> {
    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("cmd");
        command
            .args(["/C", "start", "", url])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW);
        command.spawn()?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(url)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(url)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("bu platformda varsayilan tarayici acilamadi".into())
}

fn wait_for_server(app: &tauri::AppHandle, port: u16) -> Result<(), DynError> {
    let started_at = Instant::now();

    while started_at.elapsed() < STARTUP_TIMEOUT {
        if TcpStream::connect((HOST, port)).is_ok() {
            return Ok(());
        }

        {
            let state = app.state::<AppState>();
            let mut guard = state.server_process.lock().expect("state lock bozuldu");
            if let Some(child) = guard.as_mut() {
                if let Some(status) = child.try_wait()? {
                    return Err(format!("PHP server erken kapandi: {status}").into());
                }
            }
        }

        thread::sleep(Duration::from_millis(300));
    }

    Err("PHP server zamaninda ayaga kalkmadi".into())
}

fn pick_available_port() -> Result<u16, DynError> {
    for port in DEFAULT_PORT..=MAX_PORT {
        if TcpListener::bind((HOST, port)).is_ok() {
            return Ok(port);
        }
    }

    Err(format!(
        "{}-{} araliginda uygun bir localhost portu bulunamadi",
        DEFAULT_PORT, MAX_PORT
    )
    .into())
}

fn runtime_root(app: &tauri::AppHandle) -> Result<PathBuf, DynError> {
    if cfg!(debug_assertions) {
        return Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."));
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        if resource_dir.exists() {
            return Ok(resource_dir);
        }
    }

    let exe_path = env::current_exe()?;
    let exe_dir = exe_path
        .parent()
        .ok_or("calistirilabilir dosya klasoru bulunamadi")?;

    Ok(exe_dir.to_path_buf())
}

fn startup_log_path(app: &tauri::AppHandle) -> Result<PathBuf, DynError> {
    let mut log_dir = env::temp_dir();
    if let Ok(app_log_dir) = app.path().app_log_dir() {
        log_dir = app_log_dir;
    }

    fs::create_dir_all(&log_dir)?;
    Ok(log_dir.join("belgeselsemoflix-startup.log"))
}

fn resource_root(root_dir: &Path) -> PathBuf {
    let updater_dir = root_dir.join("_up_");
    let has_runtime_payload = updater_dir.join("webapp").exists()
        || updater_dir.join("runtime").exists()
        || updater_dir.join("run.bat").exists()
        || updater_dir.join("run.sh").exists()
        || updater_dir.join("run.command").exists();

    if updater_dir.exists() && has_runtime_payload {
        updater_dir
    } else {
        root_dir.to_path_buf()
    }
}

fn resolve_runtime_webapp_dir(
    resource_dir: &Path,
    desktop_data_dir: &Path,
    log_file: &mut std::fs::File,
) -> Result<PathBuf, DynError> {
    if let Some(override_dir) = env::var_os("BELGESELSEMOFLIX_WEBAPP_DIR").map(PathBuf::from) {
        writeln!(log_file, "env_webapp_dir={}", override_dir.display())?;
        if override_dir.join("index.php").is_file() {
            return Ok(override_dir);
        }
    }

    let direct_webapp_dir = resource_dir.join("webapp");
    if direct_webapp_dir.is_dir() {
        return Ok(direct_webapp_dir);
    }

    if let Some(parent) = resource_dir.parent() {
        let sibling_webapp_dir = parent.join("webapp");
        if sibling_webapp_dir.is_dir() {
            writeln!(log_file, "sibling_webapp_dir={}", sibling_webapp_dir.display())?;
            return Ok(sibling_webapp_dir);
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(recursive_webapp_dir) = locate_windows_webapp_dir(resource_dir) {
            writeln!(
                log_file,
                "recursive_webapp_dir={}",
                recursive_webapp_dir.display()
            )?;
            return Ok(recursive_webapp_dir);
        }

        return extract_windows_assets_pack(resource_dir, desktop_data_dir, log_file);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = desktop_data_dir;
        let _ = log_file;
        Err(format!("webapp klasoru bulunamadi: {}", direct_webapp_dir.display()).into())
    }
}

#[cfg(target_os = "windows")]
fn locate_windows_webapp_dir(resource_dir: &Path) -> Option<PathBuf> {
    let mut roots = vec![resource_dir.to_path_buf()];

    if let Some(parent) = resource_dir.parent() {
        roots.push(parent.to_path_buf());
    }

    if let Ok(exe_path) = env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            roots.push(exe_dir.to_path_buf());
        }
    }

    for root in roots {
        if let Ok(Some(index_path)) = find_file_recursive(&root, "index.php") {
            if let Some(parent) = index_path.parent() {
                if parent.file_name().and_then(|name| name.to_str()) == Some("webapp") {
                    return Some(parent.to_path_buf());
                }
            }
        }
    }

    None
}

#[cfg(target_os = "windows")]
fn extract_windows_assets_pack(
    resource_dir: &Path,
    desktop_data_dir: &Path,
    log_file: &mut std::fs::File,
) -> Result<PathBuf, DynError> {
    let pack_path = locate_windows_assets_pack(resource_dir)
        .ok_or_else(|| format!("webapp klasoru bulunamadi: {}", resource_dir.join("webapp").display()))?;

    let extract_root = desktop_data_dir.join("portable-runtime");
    let unpack_dir = extract_root.join("assets");
    let marker_path = extract_root.join("assets.marker");
    let metadata = fs::metadata(&pack_path)?;
    let marker_value = format!(
        "{}:{}",
        metadata.len(),
        metadata
            .modified()?
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
    );
    let extracted_webapp = unpack_dir.join("webapp");
    let marker_matches = fs::read_to_string(&marker_path)
        .map(|value| value == marker_value)
        .unwrap_or(false);

    if marker_matches && extracted_webapp.join("index.php").is_file() {
        writeln!(log_file, "assets_cache=hit")?;
        return Ok(extracted_webapp);
    }

    if unpack_dir.exists() {
        fs::remove_dir_all(&unpack_dir)?;
    }
    fs::create_dir_all(&extract_root)?;

    writeln!(log_file, "assets_pack={}", pack_path.display())?;
    writeln!(log_file, "assets_unpack_dir={}", unpack_dir.display())?;

    let archive_bytes = fs::read(&pack_path)?;
    let archive_cursor = Cursor::new(archive_bytes);
    let mut archive = match ZipArchive::new(archive_cursor) {
        Ok(archive) => archive,
        Err(error) => {
            writeln!(log_file, "assets_open_failed={error}")?;
            return Err("assets.pack acilamadi".into());
        }
    };
    if let Err(error) = extract_zip_archive(&mut archive, &unpack_dir) {
        writeln!(log_file, "assets_extract_failed={error}")?;
        if extracted_webapp.join("index.php").is_file() {
            writeln!(log_file, "assets_extract_fallback=using_existing_cache")?;
            return Ok(extracted_webapp);
        }
        return Err("assets.pack acilamadi".into());
    }

    if extracted_webapp.is_dir() {
        fs::write(marker_path, marker_value)?;
        return Ok(extracted_webapp);
    }

    if unpack_dir.join("index.php").is_file() {
        fs::write(marker_path, marker_value)?;
        return Ok(unpack_dir);
    }

    Err("assets.pack icinden webapp klasoru cikmadi".into())
}

#[cfg(target_os = "windows")]
fn extract_zip_archive<R: std::io::Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
    target_dir: &Path,
) -> Result<(), DynError> {
    fs::create_dir_all(target_dir)?;

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        let Some(relative_path) = entry.enclosed_name().map(|path| path.to_path_buf()) else {
            continue;
        };

        let output_path = target_dir.join(relative_path);
        if entry.name().ends_with('/') {
            fs::create_dir_all(&output_path)?;
            continue;
        }

        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent)?;
        }

        let mut output_file = File::create(&output_path)?;
        std::io::copy(&mut entry, &mut output_file)?;
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn locate_windows_assets_pack(resource_dir: &Path) -> Option<PathBuf> {
    let mut candidates = vec![resource_dir.join("assets.pack")];

    if let Some(parent) = resource_dir.parent() {
        candidates.push(parent.join("assets.pack"));
        candidates.push(parent.join("_up_").join("assets.pack"));
    }

    if let Ok(exe_path) = env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            candidates.push(exe_dir.join("assets.pack"));
            candidates.push(exe_dir.join("_up_").join("assets.pack"));
        }
    }

    if let Some(path) = candidates.into_iter().find(|path| path.is_file()) {
        return Some(path);
    }

    let mut roots = vec![resource_dir.to_path_buf()];

    if let Some(parent) = resource_dir.parent() {
        roots.push(parent.to_path_buf());
    }

    if let Ok(exe_path) = env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            roots.push(exe_dir.to_path_buf());
        }
    }

    for root in roots {
        if let Ok(Some(path)) = find_file_recursive(&root, "assets.pack") {
            return Some(path);
        }
    }

    None
}

#[cfg(target_os = "windows")]
fn ensure_windows_webview2_runtime() -> Result<(), DynError> {
    if windows_webview2_installed() {
        return Ok(());
    }

    let installer_path = env::temp_dir().join("belgeselsemoflix-webview2-bootstrapper.exe");
    let response = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(300))
        .build()?
        .get(WEBVIEW2_BOOTSTRAPPER_URL)
        .header(reqwest::header::USER_AGENT, "BELGESELSEMOFLIX Desktop")
        .send()?;

    if !response.status().is_success() {
        return Err(format!("WebView2 bootstrapper indirilemedi: HTTP {}", response.status()).into());
    }

    fs::write(&installer_path, response.bytes()?)?;

    let status = Command::new(&installer_path)
        .args(["/silent", "/install"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .status()?;

    let _ = fs::remove_file(&installer_path);

    if !status.success() && !windows_webview2_installed() {
        return Err("WebView2 Runtime kurulumu basarisiz oldu".into());
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn windows_webview2_installed() -> bool {
    for scope in ["HKLM", "HKCU"] {
        for key in [
            format!(
                r"{}\SOFTWARE\Microsoft\EdgeUpdate\Clients\{{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}}",
                scope
            ),
            format!(
                r"{}\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}}",
                scope
            ),
        ] {
            let output = Command::new("reg")
                .args(["query", &key, "/v", "pv"])
                .creation_flags(CREATE_NO_WINDOW)
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .output();

            if let Ok(output) = output {
                if output.status.success() && !output.stdout.is_empty() {
                    return true;
                }
            }
        }
    }

    for base in [
        env::var_os("ProgramFiles(x86)").map(PathBuf::from),
        env::var_os("ProgramFiles").map(PathBuf::from),
        env::var_os("LOCALAPPDATA").map(PathBuf::from),
    ]
    .into_iter()
    .flatten()
    {
        let candidate = base.join("Microsoft").join("EdgeWebView").join("Application");
        if webview_runtime_exists_in(&candidate) {
            return true;
        }
    }

    false
}

#[cfg(target_os = "windows")]
fn webview_runtime_exists_in(root: &Path) -> bool {
    find_file_recursive(root, "msedgewebview2.exe")
        .ok()
        .flatten()
        .is_some()
}

fn startup_script(root_dir: &Path) -> PathBuf {
    if cfg!(target_os = "windows") {
        root_dir.join("run.bat")
    } else if cfg!(target_os = "macos") {
        root_dir.join("run.command")
    } else {
        root_dir.join("run.sh")
    }
}

fn startup_command(
    resource_dir: &Path,
    webapp_dir: &Path,
    port: u16,
    log_file: &mut std::fs::File,
) -> Result<Command, DynError> {
    #[cfg(target_os = "windows")]
    {
        let script_path = startup_script(resource_dir);
        if !script_path.is_file() {
            return Err(format!("baslangic scripti bulunamadi: {}", script_path.display()).into());
        }

        let script_path = windows_compatible_path(&script_path);
        let resource_dir = windows_compatible_path(resource_dir);
        let webapp_dir = windows_compatible_path(webapp_dir);

        writeln!(log_file, "startup_script={}", script_path.display())?;
        writeln!(log_file, "windows_resource_dir={}", resource_dir.display())?;
        writeln!(log_file, "windows_webapp_dir={}", webapp_dir.display())?;
        let mut command = Command::new("cmd");
        command
            .args(["/C", "call"])
            .arg(script_path)
            .current_dir(&resource_dir)
            .creation_flags(CREATE_NO_WINDOW)
            .env("BELGESELSEMOFLIX_HOST", HOST)
            .env("BELGESELSEMOFLIX_PORT", port.to_string())
            .env("BELGESELSEMOFLIX_WEBAPP_DIR", webapp_dir);
        return Ok(command);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let script_path = startup_script(resource_dir);
        if !script_path.is_file() {
            return Err(format!("baslangic scripti bulunamadi: {}", script_path.display()).into());
        }

        writeln!(log_file, "startup_script={}", script_path.display())?;

        let mut command = Command::new("sh");
        command
            .arg(&script_path)
            .current_dir(resource_dir)
            .env("BELGESELSEMOFLIX_HOST", HOST)
            .env("BELGESELSEMOFLIX_PORT", port.to_string())
            .env("BELGESELSEMOFLIX_WEBAPP_DIR", webapp_dir);
        Ok(command)
    }
}

fn desktop_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, DynError> {
    if let Some(env_dir) = env::var_os("BELGESELSEMOFLIX_DESKTOP_DATA_DIR").map(PathBuf::from) {
        fs::create_dir_all(&env_dir)?;
        return Ok(env_dir);
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(local_app_data) = env::var_os("LOCALAPPDATA").map(PathBuf::from) {
            let data_dir = local_app_data
                .join("com.vesvese55x.belgeselsemoflix")
                .join("desktop-data");
            fs::create_dir_all(&data_dir)?;
            return Ok(data_dir);
        }
    }

    let mut data_dir = env::temp_dir().join("belgeselsemoflix-desktop-data");
    if let Ok(app_data_dir) = app.path().app_data_dir() {
        data_dir = app_data_dir.join("desktop-data");
    }
    fs::create_dir_all(&data_dir)?;
    Ok(data_dir)
}

fn desktop_storage_path(data_dir: &Path) -> PathBuf {
    data_dir.join("desktop-storage.json")
}

fn read_desktop_storage_map(data_dir: &Path) -> Result<HashMap<String, String>, DynError> {
    let path = desktop_storage_path(data_dir);
    if !path.is_file() {
        return Ok(HashMap::new());
    }

    let raw = fs::read_to_string(path)?;
    let entries = serde_json::from_str::<HashMap<String, String>>(&raw).unwrap_or_default();
    Ok(entries)
}

fn write_desktop_storage_map(
    data_dir: &Path,
    entries: &HashMap<String, String>,
) -> Result<(), DynError> {
    let path = desktop_storage_path(data_dir);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_vec_pretty(entries)?)?;
    Ok(())
}

fn load_desktop_storage_entries(data_dir: &Path) -> Result<Value, DynError> {
    let entries = read_desktop_storage_map(data_dir)?;
    Ok(json!({
        "success": true,
        "entries": entries
    }))
}

fn save_desktop_storage_entries(
    data_dir: &Path,
    entries: &HashMap<String, String>,
) -> Result<Value, DynError> {
    let mut current = read_desktop_storage_map(data_dir)?;
    for (key, value) in entries {
        current.insert(key.clone(), value.clone());
    }
    write_desktop_storage_map(data_dir, &current)?;
    Ok(json!({
        "success": true,
        "saved": entries.len()
    }))
}

fn remove_desktop_storage_entries(data_dir: &Path, keys: &[String]) -> Result<Value, DynError> {
    let mut current = read_desktop_storage_map(data_dir)?;
    for key in keys {
        current.remove(key);
    }
    write_desktop_storage_map(data_dir, &current)?;
    Ok(json!({
        "success": true,
        "removed": keys.len()
    }))
}

fn prefetch_desktop_data(data_dir: &Path, log_file: &mut std::fs::File) -> Result<(), DynError> {
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(60))
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|error| format!("HTTP istemcisi olusturulamadi: {error}"))?;

    for file in [
        "all_documentaries.json",
        "single_documentaries.json",
        "series_documentaries.json",
        "episodes.json",
        "categories.json",
        "download_links.json",
    ] {
        let url = format!("https://belgeselsemo.com.tr/php/data/{file}");
        writeln!(log_file, "prefetch={url}")?;
        let response = client
            .get(&url)
            .header(reqwest::header::ACCEPT, "application/json")
            .header(reqwest::header::USER_AGENT, "BELGESELSEMOFLIX Desktop")
            .send()?;
        if !response.status().is_success() {
            return Err(format!("{file} icin HTTP {}", response.status()).into());
        }
        let payload = response.text()?;
        fs::write(data_dir.join(file), payload)?;
    }

    Ok(())
}

fn prefetch_premium_cache(data_dir: &Path, log_file: &mut std::fs::File) -> Result<(), DynError> {
    let cache_dir = data_dir.join("premium-cache");
    fs::create_dir_all(&cache_dir)?;
    let cache_path = cache_dir.join("premium_users.json");
    let url = "https://belgeselsemo.com.tr/php/data/premium_users.json";

    writeln!(log_file, "prefetch={url}")?;

    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(60))
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|error| format!("Premium istemcisi olusturulamadi: {error}"))?;

    let response = client
        .get(url)
        .header(reqwest::header::ACCEPT, "application/json")
        .header(reqwest::header::USER_AGENT, "BELGESELSEMOFLIX Desktop")
        .send()?;

    if !response.status().is_success() {
        return Err(format!("premium_users.json icin HTTP {}", response.status()).into());
    }

    fs::write(cache_path, response.text()?)?;
    Ok(())
}

fn prefetch_fileq_cache(data_dir: &Path, log_file: &mut std::fs::File) -> Result<(), DynError> {
    let files = fetch_fileq_files_payload(data_dir)?;
    writeln!(
        log_file,
        "fileq_prefetch_files_success={}",
        files.get("success").and_then(Value::as_bool).unwrap_or(false)
    )?;

    let stats = fetch_fileq_stats_payload(data_dir)?;
    writeln!(
        log_file,
        "fileq_prefetch_stats_success={}",
        stats.get("success").and_then(Value::as_bool).unwrap_or(false)
    )?;
    Ok(())
}

fn fileq_cache_path(data_dir: &Path, name: &str) -> PathBuf {
    data_dir.join(name)
}

fn read_json_cache(path: &Path, allow_stale: bool) -> Option<Value> {
    let metadata = fs::metadata(path).ok()?;
    if !allow_stale {
        let modified = metadata.modified().ok()?;
        let age = modified.elapsed().ok()?;
        if age > FILEQ_CACHE_TTL {
            return None;
        }
    }

    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn write_json_cache(path: &Path, payload: &Value) -> Result<(), DynError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_vec_pretty(payload)?)?;
    Ok(())
}

fn fileq_client(timeout_secs: u64) -> Result<reqwest::blocking::Client, DynError> {
    reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(timeout_secs))
        .build()
        .map_err(|error| format!("FileQ istemcisi olusturulamadi: {error}").into())
}

fn fileq_error_payload(message: &str, diagnostic: Option<String>) -> Value {
    json!({
        "success": false,
        "error": message,
        "error_code": "fileq_unreachable",
        "diagnostic": diagnostic,
        "files": []
    })
}

fn format_file_size(bytes: u64) -> String {
    if bytes >= 1_073_741_824 {
        format!("{:.2} GB", bytes as f64 / 1_073_741_824.0)
    } else if bytes >= 1_048_576 {
        format!("{:.2} MB", bytes as f64 / 1_048_576.0)
    } else if bytes >= 1024 {
        format!("{:.2} KB", bytes as f64 / 1024.0)
    } else {
        format!("{bytes} bytes")
    }
}

fn fetch_fileq_stats_payload(data_dir: &Path) -> Result<Value, DynError> {
    let cache_path = fileq_cache_path(data_dir, "fileq-stats-cache.json");
    if let Some(cached) = read_json_cache(&cache_path, false) {
        return Ok(cached);
    }

    let client = fileq_client(20)?;
    let response = client
        .get(FILEQ_STATS_URL)
        .query(&[("key", FILEQ_API_KEY)])
        .header(reqwest::header::ACCEPT, "application/json")
        .header(reqwest::header::USER_AGENT, "BELGESELSEMOFLIX Desktop")
        .send();

    match response {
        Ok(response) if response.status().is_success() => {
            let payload: Value = serde_json::from_str(&response.text()?)?;
            let normalized = json!({
                "success": true,
                "result": payload.get("result").cloned().unwrap_or(payload)
            });
            write_json_cache(&cache_path, &normalized)?;
            Ok(normalized)
        }
        Ok(response) => {
            if let Some(cached) = read_json_cache(&cache_path, true) {
                return Ok(cached);
            }
            Ok(fileq_error_payload(
                "FileQ istatistikleri alınamadı.",
                Some(format!("HTTP {}", response.status())),
            ))
        }
        Err(error) => {
            if let Some(cached) = read_json_cache(&cache_path, true) {
                return Ok(cached);
            }
            Ok(fileq_error_payload(
                "FileQ istatistikleri alınamadı.",
                Some(error.to_string()),
            ))
        }
    }
}

fn fetch_fileq_files_payload(data_dir: &Path) -> Result<Value, DynError> {
    let cache_path = fileq_cache_path(data_dir, "fileq-files-cache.json");
    if let Some(cached) = read_json_cache(&cache_path, false) {
        return Ok(cached);
    }

    let client = fileq_client(30)?;
    let mut page = 1_u64;
    let per_page = 100_u64;
    let mut collected = Vec::new();
    let mut results_total = None;

    loop {
        let response = client
            .get(FILEQ_API_URL)
            .query(&[
                ("key", FILEQ_API_KEY),
                ("page", &page.to_string()),
                ("per_page", &per_page.to_string()),
                ("public", "1"),
            ])
            .header(reqwest::header::ACCEPT, "application/json")
            .header(reqwest::header::USER_AGENT, "BELGESELSEMOFLIX Desktop")
            .send();

        let response = match response {
            Ok(response) if response.status().is_success() => response,
            Ok(response) => {
                if let Some(cached) = read_json_cache(&cache_path, true) {
                    return Ok(cached);
                }
                return Ok(fileq_error_payload(
                    "FileQ dosyaları yüklenemedi.",
                    Some(format!("HTTP {}", response.status())),
                ));
            }
            Err(error) => {
                if let Some(cached) = read_json_cache(&cache_path, true) {
                    return Ok(cached);
                }
                return Ok(fileq_error_payload(
                    "FileQ dosyaları yüklenemedi.",
                    Some(error.to_string()),
                ));
            }
        };

        let payload: Value = serde_json::from_str(&response.text()?)?;
        let result = payload
            .get("result")
            .and_then(Value::as_object)
            .ok_or("FileQ API beklenen formatta yanit vermedi")?;

        let files = result
            .get("files")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();

        if results_total.is_none() {
            results_total = result.get("results_total").and_then(Value::as_u64);
        }

        collected.extend(files);

        if let Some(total) = results_total {
            if collected.len() as u64 >= total {
                break;
            }
        }

        if page >= 100 || collected.is_empty() {
            break;
        }

        page += 1;
    }

    if collected.is_empty() {
        if let Some(cached) = read_json_cache(&cache_path, true) {
            return Ok(cached);
        }
        return Ok(fileq_error_payload(
            "FileQ dosyaları yüklenemedi veya hiç dosya bulunamadı.",
            Some("Bos sonuc dondu".into()),
        ));
    }

    let mut processed_files: Vec<Value> = collected
        .into_iter()
        .map(|file: Value| {
            let name = file
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let file_code = file
                .get("file_code")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let size = file.get("size").and_then(Value::as_u64).unwrap_or(0);
            let downloads = file.get("downloads").and_then(Value::as_u64).unwrap_or(0);
            let uploaded = file
                .get("uploaded")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();

            json!({
                "name": name,
                "file_code": file_code,
                "link": file.get("link").cloned().unwrap_or(Value::Null),
                "download_link": format!("https://fileq.net/{}.html", file.get("file_code").and_then(Value::as_str).unwrap_or_default()),
                "size": size,
                "size_formatted": format_file_size(size),
                "downloads": downloads,
                "thumbnail": file.get("thumbnail").cloned().unwrap_or(Value::Null),
                "public": file.get("public").and_then(Value::as_i64).unwrap_or(0) == 1,
                "folder_id": file.get("fld_id").cloned().unwrap_or(Value::Null),
                "uploaded": uploaded,
                "uploaded_timestamp": file.get("uploaded").and_then(Value::as_str).and_then(|value| chrono_like_timestamp(value)),
            })
        })
        .collect();

    processed_files.sort_by(|a: &Value, b: &Value| {
        let left = a.get("name").and_then(Value::as_str).unwrap_or_default().to_lowercase();
        let right = b.get("name").and_then(Value::as_str).unwrap_or_default().to_lowercase();
        left.cmp(&right)
    });

    let total_size = processed_files
        .iter()
        .filter_map(|file: &Value| file.get("size").and_then(Value::as_u64))
        .sum::<u64>();
    let total_downloads = processed_files
        .iter()
        .filter_map(|file: &Value| file.get("downloads").and_then(Value::as_u64))
        .sum::<u64>();

    let payload = json!({
        "success": true,
        "stats": {
            "total_files": processed_files.len(),
            "total_size": total_size,
            "total_size_formatted": format_file_size(total_size),
            "total_downloads": total_downloads
        },
        "files": processed_files
    });

    write_json_cache(&cache_path, &payload)?;
    Ok(payload)
}

fn chrono_like_timestamp(value: &str) -> Option<i64> {
    let normalized = value.replace('/', "-");
    let mut parts = normalized.split_whitespace();
    let date = parts.next()?;
    let time = parts.next().unwrap_or("00:00:00");
    let mut date_parts = date.split('-');
    let year = date_parts.next()?.parse::<i32>().ok()?;
    let month = date_parts.next()?.parse::<u32>().ok()?;
    let day = date_parts.next()?.parse::<u32>().ok()?;
    let mut time_parts = time.split(':');
    let hour = time_parts.next()?.parse::<u32>().ok()?;
    let minute = time_parts.next()?.parse::<u32>().ok()?;
    let second = time_parts.next().unwrap_or("0").parse::<u32>().ok()?;

    let days_from_civil = |year: i32, month: u32, day: u32| -> i64 {
        let year = year - if month <= 2 { 1 } else { 0 };
        let era = if year >= 0 { year } else { year - 399 } / 400;
        let yoe = year - era * 400;
        let month = month as i32;
        let doy = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day as i32 - 1;
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        (era * 146097 + doe - 719468) as i64
    };

    let days = days_from_civil(year, month, day);
    Some(days * 86_400 + hour as i64 * 3600 + minute as i64 * 60 + second as i64)
}

#[cfg(target_os = "windows")]
fn resolve_windows_php(resource_dir: &Path) -> Result<PathBuf, DynError> {
    let bundled_root = resource_dir.join("runtime").join("windows");
    if bundled_root.exists() {
        if let Some(path) = find_file_recursive(&bundled_root, "php.exe")? {
            return Ok(path);
        }
    }

    let output = Command::new("where").arg("php").output()?;
    if !output.status.success() {
        return Err("Windows uzerinde php.exe bulunamadi".into());
    }

    let where_output = String::from_utf8_lossy(&output.stdout).into_owned();
    let path = where_output
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .ok_or("where php cikti vermedi")?;
    Ok(PathBuf::from(path))
}

#[cfg(target_os = "windows")]
fn find_file_recursive(root: &Path, filename: &str) -> Result<Option<PathBuf>, DynError> {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };

    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_file_recursive(&path, filename)? {
                return Ok(Some(found));
            }
        } else if path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.eq_ignore_ascii_case(filename))
        {
            return Ok(Some(path));
        }
    }

    Ok(None)
}

#[cfg(target_os = "windows")]
fn windows_path_with_php(php_dir: &Path) -> Result<std::ffi::OsString, DynError> {
    let mut combined = php_dir.as_os_str().to_os_string();
    if let Some(existing) = env::var_os("PATH") {
        combined.push(";");
        combined.push(existing);
    }
    Ok(combined)
}

#[cfg(target_os = "windows")]
fn windows_compatible_path(path: &Path) -> PathBuf {
    let raw = path.to_string_lossy();

    if let Some(stripped) = raw.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{stripped}"));
    }

    if let Some(stripped) = raw.strip_prefix(r"\\?\") {
        return PathBuf::from(stripped);
    }

    if let Some(stripped) = raw.strip_prefix(r"\??\") {
        return PathBuf::from(stripped);
    }

    path.to_path_buf()
}
