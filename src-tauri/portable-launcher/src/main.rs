#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "windows")]
mod launcher {
    use std::{
        env,
        error::Error,
        fs::{self, File},
        path::{Path, PathBuf},
        process::{Command, Stdio},
        time::{Duration, UNIX_EPOCH},
    };

    use reqwest::blocking::Client;
    use rfd::{MessageButtons, MessageDialog, MessageLevel};
    use zip::ZipArchive;

    #[cfg(target_os = "windows")]
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const WEBVIEW2_BOOTSTRAPPER_URL: &str = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";

    type DynError = Box<dyn Error + Send + Sync>;

    pub fn run() -> Result<(), DynError> {
        let exe_path = env::current_exe()?;
        let exe_dir = exe_path.parent().ok_or("Portable klasoru bulunamadi")?;
        let core_exe = exe_dir.join("core.exe");
        let assets_pack = exe_dir.join("assets.pack");

        if !core_exe.is_file() {
            return Err(format!("Portable cekirdek exe bulunamadi: {}", core_exe.display()).into());
        }
        if !assets_pack.is_file() {
            return Err(format!("assets.pack bulunamadi: {}", assets_pack.display()).into());
        }

        ensure_windows_webview2_runtime()?;

        let desktop_data_dir = portable_desktop_data_dir()?;
        let webapp_dir = ensure_assets_extracted(&assets_pack, &desktop_data_dir)?;

        Command::new(&core_exe)
            .current_dir(exe_dir)
            .env("BELGESELSEMOFLIX_WEBAPP_DIR", &webapp_dir)
            .env("BELGESELSEMOFLIX_DESKTOP_DATA_DIR", &desktop_data_dir)
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()?;

        Ok(())
    }

    fn portable_desktop_data_dir() -> Result<PathBuf, DynError> {
        let base = env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(env::temp_dir);
        let path = base
            .join("com.vesvese55x.belgeselsemoflix")
            .join("desktop-data");
        fs::create_dir_all(&path)?;
        Ok(path)
    }

    fn ensure_assets_extracted(pack_path: &Path, desktop_data_dir: &Path) -> Result<PathBuf, DynError> {
        let runtime_root = desktop_data_dir.join("portable-runtime");
        let unpack_dir = runtime_root.join("assets");
        let marker_path = runtime_root.join("assets.marker");
        fs::create_dir_all(&runtime_root)?;

        let metadata = fs::metadata(pack_path)?;
        let marker_value = marker_value(&metadata)?;

        let extracted_webapp = unpack_dir.join("webapp");
        let marker_matches = fs::read_to_string(&marker_path)
            .map(|value| value == marker_value)
            .unwrap_or(false);

        if marker_matches && extracted_webapp.join("index.php").is_file() {
            return Ok(extracted_webapp);
        }

        if unpack_dir.exists() {
            fs::remove_dir_all(&unpack_dir)?;
        }
        fs::create_dir_all(&unpack_dir)?;

        let archive_bytes = fs::read(pack_path)?;
        let archive_cursor = std::io::Cursor::new(archive_bytes);
        let mut archive = ZipArchive::new(archive_cursor)?;
        extract_zip_archive(&mut archive, &unpack_dir)?;

        if !extracted_webapp.join("index.php").is_file() {
            return Err("assets.pack icinden webapp klasoru cikmadi".into());
        }

        fs::write(marker_path, marker_value)?;
        Ok(extracted_webapp)
    }

    fn ensure_windows_webview2_runtime() -> Result<(), DynError> {
        if windows_webview2_installed() {
            return Ok(());
        }

        let _ = MessageDialog::new()
            .set_level(MessageLevel::Info)
            .set_title("BELGESELSEMOFLIX")
            .set_description(
                "WebView2 Runtime bulunamadı.\nGerekli bileşen şimdi arka planda indirilecek ve kurulacak.\nBu işlem 1-2 dk sürebilir. Lütfen bekleyiniz.",
            )
            .set_buttons(MessageButtons::Ok)
            .show();

        let installer_path = env::temp_dir().join("belgeselsemoflix-webview2-bootstrapper.exe");
        let response = Client::builder()
            .connect_timeout(Duration::from_secs(20))
            .timeout(Duration::from_secs(300))
            .build()?
            .get(WEBVIEW2_BOOTSTRAPPER_URL)
            .header(reqwest::header::USER_AGENT, "BELGESELSEMOFLIX Portable Launcher")
            .send()?;

        if !response.status().is_success() {
            return Err(format!("WebView2 bootstrapper indirilemedi: HTTP {}", response.status()).into());
        }

        fs::write(&installer_path, response.bytes()?)?;

        let status = Command::new(&installer_path)
            .args(["/silent", "/install"])
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()?;

        let _ = fs::remove_file(&installer_path);

        if !status.success() && !windows_webview2_installed() {
            return Err("WebView2 Runtime kurulumu basarisiz oldu".into());
        }

        let _ = MessageDialog::new()
            .set_level(MessageLevel::Info)
            .set_title("BELGESELSEMOFLIX")
            .set_description("WebView2 Runtime kurulumu tamamlandı. Uygulama başlatılıyor.")
            .set_buttons(MessageButtons::Ok)
            .show();

        Ok(())
    }

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
            env::var_os("PROGRAMW6432").map(PathBuf::from),
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

    fn webview_runtime_exists_in(root: &Path) -> bool {
        find_file_recursive(root, "msedgewebview2.exe").is_some()
    }

    fn marker_value(metadata: &fs::Metadata) -> Result<String, DynError> {
        let modified = metadata
            .modified()?
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        Ok(format!("{}:{modified}", metadata.len()))
    }

    pub fn show_error(error: &str) {
        let _ = MessageDialog::new()
            .set_level(MessageLevel::Error)
            .set_title("BELGESELSEMOFLIX")
            .set_description(error)
            .set_buttons(MessageButtons::Ok)
            .show();
    }

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

    fn find_file_recursive(root: &Path, filename: &str) -> Option<PathBuf> {
        let entries = fs::read_dir(root).ok()?;

        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if path.file_name().and_then(|name| name.to_str()) == Some(filename) {
                    return Some(path);
                }
            } else if path.is_dir() {
                if let Some(found) = find_file_recursive(&path, filename) {
                    return Some(found);
                }
            }
        }

        None
    }
}

#[cfg(target_os = "windows")]
fn main() {
    if let Err(error) = launcher::run() {
        launcher::show_error(&error.to_string());
        std::process::exit(1);
    }
}

#[cfg(not(target_os = "windows"))]
fn main() {
    eprintln!("portable launcher sadece Windows icindir");
    std::process::exit(1);
}
