import hashlib
from collections import defaultdict


class SymmetricSearchableEncryptionEngine:
    """
    Curtmola Symmetric Searchable Encryption (SSE) Engine.
    Allows keyword search queries over encrypted databases without plaintext disclosure.
    """
    def __init__(self, key: str = "truxify_sse_master_key"):
        self.key = key.encode('utf-8')

    def generate_trapdoor(self, keyword: str) -> str:
        """Generates cryptographically secure trapdoor search token for a keyword."""
        h = hashlib.sha256(self.key + keyword.encode('utf-8')).hexdigest()
        return h

    def build_encrypted_index(self, document_id: str, keywords: list) -> dict:
        """Constructs index maps binding encrypted keywords to a set of document IDs.

        A keyword trapdoor maps to a set of document IDs so that documents sharing a
        keyword are all retained instead of overwriting each other.
        """
        index_map = defaultdict(set)
        for keyword in keywords:
            trapdoor = self.generate_trapdoor(keyword)
            index_map[trapdoor].add(document_id)
        return index_map

    def merge_index(self, target: dict, source: dict) -> dict:
        """Merges another per-document (or global) index into the target index, unioning document id sets."""
        for trapdoor, doc_ids in source.items():
            target.setdefault(trapdoor, set()).update(doc_ids)
        return target

    def search_index(self, trapdoor: str, encrypted_index: dict) -> set:
        """Returns the set of document IDs matching the trapdoor, or None if absent."""
        return encrypted_index.get(trapdoor, None)


sse_engine = SymmetricSearchableEncryptionEngine()
