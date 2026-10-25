"""
Regression tests for the standalone Voice AI authentication boundary.
"""

import ast
from pathlib import Path

from jose import jwt
import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

import security


def make_token(secret: str, **claims) -> str:
    payload = {
        "exp": 4102444800,
        "id": "user-123",
        "uid": "firebase-123",
    }
    payload.update(claims)
    return jwt.encode(payload, secret, algorithm=security.JWT_ALGORITHM)


def test_require_user_uses_backend_user_id(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    credentials = HTTPAuthorizationCredentials(
        scheme="Bearer",
        credentials=make_token("test-secret", id="profile-42", uid="firebase-42"),
    )

    assert security.require_user(credentials) == "profile-42"


def test_require_user_rejects_missing_credentials():
    with pytest.raises(HTTPException) as exc_info:
        security.require_user(None)

    assert exc_info.value.status_code == 401


def test_require_user_rejects_invalid_token(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    credentials = HTTPAuthorizationCredentials(
        scheme="Bearer",
        credentials=make_token("wrong-secret"),
    )

    with pytest.raises(HTTPException) as exc_info:
        security.require_user(credentials)

    assert exc_info.value.status_code == 401


def test_require_user_fails_closed_without_jwt_secret(monkeypatch):
    monkeypatch.delenv("JWT_SECRET", raising=False)
    credentials = HTTPAuthorizationCredentials(
        scheme="Bearer",
        credentials="not-a-token",
    )

    with pytest.raises(HTTPException) as exc_info:
        security.require_user(credentials)

    assert exc_info.value.status_code == 503


def test_sensitive_voice_routes_require_authentication():
    source = Path(__file__).with_name("routes").joinpath("voice_routes.py").read_text(encoding="utf-8")
    tree = ast.parse(source)

    protected = {
        "process_voice",
        "detect_language",
        "transcribe_speech",
        "synthesize_speech",
        "get_language_stats",
        "translate_text",
    }

    found = {
        node.name: ast.unparse(node)
        for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        and node.name in protected
    }

    assert protected == found.keys()
    for route_source in found.values():
        assert "Depends(require_user)" in route_source


def test_process_voice_does_not_accept_caller_supplied_user_id():
    source = Path(__file__).with_name("routes").joinpath("voice_routes.py").read_text(encoding="utf-8")
    tree = ast.parse(source)
    process_voice = next(
        node for node in tree.body
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "process_voice"
    )

    assert not any(
        isinstance(arg, ast.arg) and arg.arg == "user_id"
        for arg in process_voice.args.args + process_voice.args.kwonlyargs
    )
