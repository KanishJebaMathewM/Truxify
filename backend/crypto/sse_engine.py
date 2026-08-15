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

