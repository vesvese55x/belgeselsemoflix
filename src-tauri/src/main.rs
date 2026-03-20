#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
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

use serde::Serialize;
use tauri::{
    ipc::InvokeError, Manager, RunEvent, Webview, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use url::Url;

const APP_TITLE: &str = "BELGESELSEMOFLIX 1.0";
const APP_FOOTER: &str = "BELGESELSEMO.COM.TR";
const MAIN_WINDOW_LABEL: &str = "main";
const HOST: &str = "127.0.0.1";
const DEFAULT_PORT: u16 = 8000;
const MAX_PORT: u16 = 8100;
const STARTUP_TIMEOUT: Duration = Duration::from_secs(600);
const DOWNLOAD_TAB_LABEL: &str = "Indirmeler";
const HOME_TAB_LABEL: &str = "Ana Uygulama";
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

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
                status_title: "Hazirlaniyor...".into(),
                status_detail: "Yerel PHP sunucusu arka planda baslatiliyor.".into(),
                ..Default::default()
            }),
        })
        .invoke_handler(tauri::generate_handler![
            shell_ready,
            shell_minimize,
            shell_toggle_maximize,
            shell_close,
            shell_select_tab,
            desktop_open_managed_url
        ])
        .setup(|app| {
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
                        shell.status_title = "Hazir".into();
                        shell.status_detail = "Ana uygulama hazir.".into();
                        shell.active_tab = ActiveTab::Home;
                    }
                    let _ = sync_main_shell(&app_handle);
                }
                Err(error) => {
                    let detail = format!(
                        "{}\n\nDetaylar icin uygulama loglarini kontrol edin.",
                        error
                    );
                    set_status(&app_handle, "Baslatma Hatasi", &detail);
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

fn start_php_server(app: &tauri::AppHandle) -> Result<String, DynError> {
    let root_dir = runtime_root(app)?;
    let resource_dir = resource_root(&root_dir);
    let webapp_dir = resource_dir.join("webapp");
    let port = pick_available_port()?;
    let log_path = startup_log_path(app)?;

    if !webapp_dir.is_dir() {
        return Err(format!("webapp klasoru bulunamadi: {}", webapp_dir.display()).into());
    }

    let mut log_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)?;
    writeln!(log_file, "== BELGESELSEMOFLIX startup ==")?;
    writeln!(log_file, "resource_dir={}", resource_dir.display())?;
    writeln!(log_file, "webapp_dir={}", webapp_dir.display())?;
    writeln!(log_file, "port={port}")?;

    let desktop_data_dir = desktop_data_dir(app)?;
    writeln!(log_file, "desktop_data_dir={}", desktop_data_dir.display())?;

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
    app: &tauri::AppHandle,
    url: Url,
    title_hint: Option<String>,
) -> Result<(), DynError> {
    if !is_allowed_managed_url(&url) {
        return Err("yalnizca fileq.net ve play.google.com izinli".into());
    }

    let title = title_hint.unwrap_or_else(|| managed_label_for_url(&url));
    let host = url.host_str().unwrap_or_default().to_string();

    {
        let state = app.state::<AppState>();
        let mut shell = state.shell.lock().expect("state lock bozuldu");

        if host == "fileq.net" || host.ends_with(".fileq.net") {
            shell.downloads_url = Some(url.to_string());
            shell.active_tab = ActiveTab::Downloads;
        } else {
            shell.managed_url = Some(url.to_string());
            shell.managed_title = Some(title);
            shell.active_tab = ActiveTab::Managed;
        }
    }

    sync_main_shell(app)
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

fn managed_label_for_url(url: &Url) -> String {
    match url.host_str().unwrap_or_default() {
        "play.google.com" => "Play Store".into(),
        host if host == "fileq.net" || host.ends_with(".fileq.net") => "Indirme".into(),
        _ => "Ozel Sekme".into(),
    }
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
  const host = window.location.hostname || '';
  if (host === 'fileq.net' || host.endsWith('.fileq.net')) {
    window.open = () => null;
  }

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

    if (payload.command === 'shell_select_tab') {
      return invoke('shell_select_tab', payload.args || {});
    }

    return Promise.reject(new Error('Gecersiz shell komutu'));
  };

  window.__BELGESELSEMOFLIX_DESKTOP = {
    isDesktop: true,
    openManagedUrl(url, titleHint) {
      return relayToShell({
        command: 'desktop_open_managed_url',
        args: { url, titleHint }
      });
    },
    openDownloads() {
      return relayToShell({
        command: 'shell_select_tab',
        args: { tab: 'downloads' }
      });
    }
  };
})();
"#
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
    if updater_dir.exists() {
        updater_dir
    } else {
        root_dir.to_path_buf()
    }
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
        let php_exe = windows_compatible_path(&resolve_windows_php(resource_dir)?);
        let php_dir =
            windows_compatible_path(php_exe.parent().ok_or("php klasoru bulunamadi")?.as_ref());
        let resource_dir = windows_compatible_path(resource_dir);
        let webapp_dir = windows_compatible_path(webapp_dir);

        writeln!(log_file, "php_exe={}", php_exe.display())?;
        writeln!(log_file, "php_dir={}", php_dir.display())?;
        writeln!(log_file, "windows_resource_dir={}", resource_dir.display())?;
        writeln!(log_file, "windows_webapp_dir={}", webapp_dir.display())?;

        let php_ini = php_dir.join("php.ini");

        let mut command = Command::new(&php_exe);
        command
            .current_dir(&resource_dir)
            .env("PATH", windows_path_with_php(&php_dir)?)
            .creation_flags(CREATE_NO_WINDOW)
            .arg("-d")
            .arg("cli_server.color=0");

        if php_ini.is_file() {
            writeln!(log_file, "php_ini={}", php_ini.display())?;
            command.arg("-c").arg(&php_ini);
        } else {
            writeln!(log_file, "php_ini=none")?;
            command.arg("-n");
        }

        command
            .arg("-S")
            .arg(format!("{HOST}:{port}"))
            .arg("-t")
            .arg(webapp_dir);
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
    let mut data_dir = env::temp_dir().join("belgeselsemoflix-desktop-data");
    if let Ok(app_data_dir) = app.path().app_data_dir() {
        data_dir = app_data_dir.join("desktop-data");
    }
    fs::create_dir_all(&data_dir)?;
    Ok(data_dir)
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
