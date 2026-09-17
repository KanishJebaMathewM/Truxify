import unittest
import pytest
from sse_engine import SymmetricSearchableEncryptionEngine
from backend.crypto.sse_engine import gc_inverted_index

class TestSSE(unittest.TestCase):
    def setUp(self):
        self.engine = SymmetricSearchableEncryptionEngine()

    def test_search_confidential_order(self):
        doc_id = "ORDER_DOC_XYZ"
        keywords = ["FMCG", "Delhi", "Hazardous"]
        
        enc_index = self.engine.build_encrypted_index(doc_id, keywords)
        
        # Search using valid trapdoor token
        trapdoor = self.engine.generate_trapdoor("Delhi")
        match = self.engine.search_index(trapdoor, enc_index)
        self.assertEqual(match, [doc_id])

        # Search using invalid trapdoor token
        invalid_trapdoor = self.engine.generate_trapdoor("Mumbai")
        no_match = self.engine.search_index(invalid_trapdoor, enc_index)
        self.assertEqual(no_match, [])

    def test_multi_document_keyword_returns_all_matches(self):
        """A keyword shared by several documents must not overwrite earlier
        entries; the index accumulates a list per trapdoor (issue #11677)."""
        index = self.engine.build_encrypted_index("DOC_A", ["Delhi", "FMCG"])
        index = self.engine.build_encrypted_index("DOC_B", ["Delhi", "Hazardous"], index)

        trapdoor = self.engine.generate_trapdoor("Delhi")
        matches = self.engine.search_index(trapdoor, index)
        self.assertEqual(sorted(matches), ["DOC_A", "DOC_B"])

        self.assertEqual(
            self.engine.search_index(self.engine.generate_trapdoor("FMCG"), index),
            ["DOC_A"]
        )
        self.assertEqual(
            self.engine.search_index(self.engine.generate_trapdoor("Hazardous"), index),
            ["DOC_B"]
        )

    def test_duplicate_keywords_in_one_document_are_deduplicated(self):
        """Repeated keywords within a document yield a single entry."""
        index = self.engine.build_encrypted_index("DOC_C", ["Delhi", "Delhi"])
        matches = self.engine.search_index(self.engine.generate_trapdoor("Delhi"), index)
        self.assertEqual(matches, ["DOC_C"])

def test_gc():
    assert gc_inverted_index({"a": ["x", "y"]}, {"x"}) == 1

if __name__ == '__main__':
    unittest.main()
