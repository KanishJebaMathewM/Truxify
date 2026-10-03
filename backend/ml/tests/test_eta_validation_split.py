from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

from services import traffic_pipeline as traffic_pipeline_module
from services.traffic_pipeline import TrafficPipeline


class FakeQuery:
    def __init__(self, rows):
        self.rows = rows

    def all(self):
        return list(self.rows)


class FakeSession:
    def __init__(self, rows):
        self.rows = rows

    def query(self, _model):
        return FakeQuery(self.rows)

    def close(self):
        pass


def make_row(route_id, index):
    base = 1000 if route_id == "route-a" else 2000
    return SimpleNamespace(
        route_id=route_id,
        traffic_speed=float(base + index),
        free_flow_speed=20.0,
        congestion_level=0.2,
        hour=index % 24,
        day_of_week=index % 7,
        timestamp=datetime(2026, 1, 1) + timedelta(minutes=index),
    )


def make_pipeline(rows):
    pipeline = object.__new__(TrafficPipeline)
    pipeline.Session = lambda: FakeSession(rows)
    pipeline.model = MagicMock()
    pipeline.model.fit = MagicMock()
    pipeline.model.save = MagicMock()
    return pipeline


def test_pipeline_model_loading_is_safe_without_tensorflow(monkeypatch):
    monkeypatch.setattr(traffic_pipeline_module, "HAS_TF", False)
    pipeline = object.__new__(TrafficPipeline)

    assert pipeline._load_or_create_model() is None


def test_validation_is_temporal_and_route_grouped(monkeypatch):
    rows = [make_row("route-a", i) for i in range(80)]
    rows.extend(make_row("route-b", i) for i in range(80))
    pipeline = make_pipeline(rows)

    monkeypatch.setattr(
        "services.traffic_pipeline.os.makedirs",
        MagicMock(),
    )

    pipeline.train_model(epochs=1, batch_size=8)

    call = pipeline.model.fit.call_args
    assert "validation_split" not in call.kwargs
    assert "validation_data" in call.kwargs

    X_train, y_train = call.args[0], call.args[1]
    X_val, y_val = call.kwargs["validation_data"]

    assert X_train.shape[1:] == (60, 5)
    assert X_val.shape[1:] == (60, 5)
    assert len(y_train) > 0
    assert len(y_val) > 0

    # Each route contributes validation targets from its latest observations.
    assert set(y_val) == {
        1076.0,
        1077.0,
        1078.0,
        1079.0,
        2076.0,
        2077.0,
        2078.0,
        2079.0,
    }
    assert max(y_train[y_train < 2000]) < min(y_val[y_val < 2000])
    assert max(y_train[y_train >= 2000]) < min(y_val[y_val >= 2000])
