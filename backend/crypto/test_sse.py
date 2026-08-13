import unittest
from sse_engine import SymmetricSearchableEncryptionEngine

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
        self.assertEqual(match, doc_id)

        # Search using invalid trapdoor token
        invalid_trapdoor = self.engine.generate_trapdoor("Mumbai")
        no_match = self.engine.search_index(invalid_trapdoor, enc_index)
        self.assertIsNone(no_match)

if __name__ == '__main__':
    unittest.main()
