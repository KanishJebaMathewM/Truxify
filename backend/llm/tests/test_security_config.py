import os
import subprocess
import sys
from pathlib import Path


LLM_DIR = Path(__file__).resolve().parents[1]


def run_security_import(env):
    return subprocess.run(
        [sys.executable, "-c", "import security"],
        cwd=LLM_DIR,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


def test_security_module_requires_jwt_secret():
    env = os.environ.copy()
    env.pop("JWT_SECRET", None)

    result = run_security_import(env)

    assert result.returncode != 0
    assert "JWT_SECRET must be configured" in (result.stdout + result.stderr)


def test_security_module_rejects_public_defaults():
    env = os.environ.copy()
    env["JWT_SECRET"] = "your-secret-key-change-in-production"

    result = run_security_import(env)

    assert result.returncode != 0
    assert "publicly-known default" in (result.stdout + result.stderr)


def test_security_module_accepts_configured_secret():
    env = os.environ.copy()
    env["JWT_SECRET"] = "test-secret-value-that-is-not-a-public-default"

    result = run_security_import(env)

    assert result.returncode == 0
