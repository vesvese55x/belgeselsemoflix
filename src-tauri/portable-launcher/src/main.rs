#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "windows")]
mod launcher {
    use std::{
        env,
        error::Error,
        fs::{self, File},
        io::{Read, Write},
        path::{Path, PathBuf},
        process::{Command, Stdio},
        thread,
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

        let status_dir = env::temp_dir().join("belgeselsemoflix-webview2-status");
        fs::create_dir_all(&status_dir)?;
        let status_file = status_dir.join(format!(
            "status-{}-{}.txt",
            std::process::id(),
            UNIX_EPOCH.elapsed().unwrap_or_default().as_millis()
        ));
        fs::write(
            &status_file,
            "STATE|WebView2 indiriliyor...\nLütfen bekleyiniz.\nAnlayışınız için çok teşekkür ederiz.",
        )?;
        let status_window = start_webview2_status_window(&status_file);
        let installer_path = env::temp_dir().join(format!(
            "belgeselsemoflix-webview2-bootstrapper-{}-{}.exe",
            std::process::id(),
            UNIX_EPOCH.elapsed().unwrap_or_default().as_millis()
        ));

        let install_result: Result<(), DynError> = (|| {
            let _ = remove_file_with_retries(&installer_path);
            let mut response = Client::builder()
                .connect_timeout(Duration::from_secs(20))
                .timeout(Duration::from_secs(300))
                .build()?
                .get(WEBVIEW2_BOOTSTRAPPER_URL)
                .header(reqwest::header::USER_AGENT, "BELGESELSEMOFLIX Portable Launcher")
                .send()?;

            if !response.status().is_success() {
                return Err(format!(
                    "WebView2 bootstrapper indirilemedi: HTTP {}",
                    response.status()
                )
                .into());
            }

            let total_bytes = response.content_length();
            let mut installer_file = File::create(&installer_path)?;
            let mut downloaded_bytes: u64 = 0;
            let mut buffer = [0u8; 64 * 1024];
            let mut next_update_percent = 0u64;

            loop {
                let read = response.read(&mut buffer)?;
                if read == 0 {
                    break;
                }

                installer_file.write_all(&buffer[..read])?;
                downloaded_bytes += read as u64;

                if let Some(total) = total_bytes {
                    if total > 0 {
                        let percent = ((downloaded_bytes.saturating_mul(100)) / total).min(100);
                        if percent >= next_update_percent {
                            write_webview2_status(
                                &status_file,
                                &format!(
                                    "WebView2 indiriliyor... %{percent}\nLütfen bekleyiniz.\nAnlayışınız için çok teşekkür ederiz."
                                ),
                                Some(percent),
                            );
                            next_update_percent = percent.saturating_add(20);
                        }
                    }
                }
            }

            installer_file.flush()?;
            drop(installer_file);

            write_webview2_status(
                &status_file,
                "WebView2 kuruluyor...\nBu işlem 1-2 dk sürebilir. Lütfen bekleyiniz.\nAnlayışınız için çok teşekkür ederiz.",
                None,
            );

            let status = Command::new(&installer_path)
                .args(["/silent", "/install"])
                .creation_flags(CREATE_NO_WINDOW)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()?;

            write_webview2_status(
                &status_file,
                "Kurulum doğrulanıyor...\nLütfen bekleyiniz.\nAnlayışınız için çok teşekkür ederiz.",
                None,
            );

            let _ = remove_file_with_retries(&installer_path);

            if !status.success() && !windows_webview2_installed() {
                return Err("WebView2 Runtime kurulumu basarisiz oldu".into());
            }

            Ok(())
        })();

        match &install_result {
            Ok(_) => {
                let _ = fs::write(
                    &status_file,
                    "DONE|WebView2 Runtime kurulumu tamamlandı.\nUygulama başlatılıyor.",
                );
            }
            Err(error) => {
                let _ = fs::write(
                    &status_file,
                    format!("DONE|{}\nLütfen yeniden deneyiniz.", error),
                );
            }
        }

        if let Some(handle) = status_window {
            let _ = handle.join();
        }
        let _ = fs::remove_file(&status_file);
        let _ = remove_file_with_retries(&installer_path);

        install_result
    }

    fn write_webview2_status(path: &Path, message: &str, percent: Option<u64>) {
        let payload = match percent {
            Some(percent) => format!("PROGRESS|{percent}|{message}"),
            None => format!("STATE|{message}"),
        };
        let _ = fs::write(path, payload);
    }

