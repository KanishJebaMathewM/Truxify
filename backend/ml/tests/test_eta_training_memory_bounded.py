import sys
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

mock_tf = MagicMock()
mock_tf.keras = MagicMock()
mock_tf.keras.models = MagicMock()
mock_tf.keras.layers = MagicMock()
mock_tf.keras.optimizers = MagicMock()
mock_tf.keras.models.load_model = MagicMock()
mock_tf.keras.optimizers.Adam = MagicMock()

sys.modules["tensorflow"] = mock_tf
sys.modules["tensorflow.keras"] = mock_tf.keras
sys.modules["tensorflow.keras.models"] = mock_tf.keras.models
sys.modules["tensorflow.keras.layers"] = mock_tf.keras.layers
sys.modules["tensorflow.keras.optimizers"] = mock_tf.keras.optimizers

from services.traffic_pipeline import TrafficPipeline


class FakeQuery:
    def __init__(self, rows):
        self.rows = rows
        self.all_called = False

    def filter(self, *_args, **_kwargs):
        return self

    def order_by(self, *_args, **_kwargs):
        return self

    def count(self):
        return 120

    def yield_per(self, _batch_size):
        return iter(self.rows)

    def all(self):
        self.all_called = True
        raise AssertionError("training data must be streamed, not materialized with all()")


def make_row(route_id, index):
    return SimpleNamespace(
        route_id=route_id,
        traffic_speed=float(index + 1),
        free_flow_speed=20.0,
        congestion_level=0.2,
        hour=index % 24,
        day_of_week=index % 7,
        timestamp=datetime(2026, 9, 17),
    )


def make_pipeline(rows):
    pipeline = object.__new__(TrafficPipeline)
    query = FakeQuery(rows)
    session = MagicMock()
    session.query.return_value = query
    pipeline.Session = MagicMock(return_value=session)
    pipeline.model = MagicMock()
    pipeline.model.save = MagicMock()
    pipeline._query = query
    return pipeline


def test_training_batches_reset_at_route_boundaries_and_stay_bounded(monkeypatch):
    rows = [make_row("route-a", i) for i in range(61)]
    rows.extend(make_row("route-b", i + 61) for i in range(61))
    pipeline = make_pipeline(rows)

    monkeypatch.setattr("services._eta_training_bounded_patch.ETA_TRAINING_FETCH_BATCH_SIZE", 32)

    batches = list(
        pipeline._iter_training_batches(
            pipeline.Session.return_value,
            datetime(2026, 1, 1),
            sequence_batch_size=8,
        )
    )

    assert len(batches) == 1
    batch_x, batch_y = batches[0]
    assert batch_x.shape[0] <= 8
    assert batch_x.shape == (2, 60, 5)
    assert batch_y.shape == (2,)
    assert batch_x[0, 0, 0] == 1.0
    assert batch_x[0, -1, 0] == 60.0
    assert batch_y[0] == 61.0
    assert batch_x[1, 0, 0] == 62.0
    assert batch_x[1, -1, 0] == 121.0
    assert batch_y[1] == 122.0


def test_train_model_streams_batches_instead_of_loading_entire_table(monkeypatch):
    rows = [make_row("route-a", i) for i in range(121)]
    pipeline = make_pipeline(rows)

    monkeypatch.setattr("services._eta_training_bounded_patch.ETA_TRAINING_HISTORY_DAYS", 30)
    monkeypatch.setattr("services._eta_training_bounded_patch.ETA_TRAINING_SEQUENCE_BATCH_SIZE", 8)

    pipeline.train_model(epochs=1, batch_size=8)

    assert pipeline.model.fit.call_count > 0
    assert all(call.args[0].shape[0] <= 8 for call in pipeline.model.fit.call_args_list)
    assert all(call.args[0].shape[1:] == (60, 5) for call in pipeline.model.fit.call_args_list)
    assert pipeline._query.all_called is False
    pipeline.model.save.assert_called_once_with("models/eta_lstm.h5")
