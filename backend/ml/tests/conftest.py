import os
import pytest

@pytest.fixture(scope="session", autouse=True)
def setup_env():
    os.environ["ML_API_KEY"] = "test_key"
    os.environ["MODEL_ARTIFACT_HMAC_KEY"] = "test-model-artifact-key"
