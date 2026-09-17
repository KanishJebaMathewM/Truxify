"""Unit and integration tests for Federated Learning Orchestration.

Tests:
1. Server initialization & config validation (clients_per_round >= min_clients).
2. Round start client selection and state persistence in Redis.
3. Atomic get-and-delete (atomic_getdel) preventing double processing.
4. Fallback pending key draining (drain_pending_client_updates).
5. Protection against duplicate aggregation for the same round.
6. Client round synchronization upon weight receipt.
7. Idempotent /client/participate route behavior.
8. /server/aggregate route error on empty weights vs success when drained.
"""

import json
import sys
from unittest.mock import MagicMock, patch

import numpy as np
import pytest
from fastapi.testclient import TestClient

# Mock TensorFlow if not present in the runtime
if "tensorflow" not in sys.modules:
    mock_tf = MagicMock()
    mock_tf.keras = MagicMock()
    mock_tf.keras.models = MagicMock()
    mock_tf.keras.layers = MagicMock()
    mock_tf.keras.optimizers = MagicMock()
    sys.modules["tensorflow"] = mock_tf
    sys.modules["tensorflow.keras"] = mock_tf.keras

from federated.federated_client import FederatedClient
from federated.federated_server import FederatedServer, atomic_getdel


@pytest.fixture(autouse=True)
def mock_checkpoint_saving():
    with patch("federated.federated_server.FederatedServer._save_checkpoint"):
        yield


class FakeRedis:
    """In-memory Redis fake for reliable, hermetic testing of federated workflows."""

    def __init__(self):
        self.store = {}
        self.sets = {}

    def get(self, key):
        val = self.store.get(key)
        return val if val is None else (val if isinstance(val, bytes) else str(val).encode("utf-8"))

    def set(self, key, value):
        self.store[key] = value.encode("utf-8") if isinstance(value, str) else value
        return True

    def setex(self, key, time, value):
        self.store[key] = value.encode("utf-8") if isinstance(value, str) else value
        return True

    def delete(self, *keys):
        count = 0
        for k in keys:
            if k in self.store:
                del self.store[k]
                count += 1
        return count

    def getdel(self, key):
        val = self.get(key)
        if val is not None:
            self.delete(key)
        return val

    def sadd(self, key, *members):
        if key not in self.sets:
            self.sets[key] = set()
        count = 0
        for m in members:
            b_m = m if isinstance(m, bytes) else str(m).encode("utf-8")
            if b_m not in self.sets[key]:
                self.sets[key].add(b_m)
                count += 1
        return count

    def smembers(self, key):
        return self.sets.get(key, set())

    def publish(self, channel, message):
        return 1

    def pubsub(self):
        ps = MagicMock()
        ps.run_in_thread.return_value = MagicMock()
        return ps

    def pipeline(self):
        fake = self

        class Pipe:
            def __init__(self):
                self.ops = []

            def get(self, key):
                self.ops.append(("get", key))
                return self

            def delete(self, key):
                self.ops.append(("del", key))
                return self

            def execute(self):
                res = []
                for op, k in self.ops:
                    if op == "get":
                        res.append(fake.get(k))
                    elif op == "del":
                        res.append(fake.delete(k))
                return res

        return Pipe()


