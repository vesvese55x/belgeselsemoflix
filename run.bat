@echo off
setlocal

set "HOST=%BELGESELSEMOFLIX_HOST%"
if "%HOST%"=="" set "HOST=127.0.0.1"

set "PORT=%BELGESELSEMOFLIX_PORT%"
if "%PORT%"=="" set "PORT=8000"

set "ROOT_DIR=%~dp0"
set "WEBAPP_DIR=%BELGESELSEMOFLIX_WEBAPP_DIR%"
if "%WEBAPP_DIR%"=="" set "WEBAPP_DIR=%ROOT_DIR%webapp"

if not exist "%WEBAPP_DIR%" (
  echo Web uygulama klasoru bulunamadi: %WEBAPP_DIR%
  exit /b 1
)

where php >nul 2>nul
if errorlevel 1 (
  echo PHP bulunamadi. Lutfen PHP'yi PATH'e ekleyin veya sisteminize kurun.
  exit /b 1
)

echo Server baslatiliyor: http://%HOST%:%PORT%/index.php
php -S %HOST%:%PORT% -t "%WEBAPP_DIR%"

