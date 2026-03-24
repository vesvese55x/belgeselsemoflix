#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import random
import shutil
import string
import subprocess
import sys
import tarfile
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib import error, request

from nacl import encoding, public


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ARCHIVE = ROOT / "webapp.secure.enc"
DEFAULT_SOURCE = ROOT / "webapp"
DEFAULT_NOTES = ROOT / "LOCAL_WEBAPP_ENCRYPTION.md"
DEFAULT_SECRET_NAME = "WEBAPP_ARCHIVE_PASSWORD"
DEFAULT_REPOSITORY = "vesvese55x/belgeselsemoflix"
DEFAULT_STATE_DIR = ROOT / ".webapp-archive-work"
DEFAULT_STATE_FILE = DEFAULT_STATE_DIR / "archive-state.json"
DEFAULT_TOKEN_FILE = DEFAULT_STATE_DIR / "github-token"
SYSTEM_RANDOM = random.SystemRandom()
PASSWORD_LENGTH = 20
PASSWORD_DIGIT_COUNT = 6
PASSWORD_UPPER_COUNT = 1
PASSWORD_PUNCTUATION_COUNT = 1
PASSWORD_SPECIAL_COUNT = 1
PASSWORD_LOWER_COUNT = (
    PASSWORD_LENGTH
    - PASSWORD_DIGIT_COUNT
    - PASSWORD_UPPER_COUNT
    - PASSWORD_PUNCTUATION_COUNT
    - PASSWORD_SPECIAL_COUNT
)


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


def generate_password() -> str:
    letters = [SYSTEM_RANDOM.choice(string.ascii_lowercase) for _ in range(PASSWORD_LOWER_COUNT)]
    uppercase = [SYSTEM_RANDOM.choice(string.ascii_uppercase) for _ in range(PASSWORD_UPPER_COUNT)]
    digits = [SYSTEM_RANDOM.choice(string.digits) for _ in range(PASSWORD_DIGIT_COUNT)]
    punctuation = [SYSTEM_RANDOM.choice(".,;:!?") for _ in range(PASSWORD_PUNCTUATION_COUNT)]
    special = [SYSTEM_RANDOM.choice("@#$%&*+-_=") for _ in range(PASSWORD_SPECIAL_COUNT)]
    password_chars = letters + uppercase + digits + punctuation + special
    SYSTEM_RANDOM.shuffle(password_chars)
    return "".join(password_chars)


def ensure_state_dir() -> None:
    DEFAULT_STATE_DIR.mkdir(parents=True, exist_ok=True)


