#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REQUIRED_WEBAPP_FILES = (
    "index.html",
    "index.php",
    "css/style.css",
    "css/mobile-menu.css",
    "js/app.js",
    "js/youtube-client-simple.js",
)


def is_complete_webapp(destination: Path) -> bool:
    webapp_dir = destination / "webapp"
    return all(webapp_dir.joinpath(relative_path).is_file() for relative_path in REQUIRED_WEBAPP_FILES)


def resolve_openssl() -> str:
    candidates = [
        shutil.which("openssl"),
        r"C:\Program Files\Git\usr\bin\openssl.exe",
        r"C:\Program Files\OpenSSL-Win64\bin\openssl.exe",
        r"C:\Program Files\OpenSSL-Win32\bin\openssl.exe",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return str(candidate)
    raise FileNotFoundError("OpenSSL bulunamadi")


def restore(archive: Path, destination: Path, password: str) -> None:
    if is_complete_webapp(destination):
        print("webapp mevcut, restore atlandi")
        return

    if not archive.is_file():
        raise FileNotFoundError(f"sifreli webapp arsivi bulunamadi: {archive}")

    webapp_dir = destination / "webapp"
    if webapp_dir.exists():
        shutil.rmtree(webapp_dir)

    with tempfile.TemporaryDirectory(prefix="belgeselsemo-webapp-ci-") as temp_dir:
        temp_root = Path(temp_dir)
        tar_path = temp_root / "webapp.tar.gz"
        result = subprocess.run(
            [
                resolve_openssl(),
                "enc",
                "-d",
                "-aes-256-cbc",
                "-pbkdf2",
                "-in",
                str(archive),
                "-out",
                str(tar_path),
                "-pass",
                f"pass:{password}",
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise RuntimeError(
                "webapp arsivi acilamadi\n"
                f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
            )
        with tarfile.open(tar_path, "r:gz") as handle:
            handle.extractall(destination)

    if not is_complete_webapp(destination):
        raise RuntimeError("webapp restore sonrasi zorunlu dosyalar eksik")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", type=Path, default=ROOT / "webapp.secure.enc")
    parser.add_argument("--destination", type=Path, default=ROOT)
    parser.add_argument("--password", default=os.environ.get("WEBAPP_ARCHIVE_PASSWORD", ""))
    args = parser.parse_args()

    if not args.password:
        print("WEBAPP_ARCHIVE_PASSWORD tanimli degil", file=sys.stderr)
        return 1

    try:
        restore(args.archive, args.destination, args.password)
        print("webapp restore tamam")
        return 0
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
