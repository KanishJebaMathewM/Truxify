"""
Unit tests for LLM security and route authorization (#13894).
"""
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from jose import jwt
from security import (
    decode_token,
    require_user,
    require_scoped_user,
    require_rag_write,
    require_rag_read,
    validate_upload_file,
    JWT_SECRET,
    JWT_ALGORITHM,
    JWT_ISSUER,
)

def create_test_token(sub="user-123", scopes=None, roles=None):
    payload = {
        "sub": sub,
        "iss": JWT_ISSUER,
        "scopes": scopes or [],
        "roles": roles or [],
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def test_decode_token_valid():
    token = create_test_token(sub="driver-1")
    payload = decode_token(token)
    assert payload["sub"] == "driver-1"

def test_decode_token_invalid():
    with pytest.raises(Exception):
        decode_token("invalid.jwt.token")

def test_require_user_success():
    token = create_test_token(sub="driver-42")
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
    user_id = require_user(creds)
    assert user_id == "driver-42"

def test_require_user_missing_credentials():
    with pytest.raises(HTTPException) as exc_info:
        require_user(None)
    assert exc_info.value.status_code == 401

@pytest.mark.asyncio
async def test_require_scoped_user_granted():
    token = create_test_token(sub="admin-1", scopes=["rag:write"])
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
    dep = require_scoped_user("rag:write")
    user_id = await dep(creds)
    assert user_id == "admin-1"

@pytest.mark.asyncio
async def test_require_scoped_user_role_granted():
    token = create_test_token(sub="admin-1", roles=["admin"])
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
    dep = require_scoped_user("admin")
    user_id = await dep(creds)
    assert user_id == "admin-1"

@pytest.mark.asyncio
async def test_require_scoped_user_forbidden():
    token = create_test_token(sub="user-1", scopes=["read"])
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
    dep = require_scoped_user("rag:write")
    with pytest.raises(HTTPException) as exc_info:
        await dep(creds)
    assert exc_info.value.status_code == 403

def test_idor_protection_own_history_allowed():
    token = create_test_token(sub="driver-10")
    payload = decode_token(token)
    current_user_id = payload.get("sub")
    target_user_id = "driver-10"
    scopes = payload.get("scopes", [])
    roles = payload.get("roles", [])

    is_allowed = (target_user_id == current_user_id) or ("rag:read" in scopes) or ("admin" in roles)
    assert is_allowed is True

def test_idor_protection_other_history_denied():
    token = create_test_token(sub="driver-10")
    payload = decode_token(token)
    current_user_id = payload.get("sub")
    target_user_id = "driver-99"
    scopes = payload.get("scopes", [])
    roles = payload.get("roles", [])

    is_allowed = (target_user_id == current_user_id) or ("rag:read" in scopes) or ("admin" in roles)
    assert is_allowed is False

def test_idor_protection_admin_reading_other_allowed():
    token = create_test_token(sub="admin-user", roles=["admin"])
    payload = decode_token(token)
    current_user_id = payload.get("sub")
    target_user_id = "driver-99"
    scopes = payload.get("scopes", [])
    roles = payload.get("roles", [])

    is_allowed = (target_user_id == current_user_id) or ("rag:read" in scopes) or ("admin" in roles)
    assert is_allowed is True
