#!/usr/bin/env python3
"""Install the two expected TLS files from a bounded tar.gz stream on stdin."""

import io
import grp
import os
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

HOSTNAME = "api.260926731.xyz"
TLS_DIR = Path("/etc/voice-ai-toy/tls")
EXPECTED = {"fullchain.pem", "privkey.pem"}
MAX_ARCHIVE = 131072
MAX_FILE = 65536


def run(*args, input_data=None):
    return subprocess.run(args, input=input_data, check=True, capture_output=True).stdout


def main():
    if os.geteuid() != 0:
        raise RuntimeError("certificate installer must run as root")
    os.umask(0o077)
    bundle = sys.stdin.buffer.read(MAX_ARCHIVE + 1)
    if len(bundle) > MAX_ARCHIVE:
        raise ValueError("certificate bundle too large")
    files = {}
    with tarfile.open(fileobj=io.BytesIO(bundle), mode="r:gz") as archive:
        for member in archive:
            if member.name not in EXPECTED or not member.isfile() or member.size > MAX_FILE:
                raise ValueError("unexpected certificate bundle member")
            if member.name in files:
                raise ValueError("duplicate certificate bundle member")
            files[member.name] = archive.extractfile(member).read(MAX_FILE + 1)
    if files.keys() != EXPECTED:
        raise ValueError("incomplete certificate bundle")

    caddy_gid = grp.getgrnam("caddy").gr_gid
    with tempfile.TemporaryDirectory(prefix="voice-cert-", dir="/run") as scratch:
        for name, content in files.items():
            path = Path(scratch) / name
            path.write_bytes(content)
            path.chmod(0o600)
        cert = str(Path(scratch) / "fullchain.pem")
        key = str(Path(scratch) / "privkey.pem")
        run("/usr/bin/openssl", "x509", "-in", cert, "-noout", "-checkhost", HOSTNAME)
        run("/usr/bin/openssl", "x509", "-in", cert, "-noout", "-checkend", "604800")
        cert_pub = run("/usr/bin/openssl", "x509", "-in", cert, "-pubkey", "-noout")
        key_pub = run("/usr/bin/openssl", "pkey", "-in", key, "-pubout")
        if cert_pub != key_pub:
            raise ValueError("certificate and private key do not match")

        current = TLS_DIR / "current"
        if current.is_dir() and all((current / name).read_bytes() == files[name] for name in EXPECTED):
            return

        os.chown(TLS_DIR.parent, 0, caddy_gid)
        TLS_DIR.parent.chmod(0o750)
        TLS_DIR.mkdir(parents=True, exist_ok=True)
        os.chown(TLS_DIR, 0, caddy_gid)
        TLS_DIR.chmod(0o750)
        version = Path(tempfile.mkdtemp(prefix="cert-", dir=TLS_DIR))
        os.chown(version, 0, caddy_gid)
        version.chmod(0o750)
        for name, content in files.items():
            path = version / name
            path.write_bytes(content)
            os.chown(path, 0, caddy_gid)
            path.chmod(0o640)
        pending = TLS_DIR / ".current-next"
        pending.unlink(missing_ok=True)
        pending.symlink_to(version.name)
        pending.replace(TLS_DIR / "current")
    run("/usr/bin/systemctl", "reload", "caddy")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"certificate installation failed: {error}", file=sys.stderr)
        sys.exit(1)
