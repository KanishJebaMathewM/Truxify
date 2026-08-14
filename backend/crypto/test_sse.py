import pytest
from backend.crypto.sse_engine import gc_inverted_index
def test_gc():
    assert gc_inverted_index({"a": ["x", "y"]}, {"x"}) == 1
