import hashlib
import hmac
import os


class SymmetricSearchableEncryptionEngine:
    """
    Curtmola Symmetric Searchable Encryption (SSE) Engine.
    Allows keyword search queries over encrypted databases without plaintext disclosure.
    """
    def __init__(self, key: str = None):
        configured_key = key if key is not None else os.getenv('TRUXIFY_SSE_MASTER_KEY')
        if not configured_key:
            raise ValueError('TRUXIFY_SSE_MASTER_KEY is required; refusing to initialize SSE without a configured secret.')
        if len(configured_key.encode('utf-8')) < 32:
            raise ValueError('TRUXIFY_SSE_MASTER_KEY must contain at least 32 bytes.')
        self.key = configured_key.encode('utf-8')

    def generate_trapdoor(self, keyword: str) -> str:
        """Generates a cryptographically keyed deterministic search token."""
        h = hmac.new(self.key, keyword.encode('utf-8'), hashlib.sha256).hexdigest()
        return h

    def build_encrypted_index(self, document_id: str, keywords: list, index_map: dict = None) -> dict:
        """Constructs index maps binding encrypted keywords to document IDs."""
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

# === Spec 49: index GC ===


def _load_spec49_key() -> bytes:
    configured_key = os.getenv('TRUXIFY_SSE_MASTER_KEY')
    if not configured_key:
        raise ValueError('TRUXIFY_SSE_MASTER_KEY is required; refusing to initialize Spec 49 SSE without a configured secret.')
    if len(configured_key.encode('utf-8')) < 32:
        raise ValueError('TRUXIFY_SSE_MASTER_KEY must contain at least 32 bytes.')
    return configured_key.encode('utf-8')


def _prf(keyword):
    return hmac.new(_load_spec49_key(), str(keyword).lower().encode('utf-8'), hashlib.sha256).hexdigest()


def _tokenize(text):
    return [w for w in str(text).lower().split() if w]


def build_index(documents):
    """Build an encrypted inverted index from a document set."""
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
