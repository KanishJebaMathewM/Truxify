import json

import numpy as np
import pytest
from unittest.mock import patch, MagicMock

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

    @patch("redis.Redis.from_url")
    def test_round_with_three_clients_aggregates(self, mock_redis):
        """A round with only 3 (fewer than clients_per_round=5) clients must
        still aggregate once a quorum of the selected clients respond."""
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
                json.dumps([w.tolist() for w in zeros]).encode()
            )
            return server.receive_client_update(client_id, payload)

        # Quorum for 3 selected clients is ceil(3/2) = 2 responses.
        r1 = make_update("c1")
        r2 = make_update("c2")
        assert r1["success"] and r2["success"]
        # Aggregation clears the round's client_weights and advances the model.
        assert server.client_weights == {}
        assert server.round == 1

