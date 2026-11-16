
import hashlib
import hmac
import os
import re
import unicodedata

from typing import Dict, List, Tuple, Optional, Set


# =====================================================
# CONFIGURATION
# =====================================================

TOKEN_PATTERN = re.compile(r"^[0-9a-f]{64}$")

TOKEN_CONTEXT = b"TRUXIFY:SSE:SEARCH:V1:"


# =====================================================
# KEY MANAGEMENT
# =====================================================

def _load_sse_key(key: Optional[str] = None) -> bytes:
    """Load and validate the SSE master key."""

    configured_key = (
        key if key is not None
        else os.getenv("TRUXIFY_SSE_MASTER_KEY")
    )

    if not isinstance(configured_key, str) or not configured_key:
        raise ValueError(
            "TRUXIFY_SSE_MASTER_KEY is required."
        )

    key_bytes = configured_key.encode("utf-8")

    if len(key_bytes) < 32:
        raise ValueError(
            "SSE master key must contain at least 32 bytes."
        )

    return key_bytes


# =====================================================
# INPUT VALIDATION
# =====================================================

def _validate_document_id(document_id: str) -> str:
    """Validate document identifiers."""

    if not isinstance(document_id, str) or not document_id.strip():
        raise ValueError("Invalid document ID.")

    return document_id


def _normalize_keyword(keyword: str) -> str:
    """Normalize keywords consistently."""

    if not isinstance(keyword, str):
        raise TypeError("Keyword must be a string.")

    normalized = unicodedata.normalize(
        "NFKC", keyword
    ).strip().casefold()

    if not normalized:
        raise ValueError("Keyword cannot be empty.")

    return normalized


def _validate_token(token: str) -> str:
    """Validate HMAC search tokens."""

    if not isinstance(token, str):
        raise TypeError("Token must be a string.")

    if not TOKEN_PATTERN.fullmatch(token):
        raise ValueError("Invalid search token.")

    return token


def _validate_index(index: dict) -> None:
    """Validate inverted index structure."""

    if not isinstance(index, dict):
        raise TypeError("Index must be a dictionary.")

    for token, documents in index.items():

        _validate_token(token)

        if not isinstance(documents, list):
            raise TypeError(
                f"Invalid posting list for token: {token}"
            )

        if any(
            not isinstance(doc_id, str) or not doc_id.strip()
            for doc_id in documents
        ):
            raise ValueError("Invalid document ID in index.")


# =====================================================
# TOKEN GENERATION
# =====================================================

def _generate_token(key: bytes, keyword: str) -> str:
    """Generate a domain-separated HMAC-SHA256 token."""

    normalized = _normalize_keyword(keyword)

    message = TOKEN_CONTEXT + normalized.encode("utf-8")

    return hmac.new(
        key,
        message,
        hashlib.sha256
    ).hexdigest()


# =====================================================
# SSE ENGINE
# =====================================================

class SymmetricSearchableEncryptionEngine:
    """
    Symmetric Searchable Encryption Engine.

    Generates deterministic HMAC search tokens
    and maintains an inverted search index.
    """

    def __init__(self, key: Optional[str] = None):
        self.key = _load_sse_key(key)

    def generate_trapdoor(self, keyword: str) -> str:
        """Generate a deterministic search trapdoor."""

        return _generate_token(self.key, keyword)

    def build_encrypted_index(
        self,
        document_id: str,
        keywords: List[str],
        index_map: Optional[Dict[str, List[str]]] = None
    ) -> Dict[str, List[str]]:
        """Add document keywords to the search index."""

        document_id = _validate_document_id(document_id)

        if not isinstance(keywords, list):
            raise TypeError("Keywords must be a list.")

        if index_map is None:
            index_map = {}

        _validate_index(index_map)

        # Normalize and remove duplicate keywords.
        normalized_keywords = dict.fromkeys(
            _normalize_keyword(keyword)
            for keyword in keywords
        )

        for keyword in normalized_keywords:

            token = self.generate_trapdoor(keyword)

            bucket = index_map.setdefault(token, [])

            if document_id not in bucket:
                bucket.append(document_id)

        return index_map

    def search_index(
        self,
        trapdoor: str,
        encrypted_index: Dict[str, List[str]]
    ) -> List[str]:
        """Search documents using a trapdoor."""

        _validate_token(trapdoor)
        _validate_index(encrypted_index)

        return list(encrypted_index.get(trapdoor, []))


# =====================================================
# SHARED SSE FUNCTIONS
# =====================================================

def _prf(keyword: str) -> str:
    """Generate a keyed pseudorandom search token."""

    key = _load_sse_key()

    return _generate_token(key, keyword)


def _tokenize(text: str) -> List[str]:
    """Extract normalized keywords from document text."""

    if not isinstance(text, str):
        raise TypeError("Document text must be a string.")

    normalized = unicodedata.normalize(
        "NFKC", text
    ).casefold()

    return re.findall(r"\w+", normalized, flags=re.UNICODE)


# =====================================================
# INDEX CONSTRUCTION
# =====================================================

def build_index(
    documents: Dict[str, str]
) -> Tuple[Dict[str, List[str]], Dict[str, str]]:
    """Build an HMAC-based inverted index."""

    if not isinstance(documents, dict):
        raise TypeError("Documents must be a dictionary.")

    index: Dict[str, List[str]] = {}
    tokens: Dict[str, str] = {}

    key = _load_sse_key()

    for doc_id, text in documents.items():

        _validate_document_id(doc_id)

        # Remove duplicate words while preserving order.
        keywords = dict.fromkeys(_tokenize(text))

        for keyword in keywords:

            token = _generate_token(key, keyword)

            tokens[keyword] = token

            bucket = index.setdefault(token, [])

            if doc_id not in bucket:
                bucket.append(doc_id)

    return index, tokens


# =====================================================
# SEARCH OPERATIONS
# =====================================================

def get_token(keyword: str) -> str:
    """Return a deterministic search token."""

    return _prf(keyword)


def search(
    index: Dict[str, List[str]],
    token: str
) -> List[str]:
    """Return documents matching a search token."""

    _validate_token(token)
    _validate_index(index)

    return list(index.get(token, []))


# =====================================================
# GARBAGE COLLECTION
# =====================================================

def gc_inverted_index(
    idx: Dict[str, List[str]],
    valid: Set[str]
) -> int:
    """
    Remove invalid document IDs from the inverted index.

    Returns the number of removed posting entries.
    """

    _validate_index(idx)

    if not isinstance(valid, (set, list, tuple)):
        raise TypeError(
            "Valid document IDs must be a collection."
        )

    if any(
        not isinstance(doc_id, str) or not doc_id.strip()
        for doc_id in valid
    ):
        raise ValueError("Invalid document ID in valid collection.")

    valid_ids = set(valid)

    removed = 0

    for token in list(idx.keys()):

        original = idx[token]

        filtered = [
            doc_id for doc_id in original
            if doc_id in valid_ids
        ]

        removed += len(original) - len(filtered)

        if filtered:
            idx[token] = filtered
        else:
            del idx[token]

    return removed
