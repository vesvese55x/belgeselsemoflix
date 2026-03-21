param(
    [string]$ReleaseDir = "src-tauri/target/release",
    [string]$OutDir = "release-artifacts/windows-portable"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$releaseDir = Join-Path $root $ReleaseDir
$outDir = Join-Path $root $OutDir
$assetsPack = Join-Path $root "dist/windows-portable/assets.pack"
$runtimeWindows = Join-Path $root "runtime/windows"
$runBat = Join-Path $root "run.bat"
$appExe = Join-Path $releaseDir "belgeselsemoflix.exe"

if (-not (Test-Path $appExe)) {
    throw "Portable exe bulunamadi: $appExe"
}

if (-not (Test-Path $assetsPack)) {
    throw "assets.pack bulunamadi: $assetsPack"
}

if (Test-Path $outDir) {
    Remove-Item $outDir -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $outDir | Out-Null

Copy-Item $appExe (Join-Path $outDir "BELGESELSEMOFLIX-Portable.exe") -Force
Copy-Item $assetsPack (Join-Path $outDir "assets.pack") -Force
Copy-Item $runBat (Join-Path $outDir "run.bat") -Force

if (Test-Path $runtimeWindows) {
    $runtimeTarget = Join-Path $outDir "runtime/windows"
    New-Item -ItemType Directory -Force -Path $runtimeTarget | Out-Null
    Copy-Item (Join-Path $runtimeWindows "*") $runtimeTarget -Recurse -Force
}

$dlls = Get-ChildItem $releaseDir -Filter *.dll -File -ErrorAction SilentlyContinue
foreach ($dll in $dlls) {
    Copy-Item $dll.FullName $outDir -Force
}

Write-Host "Portable paket hazirlandi: $outDir"
