"""
Authentication and authorization module for LLM service.
Mirrors the backend API auth patterns (JWT validation, role-based access).
"""
from fastapi import Depends, HTTPException, Security, UploadFile
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from typing import Optional, List
import os
import logging

logger = logging.getLogger(__name__)

# Security scheme
bearer_scheme = HTTPBearer(auto_error=False)

# JWT configuration
JWT_SECRET = os.getenv("JWT_SECRET", "your-secret-key-change-in-production")
JWT_ALGORITHM = "HS256"
JWT_ISSUER = os.getenv("JWT_ISSUER", "truxify")

# Trusted roles for RAG write access
RAG_WRITE_ROLES = {"admin", "driver", "fleet_manager"}

bearer = HTTPBearer(auto_error=False)


class AuthError(Exception):
    """Custom auth error."""
    def __init__(self, message: str, status_code: int = 401):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


def decode_token(token: str) -> dict:
    """
    Decode and validate JWT token.
    Raises AuthError on failure.
    """
    try:
        payload = jwt.decode(
            token,
            JWT_SECRET,
            algorithms=[JWT_ALGORITHM],
            issuer=JWT_ISSUER,
            options={"verify_exp": True}
        )
        return payload
    except JWTError as e:
        logger.warning(f"JWT decode failed: {e}")
        raise AuthError("Invalid or expired token", 401)


def require_user(
    credentials: HTTPAuthorizationCredentials = Security(bearer)
) -> str:
    """
    FastAPI dependency that validates the Bearer token and returns the user_id.
    Raises 401 if token is missing or invalid.
    """
    if not credentials:
        raise HTTPException(
            status_code=401,
            detail="Authentication required. Provide Bearer token in Authorization header."
        )
    payload = decode_token(credentials.credentials)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Token missing subject claim")
    return user_id


def require_scoped_user(required_scope: str):
    """
    Factory that creates a dependency requiring a specific scope/role.
    """
    async def dependency(
        credentials: HTTPAuthorizationCredentials = Security(bearer)
    ) -> str:
        if not credentials:
            raise HTTPException(
                status_code=401,
                detail="Authentication required. Provide Bearer token in Authorization header."
            )
        payload = decode_token(credentials.credentials)
        scopes = payload.get("scopes", [])
        roles = payload.get("roles", [])
        
        # Check scope or role
        if required_scope not in scopes and required_scope not in roles:
            raise HTTPException(
                status_code=403,
                detail=f"Required scope '{required_scope}' not granted"
            )
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Token missing subject claim")
        return user_id
    return dependency


# Convenience dependencies
require_rag_write = require_scoped_user("rag:write")
require_rag_read = require_scoped_user("rag:read")


async def validate_upload_file(
    file: UploadFile,
    max_size: int = 10 * 1024 * 1024,  # 10 MB
    allowed_types: Optional[set] = None
) -> bytes:
    """
    Validate uploaded file: size, type, and sanitize filename.
    Returns file content as bytes.
    """
    if allowed_types is None:
        allowed_types = {
            "application/json",
            "text/plain",
            "application/pdf",
        }
    
    # Check content type
    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported media type: {file.content_type}. Allowed: {', '.join(allowed_types)}"
        )
    
    # Check content-length header if present
    content_length = file.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > max_size:
                raise HTTPException(
                    status_code=413,
                    detail=f"File too large. Maximum allowed: {max_size // (1024*1024)} MB"
                )
        except ValueError:
            pass
    
    # Read file in chunks to enforce size limit
    content = bytearray()
    chunk_size = 64 * 1024  # 64 KB
    while True:
        chunk = await file.read(chunk_size)
        if not chunk:
            break
        content.extend(chunk)
        if len(content) > max_size:
            raise HTTPException(
                status_code=413,
                detail=f"File too large. Maximum allowed: {max_size // (1024*1024)} MB"
            )
    
    return bytes(content)


def sanitize_filename(filename: str) -> str:
    """
    Sanitize filename to prevent path traversal.
    Returns only the base name.
    """
    import pathlib
    return pathlib.Path(filename).name