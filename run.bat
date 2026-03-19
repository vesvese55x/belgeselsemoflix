@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT_DIR=%~dp0"
pushd "%ROOT_DIR%" >nul 2>nul
if errorlevel 1 (
  echo Uygulama klasorune gecilemedi: %ROOT_DIR%
  exit /b 1
)

set "HOST=%BELGESELSEMOFLIX_HOST%"
if "%HOST%"=="" set "HOST=127.0.0.1"

set "PORT=%BELGESELSEMOFLIX_PORT%"
if "%PORT%"=="" set "PORT=8000"

set "WEBAPP_DIR=%BELGESELSEMOFLIX_WEBAPP_DIR%"
if "%WEBAPP_DIR%"=="" set "WEBAPP_DIR=%CD%\webapp"
set "BUNDLED_PHP_ROOT=%CD%\runtime\windows"
set "PHP_CMD="
set "PHP_DIR="
set "PHP_ARGS=-n -d cli_server.color=0"

if not exist "%WEBAPP_DIR%" (
  echo Web uygulama klasoru bulunamadi: %WEBAPP_DIR%
  exit /b 1
)

if exist "%BUNDLED_PHP_ROOT%" (
  for /f "delims=" %%F in ('dir /s /b "%BUNDLED_PHP_ROOT%\php.exe" 2^>nul') do (
    set "PHP_CMD=%%~fF"
    set "PHP_DIR=%%~dpF"
    goto bundled_php_found
  )
)
:bundled_php_found

if "%PHP_CMD%"=="" (
  where php >nul 2>nul
  if errorlevel 1 (
    echo PHP bulunamadi. Paket icindeki PHP de mevcut degil.
    echo Lutfen uygulamayi yeniden kurun ya da sisteminize PHP ekleyin.
    exit /b 1
  )
  set "PHP_CMD=php"
  for %%F in ("%PHP_CMD%") do set "PHP_DIR=%%~dp$PATH:F"
)

if not "!PHP_CMD!"=="" (
  for %%I in ("!PHP_CMD!") do set "PHP_DIR=%%~dpI"
)

if not "!PHP_DIR!"=="" set "PATH=!PHP_DIR!;%PATH%"

echo PHP komutu: !PHP_CMD!
echo PHP klasoru: !PHP_DIR!
echo Web klasoru: %WEBAPP_DIR%
echo Server baslatiliyor: http://%HOST%:%PORT%/index.php
"!PHP_CMD!" !PHP_ARGS! -S %HOST%:%PORT% -t "%WEBAPP_DIR%"
set "EXIT_CODE=%ERRORLEVEL%"
popd >nul 2>nul
exit /b %EXIT_CODE%
