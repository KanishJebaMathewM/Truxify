
import os
import sys
import subprocess
from pathlib import Path

import pytest

from sse_engine import (
    SymmetricSearchableEncryptionEngine,
    gc_inverted_index,
)


# Test-only secret. Never use this key in production.
TEST_SECRET = "test-sse-master-key-0123456789012345"

os.environ["TRUXIFY_SSE_MASTER_KEY"] = TEST_SECRET


@pytest.fixture
def engine():
    return SymmetricSearchableEncryptionEngine(TEST_SECRET)


class TestSSE:

    def test_missing_secret_rejected(self):
        env = os.environ.copy()
        env.pop("TRUXIFY_SSE_MASTER_KEY", None)

        repo_root = Path(__file__).resolve().parents[2]

        existing_path = env.get("PYTHONPATH")
        env["PYTHONPATH"] = (
            str(repo_root)
            if not existing_path
            else os.pathsep.join([str(repo_root), existing_path])
        )

        result = subprocess.run(
            [
                sys.executable,
                "-c",
                "import backend.crypto.sse_engine",
            ],
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
        )

        assert result.returncode != 0, (
            "SSE engine should reject missing master key"
        )

        assert (
            "TRUXIFY_SSE_MASTER_KEY is required"
            in result.stderr + result.stdout
        )

    def test_weak_secret_rejected(self):
        with pytest.raises(ValueError):
            SymmetricSearchableEncryptionEngine("too-short")

    def test_search_confidential_order(self, engine):
        doc_id = "ORDER_DOC_XYZ"
        keywords = ["FMCG", "Delhi", "Hazardous"]

        encrypted_index = engine.build_encrypted_index(
            doc_id, keywords
        )

        trapdoor = engine.generate_trapdoor("Delhi")

        matches = engine.search_index(
            trapdoor, encrypted_index
        )

        assert matches == [doc_id]

        invalid_trapdoor = engine.generate_trapdoor("Mumbai")

        no_matches = engine.search_index(
            invalid_trapdoor, encrypted_index
        )

        assert no_matches == []

    def test_multi_document_keyword_returns_all_matches(self, engine):
        index = engine.build_encrypted_index(
            "DOC_A", ["Delhi", "FMCG"]
        )

        index = engine.build_encrypted_index(
            "DOC_B",
            ["Delhi", "Hazardous"],
            index,
        )

        trapdoor = engine.generate_trapdoor("Delhi")

        matches = engine.search_index(trapdoor, index)

        assert sorted(matches) == ["DOC_A", "DOC_B"]

    def test_duplicate_keywords_are_deduplicated(self, engine):
        index = engine.build_encrypted_index(
            "DOC_C", ["Delhi", "Delhi"]
        )

        trapdoor = engine.generate_trapdoor("Delhi")

        matches = engine.search_index(trapdoor, index)

        assert matches == ["DOC_C"]

    def test_multiple_keywords_are_searchable(self, engine):
        keywords = ["Delhi", "Mumbai", "Chennai"]

        index = engine.build_encrypted_index(
            "DOC_D", keywords
        )

        for keyword in keywords:
            trapdoor = engine.generate_trapdoor(keyword)

            assert engine.search_index(
                trapdoor, index
            ) == ["DOC_D"]

    def test_case_sensitivity(self, engine):
        index = engine.build_encrypted_index(
            "DOC_E", ["Delhi"]
        )

        trapdoor = engine.generate_trapdoor("delhi")

        # Expected behavior: case-sensitive keyword matching.
        assert engine.search_index(trapdoor, index) == []

    def test_empty_document_keywords(self, engine):
        index = engine.build_encrypted_index("DOC_EMPTY", [])

        trapdoor = engine.generate_trapdoor("Delhi")

        assert engine.search_index(trapdoor, index) == []


class TestGarbageCollection:

    def test_gc_removes_unused_entries(self):
        result = gc_inverted_index(
            {"a": ["x", "y"]},
            {"x"},
        )

        assert result == 1

    def test_gc_with_empty_index(self):
        assert gc_inverted_index({}, set()) == 0

    def test_gc_with_no_unused_entries(self):
        index = {"a": ["x", "y"]}

        assert gc_inverted_index(
            index, {"x", "y"}
        ) == 0

    def test_gc_with_multiple_unused_entries(self):
        index = {
            "a": ["x", "y"],
            "b": ["z"],
        }

        result = gc_inverted_index(
            index, {"x"}
        )

        assert result == 2


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
