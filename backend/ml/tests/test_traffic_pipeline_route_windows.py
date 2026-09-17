from collections import OrderedDict

import numpy as np

from backend.ml.services.traffic_pipeline import TrafficPipeline


def make_pipeline(max_route_windows=1000):
    pipeline = object.__new__(TrafficPipeline)
    pipeline._max_route_windows = max_route_windows
    pipeline._route_windows = OrderedDict()
    pipeline.model = type(
        "ModelStub",
        (),
        {"predict": lambda self, model_input, verbose=0: np.array([[1.0]])},
    )()
    return pipeline


def test_route_windows_are_bounded_and_evict_least_recently_used():
    pipeline = make_pipeline(max_route_windows=2)
    row = np.zeros(5)

    pipeline.predict_eta(row, "route-a")
    pipeline.predict_eta(row, "route-b")
    pipeline.predict_eta(row, "route-a")
    pipeline.predict_eta(row, "route-c")

    assert list(pipeline._route_windows) == ["route-a", "route-c"]
    assert len(pipeline._route_windows) == 2


def test_repeated_predictions_keep_history_for_the_same_route():
    pipeline = make_pipeline(max_route_windows=2)
    row_a = np.ones(5)
    row_b = np.full(5, 2.0)

    pipeline.predict_eta(row_a, "route-a")
    pipeline.predict_eta(row_b, "route-a")

    assert len(pipeline._route_windows) == 1
    assert len(pipeline._route_windows["route-a"]) == 2
    np.testing.assert_array_equal(pipeline._route_windows["route-a"][0], row_a)
    np.testing.assert_array_equal(pipeline._route_windows["route-a"][1], row_b)


def test_default_route_id_does_not_create_multiple_empty_keys():
    pipeline = make_pipeline(max_route_windows=2)
    row = np.zeros(5)

    pipeline.predict_eta(row)
    pipeline.predict_eta(row)

    assert list(pipeline._route_windows) == [""]
    assert len(pipeline._route_windows[""]) == 2
