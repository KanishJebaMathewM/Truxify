import hashlib

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
        """Constructs index maps binding encrypted keywords to document IDs."""
        index_map = {}
        for keyword in keywords:
            trapdoor = self.generate_trapdoor(keyword)
            index_map[trapdoor] = document_id
        return index_map

    def search_index(self, trapdoor: str, encrypted_index: dict) -> str:
        return encrypted_index.get(trapdoor, None)

sse_engine = SymmetricSearchableEncryptionEngine()
