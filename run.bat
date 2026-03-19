@echo off
setlocal

set "HOST=%BELGESELSEMOFLIX_HOST%"
if "%HOST%"=="" set "HOST=127.0.0.1"

set "PORT=%BELGESELSEMOFLIX_PORT%"
if "%PORT%"=="" set "PORT=8000"

set "ROOT_DIR=%~dp0"
set "WEBAPP_DIR=%BELGESELSEMOFLIX_WEBAPP_DIR%"
if "%WEBAPP_DIR%"=="" set "WEBAPP_DIR=%ROOT_DIR%webapp"
set "BUNDLED_PHP=%ROOT_DIR%runtime\windows\php\php.exe"
set "PHP_CMD="

if not exist "%WEBAPP_DIR%" (
  echo Web uygulama klasoru bulunamadi: %WEBAPP_DIR%
  exit /b 1
)

if exist "%BUNDLED_PHP%" (
  set "PHP_CMD=%BUNDLED_PHP%"
)

if "%PHP_CMD%"=="" (
  where php >nul 2>nul
  if errorlevel 1 (
    echo PHP bulunamadi. Paket icindeki PHP de mevcut degil.
    echo Lutfen uygulamayi yeniden kurun ya da sisteminize PHP ekleyin.
    exit /b 1
  )
  set "PHP_CMD=php"
)

echo Server baslatiliyor: http://%HOST%:%PORT%/index.php
"%PHP_CMD%" -S %HOST%:%PORT% -t "%WEBAPP_DIR%"
