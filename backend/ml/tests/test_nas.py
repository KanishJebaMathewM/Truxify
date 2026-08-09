import pytest
from nas.model import NASSearchSpace

class TestNASModel:
    def test_nas_search_space_init(self):
        space = NASSearchSpace()
        assert space is not None
        assert hasattr(space, 'operations')
