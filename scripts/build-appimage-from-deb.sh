#!/usr/bin/env bash

set -euo pipefail

APPIMAGE_OUT="/tmp/belgeselsemoflix-appimage"
APPIMAGE_WORK="$(mktemp -d)"
DEB_PATH="$(find src-tauri/target/release/bundle/deb -maxdepth 1 -type f -name '*.deb' | head -n 1)"

rm -rf "$APPIMAGE_OUT"
mkdir -p "$APPIMAGE_OUT"

if [ -z "$DEB_PATH" ]; then
  echo "deb paketi bulunamadi"
  exit 1
fi

dpkg-deb -x "$DEB_PATH" "$APPIMAGE_WORK/AppDir"
test -x "$APPIMAGE_WORK/AppDir/usr/bin/belgeselsemoflix"
test -f "$APPIMAGE_WORK/AppDir/usr/share/applications/belgeselsemoflix.desktop"

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
