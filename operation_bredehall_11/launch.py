"""Start Operation Bredehall 11 locally on Windows (double-click or exe)."""
from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
import webbrowser
from pathlib import Path

HOST = "127.0.0.1"
PORT = 8890
URL = f"http://{HOST}:{PORT}"


def _app_root() -> Path:
    """Project folder — works for launch.py and PyInstaller onefile exe."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


ROOT = _app_root()

PYTHON_CANDIDATES = (
    ["py", "-3.10"],
    ["py", "-3.11"],
    ["py", "-3.12"],
    ["py", "-3.13"],
    ["python"],
    ["python3"],
)


def _pause(msg: str = "\nTryck Enter för att stänga...") -> None:
    print(msg, flush=True)
    if sys.platform == "win32":
        os.system("pause")
        return
    try:
        input()
    except (EOFError, KeyboardInterrupt):
        pass


def _win_message(text: str, title: str = "Operation Bredehall 11") -> None:
    if sys.platform != "win32":
        print(text)
        return
    try:
        import ctypes

        ctypes.windll.user32.MessageBoxW(0, text, title, 0x10)
    except Exception:
        print(text)
        _pause()


def _launch_frozen_windows() -> int:
    """PyInstaller exe: öppna Start Bredehall.bat i nytt cmd-fönster (samma som dubbelklick)."""
    bat = ROOT / "Start Bredehall.bat"
    if not bat.is_file():
        _win_message(
            f"Start Bredehall.bat saknas i:\n{ROOT}\n\n"
            "Lägg exe i operation_bredehall_11/ eller kör .bat direkt."
        )
        return 1
    os.startfile(bat)  # type: ignore[attr-defined]
    return 0


def _port_in_use() -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        return sock.connect_ex((HOST, PORT)) == 0


def _wait_for_server(timeout: float = 30.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if _port_in_use():
            return True
        time.sleep(0.25)
    return False


def _python_ok(cmd: list[str]) -> bool:
    """Python must exist and be able to import the app (deps installed)."""
    try:
        subprocess.run(
            [*cmd, "--version"],
            capture_output=True,
            check=True,
            cwd=ROOT,
        )
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False
    probe = (
        "import uvicorn, multipart; "
        "import app.main; "
        "print('ok')"
    )
    try:
        r = subprocess.run(
            [*cmd, "-c", probe],
            capture_output=True,
            text=True,
            cwd=ROOT,
            timeout=45,
        )
        if r.returncode != 0 or "ok" not in (r.stdout or ""):
            err = (r.stderr or r.stdout or "").strip()
            if err:
                print(f"Python-prob ({' '.join(cmd)}): {err[:400]}", flush=True)
            return False
        return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def _find_python() -> list[str] | None:
    for cmd in PYTHON_CANDIDATES:
        if _python_ok(cmd):
            return cmd
    return None


def main() -> int:
    os.chdir(ROOT)
    os.environ.setdefault("DATA_DIR", str(ROOT / "data"))

    if getattr(sys, "frozen", False) and sys.platform == "win32":
        return _launch_frozen_windows()

    if _port_in_use():
        print(f"Servern kör redan på {URL}", flush=True)
        webbrowser.open(URL)
        _pause()
        return 0

    py = _find_python()
    if not py:
        print("Hittade ingen Python med alla beroenden.", flush=True)
        print(f"Projektmapp: {ROOT}", flush=True)
        print("\nKör i terminalen:", flush=True)
        print(f'  cd "{ROOT}"', flush=True)
        print("  py -3.10 -m pip install -r requirements.txt", flush=True)
        print("  py -3.10 launch.py", flush=True)
        _pause()
        return 1

    ver = subprocess.run([*py, "--version"], capture_output=True, text=True, cwd=ROOT)
    print(f"Python: {(ver.stdout or ver.stderr or '').strip()}", flush=True)
    print(f"Startar Operation Bredehall på {URL}", flush=True)
    print("Stäng detta fönster (eller Ctrl+C) för att stoppa servern.\n", flush=True)

    proc = subprocess.Popen(
        [*py, "-m", "uvicorn", "app.main:app", "--host", HOST, "--port", str(PORT)],
        cwd=ROOT,
        env={**os.environ, "DATA_DIR": str(ROOT / "data")},
    )

    if _wait_for_server():
        webbrowser.open(URL)
    else:
        print("\nServern svarade inte inom 30 sekunder.", flush=True)
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        _pause()
        return 1

    try:
        return proc.wait()
    except KeyboardInterrupt:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        return 0


if __name__ == "__main__":
    try:
        code = main()
    except Exception as exc:
        print(f"\nFel: {exc}", flush=True)
        _pause()
        code = 1
    if code != 0 and not getattr(sys, "frozen", False):
        _pause("\nServern avslutades med fel. Tryck Enter för att stänga...")
    sys.exit(code)
