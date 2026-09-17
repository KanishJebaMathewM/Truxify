import hashlib
import hmac


class SymmetricSearchableEncryptionEngine:
    """
    Curtmola Symmetric Searchable Encryption (SSE) Engine.
    Allows keyword search queries over encrypted databases without plaintext disclosure.
    """
    def __init__(self, key: str = "truxify_sse_master_key"):
        self.key = key.encode('utf-8')

    def generate_trapdoor(self, keyword: str) -> str:
        """Generates cryptographically secure trapdoor search token for a keyword.

        HMAC-SHA256 over the keyed keyword replaces the previous raw
        SHA-256(key || keyword) concatenation, which was vulnerable to
        length-extension and key-concatenation weaknesses. Keyword trapdoors
        stay deterministic — that is inherent to server-side SSE — so the
        server can look up all documents for a keyword.
        """
        h = hmac.new(self.key, keyword.encode('utf-8'), hashlib.sha256).hexdigest()
        return h

    def build_encrypted_index(self, document_id: str, keywords: list, index_map: dict = None) -> dict:
        """Constructs index maps binding encrypted keywords to document IDs.

        Each trapdoor maps to a *list* of document IDs so a keyword shared by
        multiple documents (or a repeated keyword) never overwrites earlier
        entries. Pass an existing index_map to accumulate a global inverted
        index across documents (issue #11677).
        """
        if index_map is None:
            index_map = {}
        for keyword in keywords:
            trapdoor = self.generate_trapdoor(keyword)
            bucket = index_map.setdefault(trapdoor, [])
            if document_id not in bucket:
                bucket.append(document_id)
        return index_map

    def search_index(self, trapdoor: str, encrypted_index: dict) -> list:
        """Return the list of document IDs matching the trapdoor (empty if none)."""
        return encrypted_index.get(trapdoor, [])


sse_engine = SymmetricSearchableEncryptionEngine()

# Stub for spec 49
# === Spec 49: index GC ===
import hashlib
import hmac

# Fixed PRF key used to derive search tokens from keywords. In a deployed
# scheme this would be the client-held SSE secret; the server only ever sees
# the derived tokens, never the plaintext keyword.
_SSE_KEY = b"sse-spec-49-keyword-prf"


def _prf(keyword):
    return hmac.new(_SSE_KEY, str(keyword).lower().encode("utf-8"), hashlib.sha256).hexdigest()


def _tokenize(text):
    return [w for w in str(text).lower().split() if w]


def build_index(documents):
    """Build an encrypted inverted index from a document set.

    `documents` maps doc_id -> text. Keywords are hashed with a PRF so the
    stored index never contains plaintext keywords. Returns (index, tokens)
    where `index` maps a search token to a list of doc_ids and `tokens` maps
    each keyword to its search token (for the index owner).
    """
    index = {}
    tokens = {}
    for doc_id, text in documents.items():
        for kw in set(_tokenize(text)):
            token = _prf(kw)
            tokens[kw] = token
            index.setdefault(token, [])
            if doc_id not in index[token]:
                index[token].append(doc_id)
    return index, tokens


def get_token(keyword):
    """Return the search token for a keyword."""
    return _prf(keyword)


def search(index, token):
    """Return the doc_ids matching a search token."""
    return list(index.get(token, []))


def gc_inverted_index(idx, valid):
    r = 0
    for t, p in list(idx.items()):
        o = len(p)
        idx[t] = [d for d in p if d in valid]
        r += o - len(idx[t])
    return r
