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

    let mut command = startup_command(&resource_dir, &webapp_dir, port, &mut log_file)?;
    let error_log = log_file.try_clone()?;
    command
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

fn startup_command(
    resource_dir: &Path,
    webapp_dir: &Path,
    port: u16,
    log_file: &mut std::fs::File,
) -> Result<Command, DynError> {
    if cfg!(target_os = "windows") {
        let php_exe = resolve_windows_php(resource_dir)?;
        let php_dir = php_exe
            .parent()
            .ok_or("php klasoru bulunamadi")?
            .to_path_buf();

        writeln!(log_file, "php_exe={}", php_exe.display())?;
        writeln!(log_file, "php_dir={}", php_dir.display())?;

        let mut command = Command::new(&php_exe);
        command
            .current_dir(resource_dir)
            .env("PATH", windows_path_with_php(&php_dir)?)
            .arg("-n")
            .arg("-d")
            .arg("cli_server.color=0");

        command
            .arg("-S")
            .arg(format!("{HOST}:{port}"))
            .arg("-t")
            .arg(webapp_dir);
        return Ok(command);
    }

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

fn windows_path_with_php(php_dir: &Path) -> Result<std::ffi::OsString, DynError> {
    let mut combined = php_dir.as_os_str().to_os_string();
    if let Some(existing) = env::var_os("PATH") {
        combined.push(";");
        combined.push(existing);
    }
    Ok(combined)
}

fn js_string(value: &str) -> String {
    format!("{value:?}")
}
