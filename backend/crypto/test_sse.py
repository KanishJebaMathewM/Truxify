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
        self.assertEqual(match, {doc_id})

        # Search using invalid trapdoor token
        invalid_trapdoor = self.engine.generate_trapdoor("Mumbai")
        no_match = self.engine.search_index(invalid_trapdoor, enc_index)
        self.assertIsNone(no_match)

    def test_shared_keyword_retains_all_documents(self):
        doc_id_a = "DOC_A"
        doc_id_b = "DOC_B"
        shared_keyword = "Hazardous"

        index_a = self.engine.build_encrypted_index(doc_id_a, [shared_keyword, "Delhi"])
        index_b = self.engine.build_encrypted_index(doc_id_b, [shared_keyword, "Mumbai"])

        # Merge the per-document indexes into a single global index.
        global_index = {}
        for index in (index_a, index_b):
            for trapdoor, doc_ids in index.items():
                global_index.setdefault(trapdoor, set()).update(doc_ids)

        trapdoor = self.engine.generate_trapdoor(shared_keyword)
        match = self.engine.search_index(trapdoor, global_index)
        self.assertEqual(match, {doc_id_a, doc_id_b})

if __name__ == '__main__':
    unittest.main()
