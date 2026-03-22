param(
    [string]$ReleaseDir = "src-tauri/target/release",
    [string]$OutDir = "release-artifacts/windows-portable"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$releaseDir = Join-Path $root $ReleaseDir
$outDir = Join-Path $root $OutDir
$assetsPack = Join-Path $root "assets.pack"
$launcherExe = Join-Path $root "src-tauri/portable-launcher/target/release/portable_launcher.exe"
$runtimeWindows = Join-Path $root "runtime/windows"
$runBat = Join-Path $root "run.bat"
$coreExe = Join-Path $releaseDir "belgeselsemoflix.exe"

if (-not (Test-Path $coreExe)) {
    throw "Portable core exe bulunamadi: $coreExe"
}

if (-not (Test-Path $launcherExe)) {
    throw "Portable launcher bulunamadi: $launcherExe"
}

if (-not (Test-Path $assetsPack)) {
    throw "assets.pack bulunamadi: $assetsPack"
}

if (Test-Path $outDir) {
    Remove-Item $outDir -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $outDir | Out-Null

Copy-Item $launcherExe (Join-Path $outDir "belgeselsemoflix.exe") -Force
Copy-Item $coreExe (Join-Path $outDir "core.exe") -Force
Copy-Item $runBat (Join-Path $outDir "run.bat") -Force
Copy-Item $assetsPack (Join-Path $outDir "assets.pack") -Force

if (Test-Path $runtimeWindows) {
    $runtimeTarget = Join-Path $outDir "runtime/windows"
    New-Item -ItemType Directory -Force -Path $runtimeTarget | Out-Null
    Copy-Item (Join-Path $runtimeWindows "*") $runtimeTarget -Recurse -Force
    $portablePhpZip = Join-Path $runtimeTarget "php.zip"
    if (Test-Path $portablePhpZip) {
        Remove-Item $portablePhpZip -Force
    }
}

$dlls = Get-ChildItem $releaseDir -Filter *.dll -File -ErrorAction SilentlyContinue
foreach ($dll in $dlls) {
    Copy-Item $dll.FullName $outDir -Force
}

Write-Host "Portable paket hazirlandi: $outDir"
