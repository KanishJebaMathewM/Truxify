"""Unit test to verify backend/ml/main.py guards sentry_sdk import."""

import ast
from pathlib import Path

MAIN_FILE = Path(__file__).resolve().parent.parent / "main.py"


def test_sentry_sdk_import_is_guarded():
    assert MAIN_FILE.exists(), "backend/ml/main.py must exist"

    tree = ast.parse(MAIN_FILE.read_text(encoding="utf-8"))

    # Verify there is a Try block catching ImportError for sentry_sdk
    guarded = False
    for node in tree.body:
        if isinstance(node, ast.Try):
            for handler in node.handlers:
                if isinstance(handler.type, ast.Name) and handler.type.id == "ImportError":
                    for sub in node.body:
                        if isinstance(sub, ast.Import):
                            for alias in sub.names:
                                if alias.name == "sentry_sdk":
                                    guarded = True
    assert guarded, "sentry_sdk import in backend/ml/main.py must be wrapped in try...except ImportError"
