#!/usr/bin/env bash

set -euo pipefail

APPIMAGE_OUT="${APPIMAGE_OUT:-/tmp/belgeselsemoflix-appimage}"
APPIMAGE_WORK="$(mktemp -d)"
DEB_DIR="src-tauri/target/release/bundle/deb"
DEB_PATH="$(find "$DEB_DIR" -maxdepth 1 -type f -name '*.deb' -print -quit)"
APPDIR="$APPIMAGE_WORK/AppDir"
APPIMAGETOOL="$APPIMAGE_WORK/appimagetool.AppImage"

trap 'rm -rf "$APPIMAGE_WORK"' EXIT

rm -rf "$APPIMAGE_OUT"
mkdir -p "$APPIMAGE_OUT"

if [ ! -d "$DEB_DIR" ]; then
  echo "deb dizini bulunamadi: $DEB_DIR"
  exit 1
fi

if [ -z "$DEB_PATH" ]; then
  echo "deb paketi bulunamadi"
  exit 1
fi

mkdir -p "$APPDIR"
dpkg-deb -x "$DEB_PATH" "$APPDIR"

BIN_PATH="$(find "$APPDIR/usr/bin" -maxdepth 1 -type f -perm -111 -print -quit 2>/dev/null || true)"
if [ -z "$BIN_PATH" ]; then
  BIN_PATH="$(find "$APPDIR/usr/bin" -maxdepth 1 -type f -print -quit 2>/dev/null || true)"
fi
if [ -z "$BIN_PATH" ]; then
  echo "AppDir icinde calistirilabilir dosya bulunamadi"
  find "$APPDIR" -maxdepth 4 -type f | sort
  exit 1
fi

cat > "$APPDIR/AppRun" <<EOF
#!/bin/sh
HERE="\$(CDPATH= cd -- "\$(dirname -- "\$0")" && pwd)"
exec "\$HERE/usr/bin/$(basename "$BIN_PATH")" "\$@"
EOF
chmod +x "$APPDIR/AppRun"

cat > "$APPDIR/belgeselsemoflix.desktop" <<'EOF'
[Desktop Entry]
Name=BELGESELSEMOFLIX
Exec=AppRun
Icon=belgeselsemoflix
Type=Application
Categories=Entertainment;Video;
Version=1.0
Terminal=false
EOF

cp src-tauri/icons/128x128.png "$APPDIR/belgeselsemoflix.png"
cp src-tauri/icons/128x128.png "$APPDIR/.DirIcon"

curl -fsSL -o "$APPIMAGETOOL" \
  https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage
chmod +x "$APPIMAGETOOL"

ARCH=x86_64 "$APPIMAGETOOL" --appimage-extract-and-run "$APPDIR" "$APPIMAGE_OUT/BELGESELSEMOFLIX-1.0.0-x86_64.AppImage"
