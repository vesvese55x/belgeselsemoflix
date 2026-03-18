#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    env,
    error::Error,
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
const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);

struct AppState {
    server_process: Mutex<Option<Child>>,
}

fn main() {
    let app = tauri::Builder::default()
        .manage(AppState {
            server_process: Mutex::new(None),
        })
        .setup(|app| {
            let url = start_php_server(app.handle())?;

            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url::Url::parse(&url)?))
                .title(APP_TITLE)
                .inner_size(1440.0, 900.0)
                .resizable(true)
                .build()?;

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

fn start_php_server(app: &tauri::AppHandle) -> Result<String, Box<dyn Error>> {
    let root_dir = runtime_root(app)?;
    let webapp_dir = root_dir.join("webapp");
    let script_path = startup_script(&root_dir);
    let port = pick_available_port()?;

    if !webapp_dir.is_dir() {
        return Err(format!("webapp klasoru bulunamadi: {}", webapp_dir.display()).into());
    }

    if !script_path.is_file() {
        return Err(format!("baslangic scripti bulunamadi: {}", script_path.display()).into());
    }

    let mut command = platform_command(&script_path);
    command
        .current_dir(&root_dir)
        .env("BELGESELSEMOFLIX_HOST", HOST)
        .env("BELGESELSEMOFLIX_PORT", port.to_string())
        .env("BELGESELSEMOFLIX_WEBAPP_DIR", &webapp_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let child = command.spawn()?;
    {
        let state = app.state::<AppState>();
        let mut guard = state.server_process.lock().expect("state lock bozuldu");
        *guard = Some(child);
    }

    wait_for_server(app, port)?;
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

fn wait_for_server(app: &tauri::AppHandle, port: u16) -> Result<(), Box<dyn Error>> {
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

fn pick_available_port() -> Result<u16, Box<dyn Error>> {
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

fn runtime_root(app: &tauri::AppHandle) -> Result<PathBuf, Box<dyn Error>> {
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
