import json
import sys
from unittest.mock import patch, MagicMock

import numpy as np
import pytest

# Mock TensorFlow if not available in current runtime
if "tensorflow" not in sys.modules:
    mock_tf = MagicMock()
    mock_tf.keras = MagicMock()
    mock_tf.keras.models = MagicMock()
    mock_tf.keras.layers = MagicMock()
    mock_tf.keras.optimizers = MagicMock()
    sys.modules["tensorflow"] = mock_tf
    sys.modules["tensorflow.keras"] = mock_tf.keras


@pytest.fixture(autouse=True)
def mock_checkpoint_saving():
    with patch("federated.federated_server.FederatedServer._save_checkpoint"):
        yield


class TestFederated:
    @patch("redis.Redis.from_url")
    def test_federated_server_init(self, mock_redis):
        from federated.federated_server import FederatedServer
        server = FederatedServer()
        assert server.round == 0
        assert server.min_clients == 3

    @patch("redis.Redis.from_url")
    def test_federated_client_init(self, mock_redis):
        from federated.federated_client import FederatedClient
        client = FederatedClient(client_id="client-101")
        assert client.client_id == "client-101"
        client.stop_subscription()

    @patch("redis.Redis.from_url")
    def test_round_with_three_clients_aggregates(self, mock_redis):
        """A round with only 3 (fewer than clients_per_round=5) clients must
        still aggregate once all selected clients respond."""
        from federated.federated_server import FederatedServer
        server = FederatedServer()
        # Three available/registered clients; the round selects all three.
        server.redis.smembers.return_value = {b"c1", b"c2", b"c3"}
        round_info = server.start_round()
        assert round_info is not None
        assert set(server.selected_clients) == {"c1", "c2", "c3"}

        # Build an encrypted weight payload the server can decrypt. Shapes
        # mirror the driver-behavior model defined in _create_model.
        def make_update(client_id):
            zeros = [
                np.zeros((10, 64)), np.zeros((64,)),
                np.zeros((64, 32)), np.zeros((32,)),
                np.zeros((32, 1)), np.zeros((1,)),
            ]
            payload = server.cipher.encrypt(
                json.dumps({
                    'round': server.round,
                    'weights': [w.tolist() for w in zeros]
                }).encode()
            )
            return server.receive_client_update(client_id, payload)

        r1 = make_update("c1")
        r2 = make_update("c2")
        assert r1["success"] and r2["success"]
        assert len(server.client_weights) == 2
        assert not server.round_completed

        # All 3 selected clients respond -> triggers aggregation
        r3 = make_update("c3")
        assert r3["success"]

        # Aggregation clears the round's client_weights and completes the round.
        assert server.client_weights == {}
        assert server.round == 1
        assert server.round_completed is True
        server.stop_update_consumer()

