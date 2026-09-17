import os
from pathlib import Path

os.environ.setdefault('TRUXIFY_SSE_MASTER_KEY', 'test-sse-master-key-0123456789012345')

import subprocess
import sys
import unittest
import pytest
from sse_engine import SymmetricSearchableEncryptionEngine, gc_inverted_index


class TestSSE(unittest.TestCase):
    def setUp(self):
        self.engine = SymmetricSearchableEncryptionEngine()

    def test_missing_secret_rejected(self):
        env = os.environ.copy()
        env.pop('TRUXIFY_SSE_MASTER_KEY', None)
        repo_root = Path(__file__).resolve().parents[2]
        existing_pythonpath = env.get('PYTHONPATH')
        env['PYTHONPATH'] = (
            str(repo_root)
            if not existing_pythonpath
            else os.pathsep.join([str(repo_root), existing_pythonpath])
        )
        result = subprocess.run(
            [sys.executable, '-c', 'import backend.crypto.sse_engine'],
            env=env,
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('TRUXIFY_SSE_MASTER_KEY is required', result.stderr + result.stdout)

    def test_weak_secret_rejected(self):
        with self.assertRaises(ValueError):
            SymmetricSearchableEncryptionEngine('too-short')

    def test_search_confidential_order(self):
        doc_id = "ORDER_DOC_XYZ"
        keywords = ["FMCG", "Delhi", "Hazardous"]

        enc_index = self.engine.build_encrypted_index(doc_id, keywords)

        trapdoor = self.engine.generate_trapdoor("Delhi")
        match = self.engine.search_index(trapdoor, enc_index)
        self.assertEqual(match, [doc_id])

        invalid_trapdoor = self.engine.generate_trapdoor("Mumbai")
        no_match = self.engine.search_index(invalid_trapdoor, enc_index)
        self.assertEqual(no_match, [])

    def test_multi_document_keyword_returns_all_matches(self):
        index = self.engine.build_encrypted_index("DOC_A", ["Delhi", "FMCG"])
        index = self.engine.build_encrypted_index("DOC_B", ["Delhi", "Hazardous"], index)

        trapdoor = self.engine.generate_trapdoor("Delhi")
        matches = self.engine.search_index(trapdoor, index)
        self.assertEqual(sorted(matches), ["DOC_A", "DOC_B"])

    def test_duplicate_keywords_in_one_document_are_deduplicated(self):
        index = self.engine.build_encrypted_index("DOC_C", ["Delhi", "Delhi"])
        matches = self.engine.search_index(self.engine.generate_trapdoor("Delhi"), index)
        self.assertEqual(matches, ["DOC_C"])


def test_gc():
    assert gc_inverted_index({"a": ["x", "y"]}, {"x"}) == 1


if __name__ == '__main__':
    unittest.main()
