
import hashlib
import hmac
import os
import re
from typing import Dict, List, Tuple, Optional, Set


def _load_sse_key(key: Optional[str] = None) -> bytes:
    """Load and validate the SSE master key."""

    configured_key = (
        key if key is not None
        else os.getenv("TRUXIFY_SSE_MASTER_KEY")
    )

    if not configured_key:
        raise ValueError(
            "TRUXIFY_SSE_MASTER_KEY is required."
        )

    key_bytes = configured_key.encode("utf-8")

    if len(key_bytes) < 32:
        raise ValueError(
            "SSE master key must contain at least 32 bytes."
        )

    return key_bytes


def _normalize_keyword(keyword: str) -> str:
    """Normalize keywords consistently."""

    if not isinstance(keyword, str):
        raise TypeError("Keyword must be a string.")

    keyword = keyword.strip().lower()

    if not keyword:
        raise ValueError("Keyword cannot be empty.")

    return keyword


class SymmetricSearchableEncryptionEngine:
    """
    Symmetric Searchable Encryption (SSE) Engine.

    Generates deterministic HMAC search tokens and
    maintains an encrypted inverted index.
    """

    def __init__(self, key: Optional[str] = None):
        self.key = _load_sse_key(key)

    def generate_trapdoor(self, keyword: str) -> str:
        """Generate a deterministic HMAC-SHA256 search token."""

        normalized = _normalize_keyword(keyword)

        return hmac.new(
            self.key,
            normalized.encode("utf-8"),
            hashlib.sha256
        ).hexdigest()

    def build_encrypted_index(
        self,
        document_id: str,
        keywords: List[str],
        index_map: Optional[Dict[str, List[str]]] = None
    ) -> Dict[str, List[str]]:
        """Add document keywords to the searchable index."""

        if not isinstance(document_id, str) or not document_id.strip():
            raise ValueError("Invalid document ID.")

        if not isinstance(keywords, list):
            raise TypeError("Keywords must be a list.")

        if index_map is None:
            index_map = {}

        for keyword in set(keywords):
            trapdoor = self.generate_trapdoor(keyword)
            bucket = index_map.setdefault(trapdoor, [])

            if document_id not in bucket:
                bucket.append(document_id)

        return index_map

    def search_index(
        self,
        trapdoor: str,
        encrypted_index: Dict[str, List[str]]
    ) -> List[str]:
        """Search the index using a generated trapdoor."""

        if not isinstance(trapdoor, str):
            raise TypeError("Trapdoor must be a string.")

        if not re.fullmatch(r"[0-9a-f]{64}", trapdoor):
            raise ValueError("Invalid trapdoor format.")

        if not isinstance(encrypted_index, dict):
            raise TypeError("Encrypted index must be a dictionary.")

        return list(encrypted_index.get(trapdoor, []))


# === Shared Spec 49 SSE functions ===

def _prf(keyword: str) -> str:
    """Generate a keyed pseudorandom search token."""

    key = _load_sse_key()
    normalized = _normalize_keyword(keyword)

    return hmac.new(
        key,
        normalized.encode("utf-8"),
        hashlib.sha256
    ).hexdigest()


def _tokenize(text: str) -> List[str]:
    """Extract normalized word tokens from text."""

    if not isinstance(text, str):
        raise TypeError("Document text must be a string.")

    return re.findall(r"\w+", text.lower())


def build_index(
    documents: Dict[str, str]
) -> Tuple[Dict[str, List[str]], Dict[str, str]]:
    """Build an HMAC-based inverted index."""

    if not isinstance(documents, dict):
        raise TypeError("Documents must be a dictionary.")

    index: Dict[str, List[str]] = {}
    tokens: Dict[str, str] = {}

    for doc_id, text in documents.items():

        if not isinstance(doc_id, str) or not doc_id.strip():
            raise ValueError("Invalid document ID.")

        for keyword in set(_tokenize(text)):

            token = _prf(keyword)
            tokens[keyword] = token

            bucket = index.setdefault(token, [])

            if doc_id not in bucket:
                bucket.append(doc_id)

    return index, tokens


def get_token(keyword: str) -> str:
    """Return the deterministic search token."""

    return _prf(keyword)


def search(
    index: Dict[str, List[str]],
    token: str
) -> List[str]:
    """Return document IDs matching a search token."""

    if not isinstance(index, dict):
        raise TypeError("Index must be a dictionary.")

    if not isinstance(token, str):
        raise TypeError("Token must be a string.")

    if not re.fullmatch(r"[0-9a-f]{64}", token):
        raise ValueError("Invalid search token.")

    return list(index.get(token, []))


def gc_inverted_index(
    idx: Dict[str, List[str]],
    valid: Set[str]
) -> int:
    """
    Remove invalid document IDs from the inverted index.

    Returns the number of removed index entries.
    """

    if not isinstance(idx, dict):
        raise TypeError("Index must be a dictionary.")

    if not isinstance(valid, (set, list, tuple)):
        raise TypeError("Valid document IDs must be a collection.")

    valid_ids = set(valid)
    removed = 0

    for token in list(idx.keys()):

        if not isinstance(idx[token], list):
            raise TypeError(
                f"Invalid posting list for token: {token}"
            )

        original_count = len(idx[token])

        idx[token] = [
            doc_id for doc_id in idx[token]
            if doc_id in valid_ids
        ]

        removed += original_count - len(idx[token])

        if not idx[token]:
            del idx[token]

    return removed
