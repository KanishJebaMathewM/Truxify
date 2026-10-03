from collections import OrderedDict

import numpy as np

from backend.ml.services.traffic_pipeline import TrafficPipeline


def make_pipeline(max_route_windows=1000):
    pipeline = object.__new__(TrafficPipeline)
    pipeline._max_route_windows = max_route_windows
    pipeline._route_windows = OrderedDict()
    pipeline._last_route_history_metrics = {
        'route_id': None,
        'route_signature': None,
        'route_key': None,
    }
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


def test_same_route_version_keeps_rolling_history():
    pipeline = make_pipeline()
    signature = pipeline.build_route_signature({'lat': 13.0, 'lng': 78.0})

    pipeline.predict_eta(np.ones(5), "order-123", signature)
    pipeline.predict_eta(np.full(5, 2.0), "order-123", signature)

    key = f"order-123:{signature}"
    assert len(pipeline._route_windows[key]) == 2
    np.testing.assert_array_equal(
        pipeline._route_windows[key][0],
        np.ones(5),
    )
    assert pipeline.get_route_history_metrics() == {
        'route_id': 'order-123',
        'route_signature': signature,
        'route_key': key,
    }


def test_destination_change_starts_a_fresh_history_for_same_order():
    pipeline = make_pipeline()
    old_signature = pipeline.build_route_signature({'lat': 13.0, 'lng': 78.0})
    new_signature = pipeline.build_route_signature({'lat': 14.0, 'lng': 79.0})

    pipeline.predict_eta(np.ones(5), "order-123", old_signature)
    pipeline.predict_eta(np.full(5, 2.0), "order-123", old_signature)
    pipeline.predict_eta(np.full(5, 3.0), "order-123", new_signature)

    old_key = f"order-123:{old_signature}"
    new_key = f"order-123:{new_signature}"

    assert list(pipeline._route_windows) == [old_key, new_key]
    assert len(pipeline._route_windows[old_key]) == 2
    assert len(pipeline._route_windows[new_key]) == 1
    np.testing.assert_array_equal(
        pipeline._route_windows[new_key][0],
        np.full(5, 3.0),
    )
