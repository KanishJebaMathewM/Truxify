import unittest
import numpy as np
from ann_encrypted import HomomorphicVectorSearchEngine

class TestHomomorphicVectorSearch(unittest.TestCase):
    def setUp(self):
        self.engine = HomomorphicVectorSearchEngine(vector_dim=4)

    def test_encrypted_vector_search(self):
        query = np.array([0.5, 0.5, 0.5, 0.5])
        encrypted_query = self.engine.encrypt_vector(query)

        candidates = np.array([
            [1.0, 0.0, 0.0, 0.0],
            [0.5, 0.5, 0.5, 0.5],
            [0.0, 0.0, 0.0, 1.0]
        ])

        top_matches = self.engine.search_top_matches(encrypted_query, candidates, top_k=2)
        
        self.assertEqual(len(top_matches), 2)
        self.assertEqual(top_matches[0][0], 1) # Best match is index 1

if __name__ == '__main__':
    unittest.main()
