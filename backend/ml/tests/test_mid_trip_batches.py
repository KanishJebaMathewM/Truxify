"""Native bounded candidate tables and stable global ranking controls."""

import copy
import json
import threading
import weakref
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

import pytest
from app.models import mid_trip_reoptimiser as m
from utils import osrm_client


def problem(count, stops=1):
    return (
        {"lat": 0.0, "lng": 0.0},
        [{"lat": 0.0, "lng": 0.0} for _ in range(stops)],
        {"weight_kg": 10.0, "length_m": 10.0, "width_m": 10.0, "height_m": 10.0},
        [
            {
                "load_id": f"load-{i}",
                "pickup_lat": 0.0,
                "pickup_lng": 0.0,
                "dropoff_lat": 0.0,
                "dropoff_lng": 0.0,
                "weight_kg": 1.0,
                "length_m": 1.0,
                "width_m": 1.0,
                "height_m": 1.0,
                "payment_inr": (i + 1) / 10,
                "pickup_deadline": (
                    datetime.now(timezone.utc) + timedelta(days=1)
                ).isoformat(),
            }
            for i in range(count)
        ],
    )


@pytest.fixture
def native_provider(monkeypatch):
    class Observations(list):
        fail_at = None

    sizes = Observations()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            count = len(urlsplit(self.path).path.rsplit("/", 1)[-1].split(";"))
            sizes.append(count)
            body = json.dumps(
                {
                    "code": "Ok",
                    "distances": [[0.0] * count for _ in range(count)],
                    "durations": [[0.0] * count for _ in range(count)],
                }
            ).encode()
            self.send_response(
                503 if len(sizes) == sizes.fail_at else 200 if count <= 100 else 400
            )
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setattr(
        osrm_client, "OSRM_BASE_URL", f"http://127.0.0.1:{server.server_port}"
    )
    yield sizes
    server.shutdown()
    server.server_close()
    thread.join()


@pytest.mark.parametrize(
    "count,expected", [(49, [100]), (50, [100, 4]), (120, [100, 100, 46])]
)
def test_actual_native_tables_preserve_all_candidates_and_global_top_five(
    native_provider, count, expected
):
    args = problem(count)
    before = copy.deepcopy(args)
    result = m.find_mid_trip_loads(*args)
    assert native_provider == expected
    assert [r["load_id"] for r in result["recommendations"]] == [
        f"load-{i}" for i in range(count - 1, count - 6, -1)
    ]
    # Co-located oracle: zero detour/proximity=30/time=30; earnings = payment/50*40.
    for row, index in zip(result["recommendations"], range(count - 1, count - 6, -1)):
        assert row["detour_km"] == row["detour_minutes"] == 0.0
        assert row["priority_score"] == round(60.0 + ((index + 1) / 10) / 50 * 40, 2)
    assert args == before
    json.dumps(result, allow_nan=False)


def test_maximal_baseline_keeps_complete_stops_and_one_pair(native_provider):
    result = m.find_mid_trip_loads(*problem(2, 97))
    assert native_provider == [100, 100]
    assert [r["load_id"] for r in result["recommendations"]] == ["load-1", "load-0"]


def test_oversized_baseline_rejected_before_provider(monkeypatch):
    monkeypatch.setattr(
        m,
        "get_route_matrix_with_duration",
        lambda _: pytest.fail("oversized baseline dispatched"),
    )
    with pytest.raises(ValueError, match="cannot fit one candidate"):
        m.find_mid_trip_loads(*problem(1, 98))


def test_ties_keep_earliest_global_identity_across_batches(native_provider):
    args = problem(120)
    for load in args[-1]:
        load["payment_inr"] = 10.0
    result = m.find_mid_trip_loads(*args)
    assert [r["load_id"] for r in result["recommendations"]] == [
        f"load-{i}" for i in range(5)
    ]
    assert native_provider == [100, 100, 46]


def test_single_evaluation_clock_and_stable_identity_after_caller_changes(monkeypatch):
    args = problem(4)
    args[-1][0]["weight_kg"] = 20.0  # filtered candidate must not shift IDs
    fixed = datetime.now(timezone.utc)
    clocks = 0

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            nonlocal clocks
            clocks += 1
            return fixed

    calls = 0

    def table(locations):
        nonlocal calls
        calls += 1
        for load in args[-1]:
            load["load_id"] = "changed"
            load["payment_inr"] = 1e6
        size = len(locations)
        return [[0.0] * size for _ in locations], [[0.0] * size for _ in locations]

    monkeypatch.setattr(m, "MAX_TABLE_LOCATIONS", 4)
    monkeypatch.setattr(m, "get_route_matrix_with_duration", table)
    monkeypatch.setattr(m, "datetime", Clock)
    result = m.find_mid_trip_loads(*args)
    assert calls == 3 and clocks == 1
    assert [r["load_id"] for r in result["recommendations"]] == [
        "load-3",
        "load-2",
        "load-1",
    ]


def test_directed_matrix_local_indices_follow_candidate_pair_identity(monkeypatch):
    args = problem(7)
    for i, load in enumerate(args[-1]):
        load["pickup_lng"], load["dropoff_lng"] = float(i + 1), float(i + 11)
    matrices = []

    def table(locations):
        # Distinct directed costs make wrong local pickup/dropoff offsets observable.
        result = [[(a[1] + 1) * 100 + b[1] for b in locations] for a in locations]
        matrices.append((locations, result))
        return result, [[0.0] * len(locations) for _ in locations]

    monkeypatch.setattr(m, "MAX_TABLE_LOCATIONS", 8)
    monkeypatch.setattr(m, "get_route_matrix_with_duration", table)
    batches = list(m._iter_candidate_road_batches((0.0, 0.0), [(0.0, 0.0)], args[-1]))
    assert [len(b[0]) for b in batches] == [3, 3, 1]
    seen = []
    for batch, pickups, dropoffs, (distance, _) in batches:
        for i, load in enumerate(batch):
            seen.append(load["load_id"])
            assert (
                distance[2 + i][2 + len(batch) + i]
                == (pickups[i][1] + 1) * 100 + dropoffs[i][1]
            )
    assert seen == [f"load-{i}" for i in range(7)]


def test_actual_failed_batch_retains_existing_geometric_fallback(native_provider):
    native_provider.fail_at = 2
    result = m.find_mid_trip_loads(*problem(120))
    assert native_provider == [100, 100, 46]
    assert [row["load_id"] for row in result["recommendations"]] == [
        f"load-{i}" for i in range(119, 114, -1)
    ]
    json.dumps(result, allow_nan=False)


@pytest.mark.parametrize("bad_first", [False, True])
def test_finished_batch_matrices_retire_before_next_native_table(
    monkeypatch, bad_first
):
    class Matrix(list):
        pass

    observed = []
    calls = 0

    def table(locations):
        nonlocal calls
        calls += 1
        assert not any(reference() is not None for reference in observed)
        size = len(locations)
        matrices = [Matrix([[0.0] * size for _ in locations]) for _ in range(2)]
        if bad_first and calls == 1:
            matrices[1] = Matrix([[1e308] * size for _ in locations])
        observed.extend(weakref.ref(matrix) for matrix in matrices)
        return tuple(matrices)

    monkeypatch.setattr(m, "MAX_TABLE_LOCATIONS", 4)
    monkeypatch.setattr(m, "get_route_matrix_with_duration", table)
    result = m.find_mid_trip_loads(*problem(4))
    assert calls == 4 and len(result["recommendations"]) == (3 if bad_first else 4)
    assert not any(reference() is not None for reference in observed)
