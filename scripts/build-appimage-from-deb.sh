#!/usr/bin/env bash

set -euo pipefail

APPIMAGE_OUT="${APPIMAGE_OUT:-/tmp/belgeselsemoflix-appimage}"
APPIMAGE_WORK="$(mktemp -d)"
trap 'rm -rf "$APPIMAGE_WORK"' EXIT

DEB_DIR="src-tauri/target/release/bundle/deb"
DEB_PATH="$(find "$DEB_DIR" -maxdepth 1 -type f -name '*.deb' -print -quit)"

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

APPDIR="$APPIMAGE_WORK/AppDir"
dpkg-deb -x "$DEB_PATH" "$APPDIR"

BIN_DIR="$APPDIR/usr/bin"
DESKTOP_DIR="$APPDIR/usr/share/applications"
ICON_DIR="$APPDIR/usr/share/icons/hicolor/128x128/apps"

EXEC_PATH="$(find "$BIN_DIR" -maxdepth 1 -type f -perm -111 -print -quit 2>/dev/null || true)"
if [ -z "$EXEC_PATH" ]; then
  EXEC_PATH="$(find "$BIN_DIR" -maxdepth 1 -type f -print -quit 2>/dev/null || true)"
fi
if [ -z "$EXEC_PATH" ]; then
  echo "AppDir icinde calistirilabilir binary bulunamadi: $BIN_DIR"
  find "$APPDIR" -maxdepth 4 -type f | sort
  exit 1
fi

mkdir -p "$BIN_DIR" "$DESKTOP_DIR" "$ICON_DIR"
ln -sf "$(basename "$EXEC_PATH")" "$BIN_DIR/belgeselsemoflix"

DESKTOP_PATH="$(find "$DESKTOP_DIR" -maxdepth 1 -type f -name '*.desktop' -print -quit 2>/dev/null || true)"
if [ -n "$DESKTOP_PATH" ] && [ "$(basename "$DESKTOP_PATH")" != "belgeselsemoflix.desktop" ]; then
  cp "$DESKTOP_PATH" "$DESKTOP_DIR/belgeselsemoflix.desktop"
fi

cat > "$DESKTOP_DIR/belgeselsemoflix.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=BELGESELSEMOFLIX
Exec=usr/bin/belgeselsemoflix
Icon=belgeselsemoflix
Categories=Entertainment;
Terminal=false
EOF

cp src-tauri/icons/128x128.png "$ICON_DIR/belgeselsemoflix.png"

curl -fsSL -o /tmp/appimage-builder.AppImage \
  https://github.com/AppImageCrafters/appimage-builder/releases/download/v1.1.0/appimage-builder-1.1.0-x86_64.AppImage
chmod +x /tmp/appimage-builder.AppImage

(
  cd "$APPIMAGE_WORK"
  ARCH=x86_64 /tmp/appimage-builder.AppImage --appimage-extract-and-run \
    --recipe "$GITHUB_WORKSPACE/.github/appimage-builder.yml" \
    --skip-test
)

find "$APPIMAGE_WORK" -maxdepth 1 -type f -name '*.AppImage' ! -name 'appimage-builder*.AppImage' -exec mv {} "$APPIMAGE_OUT"/ \;
