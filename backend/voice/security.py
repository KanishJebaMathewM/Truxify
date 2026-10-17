"""
JWT authentication for the standalone Voice AI service.

The Node API issues backend JWTs signed with JWT_SECRET. This service validates
those tokens directly so callers cannot choose the identity used for voice
processing.
"""

import logging
import os
from typing import Optional

from fastapi import HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

logger = logging.getLogger(__name__)

JWT_ALGORITHM = "HS256"
bearer = HTTPBearer(auto_error=False)


class AuthError(Exception):
    """Raised when the Voice AI authentication configuration or token is invalid."""

    def __init__(self, message: str, status_code: int = 401):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _get_jwt_secret() -> str:
    secret = os.getenv("JWT_SECRET")
    if not secret:
        logger.error("JWT_SECRET is not configured")
        raise AuthError("Authentication is temporarily unavailable.", 503)
    return secret


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(
            token,
            _get_jwt_secret(),
            algorithms=[JWT_ALGORITHM],
            options={"verify_exp": True},
        )
    except JWTError as exc:
        logger.warning("JWT validation failed: %s", exc)
        raise AuthError("Invalid or expired token", 401) from exc


def require_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Security(bearer),
) -> str:
    if not credentials:
        raise HTTPException(
            status_code=401,
            detail="Authentication required. Provide Bearer token in Authorization header.",
        )

    try:
        payload = decode_token(credentials.credentials)
    except AuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

    user_id = payload.get("id") or payload.get("uid") or payload.get("sub")
    if not user_id or not isinstance(user_id, str):
        raise HTTPException(status_code=401, detail="Token missing user identity")

    return user_id
