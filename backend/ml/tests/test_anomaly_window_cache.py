"""Native temporal-window state bounds and commit-time LRU ownership."""

import threading
from collections import OrderedDict, deque

import numpy as np
import pytest
import redis
from anomaly import detector as module
from anomaly.models import LSTMAutoencoder
from sklearn.preprocessing import StandardScaler
from tensorflow import keras


@pytest.fixture(autouse=True)
def native_seed():
    keras.utils.set_random_seed(61)
    yield
    keras.backend.clear_session()


def learned():
    raw = np.linspace(-2, 3, 12).reshape(2, 3, 2)
    model = LSTMAutoencoder(2, 3, 2)
    model.build_model()
    scaler = StandardScaler().fit(raw.reshape(-1, 2))
    scaled = scaler.transform(raw.reshape(-1, 2)).reshape(2, 3, 2).astype("float32")
    model.model.train_on_batch(scaled, scaled)
    reconstruction = model.model(scaled, training=False).numpy()
    errors = np.mean(np.square(reconstruction - scaled), axis=(1, 2))
    model.threshold = float(np.percentile(errors, 95))
    return model, scaler, raw


@pytest.fixture
def service():
    engine = module.AnomalyDetector.__new__(module.AnomalyDetector)
    model, scaler, _ = learned()
    engine.models = {"driver_behavior": model}
    engine.scalers = {"driver_behavior": scaler}
    engine._generations = {"driver_behavior": 4}
    engine._generation_lock = threading.RLock()
    engine._training_lock = threading.RLock()
    engine._delivery_lock = threading.RLock()
    engine._observation_sequence = 0
    engine._pending_delivery = deque()
    engine._max_feature_buffers = 3
    engine._feature_buffers = OrderedDict()
    engine.anomaly_history = deque(maxlen=1000)
    engine.alert_thresholds = {"low": 1.5, "medium": 2.0, "high": 3.0}
    engine.redis = redis.Redis(host="127.0.0.1", port=1, socket_connect_timeout=0.1)
    yield engine
    engine.redis.close()


def observe(service, entity):
    # Real learned inference of the genuine population mean; no neural mock.
    result = service.detect_anomaly(
        "driver_behavior", service.scalers["driver_behavior"].mean_, entity
    )
    assert "error" not in result and not result["is_anomaly"]
    return result


@pytest.mark.parametrize("invalid", [0, -1, True, 1.5, None, "3"])
def test_capacity_rejected_before_native_model_allocation(monkeypatch, invalid):
    def unexpected(*args, **kwargs):
        pytest.fail("invalid cache capacity reached native allocation")

    monkeypatch.setattr(module, "LSTMAutoencoder", unexpected)
    with pytest.raises(ValueError, match="positive integer"):
        module.AnomalyDetector(max_feature_buffers=invalid)


def test_ten_thousand_native_producer_keys_remain_bounded_constant_work(service):
    class Cache(OrderedDict):
        operations = 0

        def __contains__(self, key):
            self.operations += 1
            return super().__contains__(key)

        def __setitem__(self, key, value):
            self.operations += 1
            return super().__setitem__(key, value)

        def popitem(self, last=True):
            self.operations += 1
            return super().popitem(last)

        def __iter__(self):
            pytest.fail("producer must not scan cache keys")

    service._feature_buffers = Cache()
    for i in range(10000):
        window = service._get_feature_buffer("driver_behavior", str(i))
        window.append(np.array([i, i + 1], dtype="float32"))
        assert len(service._feature_buffers) <= 3
    assert list(service._feature_buffers.keys()) == [
        ("driver_behavior", str(i)) for i in range(9997, 10000)
    ]
    assert service._feature_buffers.operations <= 3 * 10000
    assert (
        sum(
            row.nbytes for window in service._feature_buffers.values() for row in window
        )
        == 24
    )


def test_actual_learned_observations_eviction_and_cold_metadata(service):
    service._max_feature_buffers = 2
    assert observe(service, "a")["window_observations"] == 1
    assert observe(service, "b")["window_observations"] == 1
    assert observe(service, "a")["window_observations"] == 2
    assert observe(service, "c")["window_observations"] == 1
    assert list(service._feature_buffers) == [
        ("driver_behavior", "a"),
        ("driver_behavior", "c"),
    ]
    warm = observe(service, "a")
    assert warm["window_observations"] == warm["window_length"] == 3
    cold = observe(service, "b")
    assert cold["window_observations"] == 1 and cold["window_length"] == 3
    assert list(service._feature_buffers) == [
        ("driver_behavior", "a"),
        ("driver_behavior", "b"),
    ]


def test_rejections_and_post_native_preparation_failure_preserve_lru(
    service, monkeypatch
):
    observe(service, "a")
    observe(service, "b")
    before = list(service._feature_buffers)
    rows = {
        key: [row.copy() for row in window]
        for key, window in service._feature_buffers.items()
    }
    for entity, value in [("c", [float("nan"), 0.0]), ("a", [[0.0, 0.0], [1.0, 1.0]])]:
        assert "error" in service.detect_anomaly(
            "driver_behavior", np.array(value), entity
        )
        assert list(service._feature_buffers) == before

    original_json = module.json.dumps

    def failed_payload(value, *args, **kwargs):
        if isinstance(value, dict) and "data_type" in value:
            raise ValueError("prepared native report rejected")
        return original_json(value, *args, **kwargs)

    monkeypatch.setattr(module.json, "dumps", failed_payload)
    assert "error" in service.detect_anomaly(
        "driver_behavior", service.scalers["driver_behavior"].mean_, "c"
    )
    assert list(service._feature_buffers) == before
    for key, window in service._feature_buffers.items():
        np.testing.assert_array_equal(list(window), rows[key])


def test_real_row_order_and_distinct_namespace_windows(service):
    second, _, _ = learned()
    service.models["transactions"] = second
    first = service._get_feature_buffer("driver_behavior", "same")
    other = service._get_feature_buffer("transactions", "same")
    for i in range(5):
        first.append(np.array([i, i + 1], dtype="float32"))
    other.append(np.array([99.0, 100.0], dtype="float32"))
    np.testing.assert_array_equal(list(first), [[2, 3], [3, 4], [4, 5]])
    np.testing.assert_array_equal(list(other), [[99, 100]])
    assert first is not other and first.maxlen == other.maxlen == 3


def test_selective_native_retraining_retains_unaffected_lru_order(
    service, monkeypatch, tmp_path
):
    monkeypatch.chdir(tmp_path)
    other, scaler, raw = learned()
    service.models["transactions"] = other
    service.scalers["transactions"] = scaler
    service._generations["transactions"] = 7
    service._max_feature_buffers = 4
    for kind, entity in [
        ("driver_behavior", "a"),
        ("transactions", "x"),
        ("driver_behavior", "b"),
        ("transactions", "y"),
    ]:
        service._get_feature_buffer(kind, entity).append(
            np.array([0.0, 0.0], dtype="float32")
        )
    service._get_feature_buffer("transactions", "x")
    retained = service._feature_buffers[("transactions", "x")]
    report = service.train_models({"driver_behavior": raw}, epochs=1)
    assert report["driver_behavior"]["generation"] == 5
    assert isinstance(service._feature_buffers, OrderedDict)
    assert list(service._feature_buffers) == [
        ("transactions", "y"),
        ("transactions", "x"),
    ]
    assert service._feature_buffers[("transactions", "x")] is retained
    assert observe(service, "a")["window_observations"] == 1