def compute_source_hash(source_dir: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(source_dir.rglob("*")):
        if path.is_dir():
            continue
        digest.update(path.relative_to(source_dir).as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def load_state(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_state(path: Path, state: dict) -> None:
    ensure_state_dir()
    path.write_text(json.dumps(state, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def ensure_notes_file(path: Path) -> None:
    if path.exists():
        return
    path.write_text(
        "# BELGESELSEMOFLIX Webapp Encryption Notes\n\n"
        "Bu dosya yerelde tutulur ve GitHub'a gonderilmez.\n\n"
        "## Mantik\n"
        "- webapp klasoru yerelde acik halde kalir.\n"
        "- GitHub'a sadece sifreli webapp.secure.enc arsivi gonderilir.\n"
        "- workflow build sirasinda WEBAPP_ARCHIVE_PASSWORD secret'i ile arsivi acar.\n"
        "- Arsiv her paketlemede yeni parola ile uretilir.\n\n"
        "## Son Parolalar\n",
        encoding="utf-8",
    )


def append_notes(path: Path, password: str, archive: Path, secret_name: str, secret_updated: bool) -> None:
    ensure_notes_file(path)
    timestamp = datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M:%S %z")
    with path.open("a", encoding="utf-8") as handle:
        handle.write(
            f"\n### {timestamp}\n"
            f"- archive: `{archive.name}`\n"
            f"- secret: `{secret_name}`\n"
            f"- secret_updated: `{'yes' if secret_updated else 'no'}`\n"
            f"- password: `{password}`\n"
        )


def read_last_password(path: Path) -> str | None:
    if not path.exists():
        return None
    content = path.read_text(encoding="utf-8")
    for line in reversed(content.splitlines()):
        stripped = line.strip()
        if stripped.startswith("- password: `") and stripped.endswith("`"):
            return stripped[len("- password: `") : -1]
    return None


def run_openssl(args: list[str]) -> None:
    result = subprocess.run(args, cwd=ROOT, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(
            "OpenSSL komutu basarisiz oldu:\n"
            f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
        )


def create_encrypted_archive(source_dir: Path, archive_path: Path, password: str) -> None:
    if not source_dir.is_dir():
        raise FileNotFoundError(f"webapp klasoru bulunamadi: {source_dir}")

    with tempfile.TemporaryDirectory(prefix="belgeselsemo-webapp-") as temp_dir:
        temp_root = Path(temp_dir)
        tar_path = temp_root / "webapp.tar.gz"
        with tarfile.open(tar_path, "w:gz") as tar:
            tar.add(source_dir, arcname="webapp")

        archive_path.parent.mkdir(parents=True, exist_ok=True)
        if archive_path.exists():
            archive_path.unlink()

        run_openssl(
            [
                resolve_openssl(),
                "enc",
                "-aes-256-cbc",
                "-pbkdf2",
                "-salt",
                "-in",
                str(tar_path),
                "-out",
                str(archive_path),
                "-pass",
                f"pass:{password}",
            ]
        )


def restore_encrypted_archive(archive_path: Path, destination_root: Path, password: str) -> None:
    if not archive_path.is_file():
        raise FileNotFoundError(f"sifreli arsiv bulunamadi: {archive_path}")

    target_dir = destination_root / "webapp"
    if target_dir.is_dir():
        return

    with tempfile.TemporaryDirectory(prefix="belgeselsemo-webapp-restore-") as temp_dir:
        temp_root = Path(temp_dir)
        tar_path = temp_root / "webapp.tar.gz"
        run_openssl(
            [
                resolve_openssl(),
                "enc",
                "-d",
                "-aes-256-cbc",
                "-pbkdf2",
                "-in",
                str(archive_path),
                "-out",
                str(tar_path),
                "-pass",
                f"pass:{password}",
            ]
        )
        with tarfile.open(tar_path, "r:gz") as tar:
            tar.extractall(destination_root)

    if not target_dir.joinpath("index.html").is_file():
        raise RuntimeError("Arsiv acildi ama webapp/index.html bulunamadi")


def github_token_from_env() -> str | None:
    for key in ("BELGESELSEMO_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"):
        value = os.environ.get(key)
        if value:
            return value
    if DEFAULT_TOKEN_FILE.exists():
        value = DEFAULT_TOKEN_FILE.read_text(encoding="utf-8").strip()
        if value:
            return value
    return None


def github_api_json(url: str, token: str, method: str = "GET", payload: bytes | None = None) -> dict:
    req = request.Request(url, data=payload, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Accept", "application/vnd.github+json")
    if payload is not None:
        req.add_header("Content-Type", "application/json")
    with request.urlopen(req) as response:
        body = response.read()
        if not body:
            return {}
        return json.loads(body.decode("utf-8"))


def update_repo_secret(repository: str, secret_name: str, password: str, token: str) -> None:
    owner, repo = repository.split("/", 1)
    key_info = github_api_json(
        f"https://api.github.com/repos/{owner}/{repo}/actions/secrets/public-key",
        token,
    )
    public_key = public.PublicKey(key_info["key"].encode("utf-8"), encoding.Base64Encoder())
    sealed_box = public.SealedBox(public_key)
    encrypted = base64.b64encode(sealed_box.encrypt(password.encode("utf-8"))).decode("utf-8")

    payload = __import__("json").dumps(
        {
            "encrypted_value": encrypted,
            "key_id": key_info["key_id"],
        }
    ).encode("utf-8")

    github_api_json(
        f"https://api.github.com/repos/{owner}/{repo}/actions/secrets/{secret_name}",
        token,
        method="PUT",
        payload=payload,
    )


def pack(args: argparse.Namespace) -> int:
    if not args.source.is_dir():
        raise FileNotFoundError(f"webapp klasoru bulunamadi: {args.source}")

    source_hash = compute_source_hash(args.source)
    state = load_state(args.state_file)
    if args.archive.exists() and state.get("source_hash") == source_hash:
        print(f"Encrypted archive already up to date: {args.archive}")
        return 0

    password = args.password or (
        read_last_password(args.notes) if args.reuse_last_password else None
    ) or generate_password()
    secret_updated = False
    if args.reuse_last_password:
        last_password = read_last_password(args.notes)
        if last_password:
            password = last_password
    token = None
    if not args.skip_secret_update:
        token = github_token_from_env()
        if not token:
            raise RuntimeError(
                "GitHub token bulunamadi. Yeni parola ile arsivlemek icin "
                "BELGESELSEMO_GITHUB_TOKEN / GH_TOKEN / GITHUB_TOKEN tanimlayin "
                "veya `.webapp-archive-work/github-token` dosyasina token yazin."
            )

    create_encrypted_archive(args.source, args.archive, password)

    if not args.skip_secret_update:
        if token:
            update_repo_secret(args.repository, args.secret_name, password, token)
            secret_updated = True

    append_notes(args.notes, password, args.archive, args.secret_name, secret_updated)
    save_state(
        args.state_file,
        {
            "source_hash": source_hash,
            "archive": str(args.archive),
            "secret_name": args.secret_name,
            "updated_at": datetime.now(timezone.utc).astimezone().isoformat(),
        },
    )
    print(f"Encrypted archive ready: {args.archive}")
    print(f"Secret updated: {'yes' if secret_updated else 'no'}")
    return 0


def unpack(args: argparse.Namespace) -> int:
    restore_encrypted_archive(args.archive, args.destination, args.password)
    print(f"webapp restored into: {args.destination / 'webapp'}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="BELGESELSEMOFLIX webapp secure archive manager")
    subparsers = parser.add_subparsers(dest="command", required=True)

    pack_parser = subparsers.add_parser("pack", help="Create encrypted archive from local webapp")
    pack_parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    pack_parser.add_argument("--archive", type=Path, default=DEFAULT_ARCHIVE)
    pack_parser.add_argument("--notes", type=Path, default=DEFAULT_NOTES)
    pack_parser.add_argument("--state-file", type=Path, default=DEFAULT_STATE_FILE)
    pack_parser.add_argument("--secret-name", default=DEFAULT_SECRET_NAME)
    pack_parser.add_argument("--repository", default=DEFAULT_REPOSITORY)
    pack_parser.add_argument("--password")
    pack_parser.add_argument("--reuse-last-password", action="store_true")
    pack_parser.add_argument("--skip-secret-update", action="store_true")
    pack_parser.set_defaults(func=pack)

    unpack_parser = subparsers.add_parser("unpack", help="Restore local webapp from encrypted archive")
    unpack_parser.add_argument("--archive", type=Path, default=DEFAULT_ARCHIVE)
    unpack_parser.add_argument("--destination", type=Path, default=ROOT)
    unpack_parser.add_argument("--password", required=True)
    unpack_parser.set_defaults(func=unpack)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        return args.func(args)
    except error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        print(f"GitHub API hatasi: HTTP {exc.code}\n{body}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
