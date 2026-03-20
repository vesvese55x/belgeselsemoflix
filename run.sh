#!/usr/bin/env bash

set -euo pipefail

PORT="${BELGESELSEMOFLIX_PORT:-8000}"
HOST="${BELGESELSEMOFLIX_HOST:-127.0.0.1}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEBAPP_DIR="${BELGESELSEMOFLIX_WEBAPP_DIR:-$ROOT_DIR/webapp}"
BUNDLED_PHP_LINUX="$ROOT_DIR/runtime/linux/bin/php"
BUNDLED_PHP_MACOS="$ROOT_DIR/runtime/macos/bin/php"

echo "BELGESELSEMOFLIX PHP server hazirlaniyor..."

if [ -f /etc/os-release ]; then
    . /etc/os-release
fi

install_php_debian() {
    echo "PHP yukleniyor (Debian/Ubuntu)..."
    sudo apt update
    sudo apt install -y php php-cli php-curl php-mbstring php-xml php-zip
}

install_php_arch() {
    echo "PHP yukleniyor (Arch)..."
    sudo pacman -Sy --noconfirm php
}

install_php_fedora() {
    echo "PHP yukleniyor (Fedora/RHEL tabanli)..."

    local pkg_tool=""
    if command -v dnf >/dev/null 2>&1; then
        pkg_tool="dnf"
    elif command -v yum >/dev/null 2>&1; then
        pkg_tool="yum"
    else
        echo "dnf/yum bulunamadi. PHP otomatik yuklenemedi."
        exit 1
    fi

    sudo "$pkg_tool" install -y \
        php \
        php-cli \
        php-common \
        php-curl \
        php-mbstring \
        php-xml \
        php-zip
}

detect_distro() {
    if [[ "${ID:-}" =~ (ubuntu|debian) ]] || [[ "${ID_LIKE:-}" =~ (ubuntu|debian) ]]; then
        DISTRO="debian"
    elif [[ "${ID:-}" =~ (arch) ]] || [[ "${ID_LIKE:-}" =~ (arch) ]]; then
        DISTRO="arch"
    elif [[ "${ID:-}" =~ (fedora|rhel|centos|rocky|almalinux) ]] || [[ "${ID_LIKE:-}" =~ (fedora|rhel|centos) ]]; then
        DISTRO="fedora"
    else
        DISTRO="unknown"
    fi
}

ensure_php() {
    if [ -x "$BUNDLED_PHP_LINUX" ]; then
        PHP_BIN="$BUNDLED_PHP_LINUX"
        echo "Paket icindeki PHP bulundu."
        return
    fi

    if [ -x "$BUNDLED_PHP_MACOS" ]; then
        PHP_BIN="$BUNDLED_PHP_MACOS"
        echo "Paket icindeki PHP bulundu."
        return
    fi

    if command -v php >/dev/null 2>&1; then
        PHP_BIN="$(command -v php)"
        echo "PHP bulundu."
        return
    fi

    echo "PHP bulunamadi."
    case "$(uname -s)" in
        Linux)
            detect_distro
            case "$DISTRO" in
                debian)
                    install_php_debian
                    ;;
                arch)
                    install_php_arch
                    ;;
                fedora)
                    install_php_fedora
                    ;;
                *)
                    echo "Desteklenmeyen Linux dagitimi: ${ID:-bilinmiyor}"
                    exit 1
                    ;;
            esac
            ;;
        Darwin)
            if command -v brew >/dev/null 2>&1; then
                echo "PHP Homebrew ile yukleniyor (macOS)..."
                brew install php
                PHP_BIN="$(command -v php)"
            else
                echo "macOS uzerinde PHP sistemde yok ve Homebrew bulunamadi."
                echo "Lutfen once Homebrew kurun ya da PHP'yi manuel yukleyin."
                exit 1
            fi
            ;;
        *)
            echo "Bu platform desteklenmiyor."
            exit 1
            ;;
    esac
}

if [ ! -d "$WEBAPP_DIR" ]; then
    echo "Web uygulama klasoru bulunamadi: $WEBAPP_DIR"
    exit 1
fi

ensure_php

echo "Server baslatiliyor: http://$HOST:$PORT/index.php"
exec "$PHP_BIN" -S "$HOST:$PORT" -t "$WEBAPP_DIR"
