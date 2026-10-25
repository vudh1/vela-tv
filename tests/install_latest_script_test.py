#!/usr/bin/env python3
"""Offline smoke tests for Mac/ADB production recovery; never talks to a real TV."""
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/install-latest-tv.sh"


def executable(path, body):
    path.write_text("#!/bin/sh\nset -eu\n" + body)
    path.chmod(0o755)


with tempfile.TemporaryDirectory(prefix="vela-manual-update-test-") as tmp:
    base = Path(tmp)
    programs = base / "fake-tools"
    programs.mkdir()
    source_apk = base / "fake-release.apk"
    source_sha = base / "fake-release.sha256"
    log = base / "adb.log"
    source_apk.write_bytes(b"a safe fake APK for the Vela install script test")
    digest = hashlib.sha256(source_apk.read_bytes()).hexdigest()
    source_sha.write_text(digest + "  Vela-release.apk\n")

    executable(programs / "adb", """
if [ "$1" = devices ]; then
  printf 'List of devices attached\\n'
  printf 'living-room\\tdevice\\n'
  if [ "${VELA_TEST_TWO_DEVICES:-}" = yes ]; then
    printf 'bedroom\\tdevice\\n'
  fi
elif [ "$1" = -s ]; then
  serial="$2"
  shift 2
  if [ "$1" = get-state ]; then
    [ "$serial" = living-room ] || [ "$serial" = bedroom ]
    printf 'device\\n'
  elif [ "$1" = install ]; then
    [ "$2" = -r ] && [ "$3" = Vela-release.apk ]
    printf '%s\\n' "$serial" >> "$VELA_TEST_LOG"
    printf 'Success\\n'
  else
    exit 2
  fi
else
  exit 2
fi
""")
    executable(programs / "curl", """
destination=''
while [ "$#" -gt 0 ]; do
  if [ "$1" = --output ]; then
    shift
    destination="$1"
  fi
  shift
done
case "$destination" in
  Vela-release.apk) cp "$VELA_TEST_APK" "$destination" ;;
  Vela-release.apk.sha256) cp "$VELA_TEST_SHA" "$destination" ;;
  *) exit 4 ;;
esac
""")

    env = dict(os.environ, PATH=str(programs) + os.pathsep + os.environ["PATH"],
               TMPDIR=str(base), VELA_TEST_APK=str(source_apk),
               VELA_TEST_SHA=str(source_sha), VELA_TEST_LOG=str(log))

    def run(*args, two=False):
        candidate = dict(env)
        candidate["VELA_TEST_TWO_DEVICES"] = "yes" if two else "no"
        return subprocess.run(["bash", str(SCRIPT), *args], env=candidate,
                              text=True, capture_output=True, check=False)

    first = run(two=True)
    assert first.returncode != 0 and "exactly one" in first.stderr
    assert not log.exists(), "ambiguous TV selection must never install"

    single = run()
    assert single.returncode == 0, single.stderr
    assert log.read_text().splitlines() == ["living-room"]
    log.unlink()

    selected = run("bedroom", two=True)
    assert selected.returncode == 0, selected.stderr
    assert log.read_text().splitlines() == ["bedroom"]
    log.unlink()

    source_sha.write_text("0" * 64 + "  Vela-release.apk\n")
    bad = run()
    assert bad.returncode != 0 and not log.exists(), "checksum failure must block ADB"

print("PASS latest release script: checksum, explicit TV selection, no ambiguous or bad installs")
