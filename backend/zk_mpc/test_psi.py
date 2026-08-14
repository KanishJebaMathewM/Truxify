import pytest
from backend.zk_mpc.psi_matcher import validate_set_size, MAX_SET_SIZE
def test_ok(): assert validate_set_size([1,2]) == [1,2]
def test_too_big():
    with pytest.raises(ValueError): validate_set_size([0] * (MAX_SET_SIZE + 1))
