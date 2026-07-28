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