    fn start_webview2_status_window(status_file: &Path) -> Option<thread::JoinHandle<()>> {
        let script = format!(
            r#"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$statusFile = "{status_file}"

function Read-SharedText([string]$path) {{
    if (-not (Test-Path $path)) {{
        return $null
    }}

    $fileStream = [System.IO.File]::Open(
        $path,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::ReadWrite
    )
    try {{
        $reader = New-Object System.IO.StreamReader($fileStream, [System.Text.Encoding]::UTF8, $true)
        try {{
            return $reader.ReadToEnd()
        }} finally {{
            $reader.Dispose()
        }}
    }} finally {{
        $fileStream.Dispose()
    }}
}}

$form = New-Object System.Windows.Forms.Form
$form.Text = "BELGESELSEMOFLIX"
$form.StartPosition = "CenterScreen"
$form.Size = New-Object System.Drawing.Size(470, 242)
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.TopMost = $true
$form.BackColor = [System.Drawing.Color]::FromArgb(28,28,30)
$form.ForeColor = [System.Drawing.Color]::White

$title = New-Object System.Windows.Forms.Label
$title.Text = "WebView2 Runtime Hazırlanıyor"
$title.Font = New-Object System.Drawing.Font("Segoe UI", 14, [System.Drawing.FontStyle]::Bold)
$title.AutoSize = $false
$title.Size = New-Object System.Drawing.Size(410, 30)
$title.Location = New-Object System.Drawing.Point(24, 22)
$title.ForeColor = [System.Drawing.Color]::White
$form.Controls.Add($title)

$message = New-Object System.Windows.Forms.Label
$message.Text = "Lütfen bekleyiniz."
$message.Font = New-Object System.Drawing.Font("Segoe UI", 10)
$message.AutoSize = $false
$message.Size = New-Object System.Drawing.Size(410, 82)
$message.Location = New-Object System.Drawing.Point(24, 62)
$message.ForeColor = [System.Drawing.Color]::Gainsboro
$form.Controls.Add($message)

$progress = New-Object System.Windows.Forms.ProgressBar
$progress.Style = "Marquee"
$progress.MarqueeAnimationSpeed = 25
$progress.Minimum = 0
$progress.Maximum = 100
$progress.Size = New-Object System.Drawing.Size(410, 18)
$progress.Location = New-Object System.Drawing.Point(24, 154)
$form.Controls.Add($progress)

$footer = New-Object System.Windows.Forms.Label
$footer.Text = "Anlayışınız için çok teşekkür ederiz.`r`n"
$footer.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$footer.AutoSize = $false
$footer.Size = New-Object System.Drawing.Size(410, 36)
$footer.Location = New-Object System.Drawing.Point(24, 180)
$footer.ForeColor = [System.Drawing.Color]::Silver
$form.Controls.Add($footer)

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 300
$timer.Add_Tick({{
    if (-not (Test-Path $statusFile)) {{
        return
    }}

    $content = Read-SharedText $statusFile
    if ([string]::IsNullOrWhiteSpace($content)) {{
        return
    }}

    if ($content.StartsWith("PROGRESS|")) {{
        $parts = $content.Split("|", 3)
        if ($parts.Length -eq 3) {{
            $percent = [int]$parts[1]
            $message.Text = $parts[2]
            $progress.Style = "Continuous"
            if ($percent -lt 0) {{ $percent = 0 }}
            if ($percent -gt 100) {{ $percent = 100 }}
            $progress.Value = $percent
        }}
    }} elseif ($content.StartsWith("STATE|")) {{
        $message.Text = $content.Substring(6)
        $progress.Style = "Marquee"
        $progress.MarqueeAnimationSpeed = 25
    }} elseif ($content.StartsWith("DONE|")) {{
        $message.Text = $content.Substring(5)
        $progress.Style = "Continuous"
        $progress.Value = 100
        $timer.Stop()
        $closeTimer = New-Object System.Windows.Forms.Timer
        $closeTimer.Interval = 1000
        $closeTimer.Add_Tick({{
            $closeTimer.Stop()
            $form.Close()
        }})
        $closeTimer.Start()
    }}
}})

$timer.Start()
[void]$form.ShowDialog()
"#,
            status_file = status_file.display()
        );

        let mut encoded = Vec::with_capacity(script.len() * 2);
        for unit in script.encode_utf16() {
            encoded.extend_from_slice(&unit.to_le_bytes());
        }
        let encoded_command = {
            use base64::Engine as _;
            base64::engine::general_purpose::STANDARD.encode(encoded)
        };

        let launched = Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-EncodedCommand",
                &encoded_command,
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();

        let mut child = match launched {
            Ok(child) => child,
            Err(_) => return None,
        };

        Some(thread::spawn(move || {
            let _ = child.wait();
        }))
    }

    fn remove_file_with_retries(path: &Path) -> Result<(), DynError> {
        if !path.exists() {
            return Ok(());
        }

        for _ in 0..10 {
            match fs::remove_file(path) {
                Ok(_) => return Ok(()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
                Err(_) => thread::sleep(Duration::from_millis(250)),
            }
        }

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
