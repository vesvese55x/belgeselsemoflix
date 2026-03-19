#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    env,
    error::Error,
    fs::{self, OpenOptions},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

const APP_TITLE: &str = "BELGESELSEMOFLIX 1.0";
const HOST: &str = "127.0.0.1";
const DEFAULT_PORT: u16 = 8000;
const MAX_PORT: u16 = 8100;
const STARTUP_TIMEOUT: Duration = Duration::from_secs(600);

type DynError = Box<dyn Error + Send + Sync>;

struct AppState {
    server_process: Mutex<Option<Child>>,
}

fn main() {
    let app = tauri::Builder::default()
        .manage(AppState {
            server_process: Mutex::new(None),
        })
        .setup(|app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title(APP_TITLE)
                .inner_size(1440.0, 900.0)
                .resizable(true)
                .build()?;

            let app_handle = app.handle().clone();
            thread::spawn(move || {
                match start_php_server(&app_handle) {
                    Ok(url) => {
                        if let Some(status_window) = app_handle.get_webview_window("main") {
                            let script = format!(
                                "window.__BELGESELSEMOFLIX_SET_STATUS && window.__BELGESELSEMOFLIX_SET_STATUS('Hazir', 'Arayuz yukleniyor...'); window.location.replace({});",
                                js_string(&url)
                            );
                            let _ = status_window.eval(&script);
                        }
                    }
                    Err(error) => {
                        let detail = format!("{}\n\nDetaylar icin uygulama loglarini kontrol edin.", error);
                        let script = format!(
                            "window.__BELGESELSEMOFLIX_SET_STATUS && window.__BELGESELSEMOFLIX_SET_STATUS('Baslatma Hatasi', {});",
                            js_string(&detail)
                        );
                        if let Some(status_window) = app_handle.get_webview_window("main") {
                            let _ = status_window.eval(&script);
                        }
                    }
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

fn start_php_server(app: &tauri::AppHandle) -> Result<String, DynError> {
    let root_dir = runtime_root(app)?;
    let resource_dir = resource_root(&root_dir);
    let webapp_dir = resource_dir.join("webapp");
    let script_path = startup_script(&resource_dir);
    let port = pick_available_port()?;
    let log_path = startup_log_path(app)?;

    if !webapp_dir.is_dir() {
        return Err(format!("webapp klasoru bulunamadi: {}", webapp_dir.display()).into());
    }

    if !script_path.is_file() {
        return Err(format!("baslangic scripti bulunamadi: {}", script_path.display()).into());
    }

    let mut command = platform_command(&script_path);
    let log_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)?;
    let error_log = log_file.try_clone()?;
    command
        .current_dir(&resource_dir)
        .env("BELGESELSEMOFLIX_HOST", HOST)
        .env("BELGESELSEMOFLIX_PORT", port.to_string())
        .env("BELGESELSEMOFLIX_WEBAPP_DIR", &webapp_dir)
        .env("BELGESELSEMOFLIX_LOG_PATH", &log_path)
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

fn platform_command(script_path: &Path) -> Command {
    if cfg!(target_os = "windows") {
        let mut command = Command::new("cmd");
        command.arg("/C").arg(script_path);
        command
    } else {
        let mut command = Command::new("sh");
        command.arg(script_path);
        command
    }
}

fn js_string(value: &str) -> String {
    format!("{value:?}")
}
