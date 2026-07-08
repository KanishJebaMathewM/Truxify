import os
import pytest

@pytest.fixture(scope="session", autouse=True)
def setup_env():
    os.environ["ML_API_KEY"] = "test_key"
