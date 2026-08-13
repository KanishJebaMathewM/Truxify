import pytest
from backend.ml.pirl.eco_driving_pirl import soft_update, DEFAULT_TAU
def test_default(): assert DEFAULT_TAU == 0.005
def test_upd():
    out = soft_update([0,0], [1,1])
    assert all(abs(v - 0.005) < 1e-9 for v in out)
def test_bad():
    with pytest.raises(ValueError): soft_update([0],[1], tau=1.0)