class TestFederatedOrchestration:
    def test_config_validation_raises_when_invalid(self):
        """clients_per_round must be >= min_clients."""
        with patch("redis.Redis.from_url", return_value=FakeRedis()):
            with pytest.raises(ValueError, match="must be >= min_clients"):
                FederatedServer(min_clients=5, clients_per_round=3)

    def test_config_validation_succeeds_when_valid(self):
        with patch("redis.Redis.from_url", return_value=FakeRedis()):
            server = FederatedServer(min_clients=3, clients_per_round=5)
            assert server.min_clients == 3
            assert server.clients_per_round == 5

    def test_atomic_getdel_retrieves_and_removes_key(self):
        fake = FakeRedis()
        fake.set("federated:update:c1", "secret_payload")
        res1 = atomic_getdel(fake, "federated:update:c1")
        assert res1 == b"secret_payload"

        # Subsequent call must return None because key was deleted
        res2 = atomic_getdel(fake, "federated:update:c1")
        assert res2 is None

    def test_round_start_persists_state_and_selects_clients(self):
        fake = FakeRedis()
        fake.sadd("federated:clients", "c1", "c2", "c3", "c4")

        with patch("redis.Redis.from_url", return_value=fake):
            server = FederatedServer(min_clients=3, clients_per_round=5)
            round_info = server.start_round()
            assert round_info is not None
            assert round_info["round"] == 1
            assert len(server.selected_clients) == 4

            # State persisted in Redis
            assert fake.get("federated:round") == b"1"
            persisted_selected = json.loads(fake.get("federated:selected_clients"))
            assert len(persisted_selected) == 4
            server.stop_update_consumer()

    def test_drain_pending_client_updates_ingests_and_removes_keys(self):
        fake = FakeRedis()
        fake.sadd("federated:clients", "c1", "c2", "c3")

        with patch("redis.Redis.from_url", return_value=fake):
            server = FederatedServer(min_clients=3, clients_per_round=3)
            server.start_round()

            def make_payload(client_id):
                zeros = [
                    np.zeros((10, 64)), np.zeros((64,)),
                    np.zeros((64, 32)), np.zeros((32,)),
                    np.zeros((32, 1)), np.zeros((1,)),
                ]
                payload = {
                    "round": server.round,
                    "weights": [w.tolist() for w in zeros],
                }
                return server.cipher.encrypt(json.dumps(payload).encode())

            # Simulate 2 clients writing updates to Redis keys
            fake.set("federated:update:c1", make_payload("c1"))
            fake.set("federated:update:c2", make_payload("c2"))

            # Drain fallback consumes both keys
            consumed = server.drain_pending_client_updates()
            assert consumed == 2
            assert "c1" in server.client_weights
            assert "c2" in server.client_weights
            assert fake.get("federated:update:c1") is None
            assert fake.get("federated:update:c2") is None

            # Draining again does not double-process
            consumed_again = server.drain_pending_client_updates()
            assert consumed_again == 0

            # Third client update finishes the round
            fake.set("federated:update:c3", make_payload("c3"))
            server.drain_pending_client_updates()

            assert server.round_completed is True
            assert server.client_weights == {}
            server.stop_update_consumer()

    def test_duplicate_aggregation_prevented(self):
        fake = FakeRedis()
        fake.sadd("federated:clients", "c1", "c2", "c3")

        with patch("redis.Redis.from_url", return_value=fake):
            server = FederatedServer(min_clients=3, clients_per_round=3)
            server.start_round()

            zeros = [
                np.zeros((10, 64)), np.zeros((64,)),
                np.zeros((64, 32)), np.zeros((32,)),
                np.zeros((32, 1)), np.zeros((1,)),
            ]
            server.client_weights["c1"] = zeros
            server.client_weights["c2"] = zeros
            server.client_weights["c3"] = zeros

            res1 = server._aggregate_weights()
            assert res1 is not False
            assert res1["success"] is True

            # Subsequent aggregation for same round returns False
            res2 = server._aggregate_weights()
            assert res2 is False
            server.stop_update_consumer()

    def test_client_receive_weights_synchronizes_round(self):
        fake = FakeRedis()
        with patch("redis.Redis.from_url", return_value=fake):
            server = FederatedServer()
            server.round = 4
            client = FederatedClient("client-test")

            # Server sends weight with envelope
            zeros = [
                np.zeros((10, 64)), np.zeros((64,)),
                np.zeros((64, 32)), np.zeros((32,)),
                np.zeros((32, 1)), np.zeros((1,)),
            ]
            server._send_weights_to_client("client-test", zeros)

            # Client receives weights
            assert client.receive_weights() is True
            assert client.training_round == 4
            client.stop_subscription()
            server.stop_update_consumer()


class TestFederatedRoutes:
    @pytest.fixture(autouse=True)
    def setup_route_env(self):
        from routes import federated_routes
        fake = FakeRedis()
        federated_routes.server.redis = fake
        fake.set("federated:encryption_key", federated_routes.server.encryption_key)
        federated_routes.server.round = 0
        federated_routes.server.client_weights.clear()
        federated_routes.server.accepted_updates.clear()
        federated_routes.server.completed_rounds.clear()
        federated_routes.server.round_completed = False
        federated_routes._clients.clear()
        return fake

    def test_aggregate_route_returns_400_when_no_weights(self):
        from fastapi import FastAPI
        from routes.federated_routes import router

        app = FastAPI()
        app.include_router(router)
        client = TestClient(app)

        res = client.post("/federated/server/aggregate")
        assert res.status_code == 400
        assert "No client weights available" in res.json()["detail"]

    def test_aggregate_route_drains_and_succeeds_when_updates_exist(self, setup_route_env):
        from fastapi import FastAPI
        from routes.federated_routes import router, server

        app = FastAPI()
        app.include_router(router)
        client = TestClient(app)

        fake = setup_route_env
        fake.sadd("federated:clients", "c1", "c2", "c3")
        server.start_round()

        zeros = [
            np.zeros((10, 64)), np.zeros((64,)),
            np.zeros((64, 32)), np.zeros((32,)),
            np.zeros((32, 1)), np.zeros((1,)),
        ]
        payload = {
            "round": server.round,
            "weights": [w.tolist() for w in zeros],
        }
        encrypted = server.cipher.encrypt(json.dumps(payload).encode())
        fake.set("federated:update:c1", encrypted)

        res = client.post("/federated/server/aggregate")
        assert res.status_code == 200
        data = res.json()
        assert data["success"] is True
        assert data["message"] == "Weights aggregated successfully"
        assert data["data"]["clients_aggregated"] == 1
        server.stop_update_consumer()

    def test_participate_route_is_idempotent(self, setup_route_env):
        from fastapi import FastAPI
        from routes.federated_routes import router, server

        app = FastAPI()
        app.include_router(router)
        client = TestClient(app)

        fake = setup_route_env
        fake.sadd("federated:clients", "client-driver-1", "c2", "c3")
        round_info = server.start_round()
        assert round_info is not None

        # First participation
        res1 = client.post("/federated/client/participate", json={"client_id": "client-driver-1"})
        assert res1.status_code == 200
        assert res1.json()["success"] is True

        # Second participation in the same round returns duplicate notice
        res2 = client.post("/federated/client/participate", json={"client_id": "client-driver-1"})
        assert res2.status_code == 200
        body2 = res2.json()
        assert body2["success"] is True
        assert body2.get("duplicate") is True
        assert "already participated" in body2["message"]
        server.stop_update_consumer()
