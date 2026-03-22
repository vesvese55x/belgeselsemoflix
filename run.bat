@echo off
setlocal EnableExtensions DisableDelayedExpansion

set "ROOT_DIR=%~dp0"
pushd "%ROOT_DIR%" >nul 2>nul
if errorlevel 1 (
  echo Uygulama klasorune gecilemedi: %ROOT_DIR%
  exit /b 1
)

set "HOST=%BELGESELSEMOFLIX_HOST%"
if not defined HOST set "HOST=127.0.0.1"

set "PORT=%BELGESELSEMOFLIX_PORT%"
if not defined PORT set "PORT=8000"

set "WEBAPP_DIR=%BELGESELSEMOFLIX_WEBAPP_DIR%"
if not defined WEBAPP_DIR set "WEBAPP_DIR=%CD%\webapp"

set "PHP_CMD="
set "PHP_DIR="
set "USE_BUNDLED_PHP=0"
set "EXIT_CODE=0"
set "PHP_ARGS=-d cli_server.color=0"

if not exist "%WEBAPP_DIR%" goto webapp_missing

if exist "%CD%\runtime\windows\php\php.exe" (
  set "PHP_CMD=%CD%\runtime\windows\php\php.exe"
  set "PHP_DIR=%CD%\runtime\windows\php"
  set "USE_BUNDLED_PHP=1"
) else (
  where php >nul 2>nul
  if errorlevel 1 goto php_missing
  set "PHP_CMD=php"
)

if "%USE_BUNDLED_PHP%"=="1" (
  set "PHP_ARGS=-n -d cli_server.color=0 -d extension_dir=ext -d extension=curl -d extension=openssl -d extension=mbstring -d extension=fileinfo -d extension=sodium -d opcache.enable=0 -d opcache.enable_cli=0 -d opcache.jit=0 -d opcache.jit_buffer_size=0 -d curl.cainfo= -d openssl.cafile="
) else (
  set "PHP_ARGS=%PHP_ARGS% -d opcache.enable=0 -d opcache.enable_cli=0 -d opcache.jit=0 -d opcache.jit_buffer_size=0"
)

echo PHP komutu: %PHP_CMD%
echo PHP klasoru: %PHP_DIR%
echo Web klasoru: %WEBAPP_DIR%
echo Server baslatiliyor: http://%HOST%:%PORT%/index.php

if defined PHP_DIR (
  pushd "%PHP_DIR%" >nul 2>nul
  if errorlevel 1 goto phpdir_missing
)

"%PHP_CMD%" %PHP_ARGS% -S %HOST%:%PORT% -t "%WEBAPP_DIR%"
set "EXIT_CODE=%ERRORLEVEL%"
goto cleanup

:webapp_missing
echo Web uygulama klasoru bulunamadi: %WEBAPP_DIR%
set "EXIT_CODE=1"
goto cleanup

:php_missing
echo PHP bulunamadi. Paket icindeki PHP de mevcut degil.
echo Lutfen uygulamayi yeniden kurun ya da sisteminize PHP ekleyin.
set "EXIT_CODE=1"
goto cleanup

:phpdir_missing
echo PHP klasorune gecilemedi: %PHP_DIR%
set "EXIT_CODE=1"
goto cleanup

:cleanup
if defined PHP_DIR popd >nul 2>nul
popd >nul 2>nul
exit /b %EXIT_CODE%
