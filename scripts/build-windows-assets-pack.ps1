param(
    [string]$SourceDir = "webapp",
    [string]$OutPath = "dist/windows-portable/assets.pack"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $root $SourceDir
$outPath = Join-Path $root $OutPath
$stageRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("belgeselsemoflix-assets-" + [guid]::NewGuid().ToString("N"))
$stagePayload = Join-Path $stageRoot "payload"
$stageWebapp = Join-Path $stagePayload "webapp"

if (-not (Test-Path $sourcePath)) {
    throw "Kaynak webapp klasoru bulunamadi: $sourcePath"
}

New-Item -ItemType Directory -Force -Path $stageWebapp | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $outPath) | Out-Null

try {
    Copy-Item (Join-Path $sourcePath "*") $stageWebapp -Recurse -Force

    if (Test-Path $outPath) {
        Remove-Item $outPath -Force
    }

    Compress-Archive -Path (Join-Path $stagePayload "*") -DestinationPath $outPath -CompressionLevel Optimal
    Write-Host "assets.pack olusturuldu: $outPath"
}
finally {
    if (Test-Path $stageRoot) {
        Remove-Item $stageRoot -Recurse -Force
    }
}
