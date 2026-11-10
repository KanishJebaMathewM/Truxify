"""Independent full-path certificates for partially reachable road tables."""

import json
import math
import random
import threading
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from itertools import pairwise

import pytest
from app.models import mid_trip_reoptimiser as m
from utils import osrm_client


def full_path_oracle(route, pickup, dropoff, matrices):
    baseline = [sum(matrix[a][b] for a, b in pairwise(route)) for matrix in matrices]
    options = []
    for p in range(len(route)):
        with_pickup = route[: p + 1] + [pickup] + route[p + 1 :]
        prefix = [
            sum(matrix[a][b] for a, b in pairwise(with_pickup[: p + 2]))
            for matrix in matrices
        ]
        for q in range(p + 2, len(with_pickup) + 1):
            candidate = with_pickup[:q] + [dropoff] + with_pickup[q:]
            options.append(
                tuple(
                    max(sum(matrix[a][b] for a, b in pairwise(candidate)) - base, 0.0)
                    for matrix, base in zip(matrices, baseline)
                )
                + tuple(prefix)
            )
    return options


@pytest.mark.parametrize("waypoints", [0, 1, 2, 5, 12])
@pytest.mark.parametrize("seed", range(10))
def test_every_partial_directed_option_matches_independent_full_path(waypoints, seed):
    rng = random.Random(seed)
    size = waypoints + 3
    route = list(range(waypoints + 1))
    matrices = [
        [
            [
                rng.uniform(0.0, 100.0) if rng.random() > 0.3 else float("inf")
                for _ in range(size)
            ]
            for _ in range(size)
        ]
        for _ in range(2)
    ]
    for matrix in matrices:
        for a, b in pairwise(route):
            matrix[a][b] = rng.uniform(0.0, 100.0)
    expected = full_path_oracle(route, size - 2, size - 1, matrices)
    actual = list(
        m._iter_route_insertion_options_with_matrix(
            route, size - 2, size - 1, *matrices
        )
    )
    assert len(actual) == len(expected) == (waypoints + 1) * (waypoints + 2) // 2
    for got, wanted in zip(actual, expected):
        assert got == pytest.approx(wanted, abs=1e-8)


def test_consecutive_gap_reconstruction_avoids_inf_minus_inf():
    matrix = [[1.0] * 4 for _ in range(4)]
    matrix[2][1] = float("inf")
    # Pickup-only next edge is unavailable; the complete adjacent P,D gap fits.
    options = list(
        m._iter_route_insertion_options_with_matrix([0, 1], 2, 3, matrix, matrix)
    )
    assert options == pytest.approx(full_path_oracle([0, 1], 2, 3, (matrix, matrix)))
    assert all(math.isfinite(x) for x in options[0])
    assert math.isinf(options[1][0])


@pytest.mark.parametrize("dimension", [0, 1])
def test_unreachable_baseline_has_no_certifiable_detour(dimension):
    matrices = [[[1.0] * 4 for _ in range(4)] for _ in range(2)]
    matrices[dimension][0][1] = float("inf")
    assert (
        list(m._iter_route_insertion_options_with_matrix([0, 1], 2, 3, *matrices)) == []
    )


@pytest.mark.parametrize("waypoints", [20, 40, 80])
def test_partial_tables_prefetch_linear_edges_without_legacy_materialization(
    monkeypatch, waypoints
):
    class Row(list):
        reads = 0

        def __getitem__(self, item):
            type(self).reads += 1
            return super().__getitem__(item)

    size = waypoints + 3
    matrix = [
        Row([float("inf") if j == size - 1 else 1.0 for j in range(size)])
        for _ in range(size)
    ]

    def forbidden(*args):
        pytest.fail("partial roads must not materialize legacy cubic candidates")

    monkeypatch.setattr(m, "_legacy_route_insertion_options_with_matrix", forbidden)
    generator = m._iter_route_insertion_options_with_matrix(
        list(range(waypoints + 1)), size - 2, size - 1, matrix, matrix
    )
    assert iter(generator) is generator
    count = sum(1 for _ in generator)
    assert count == (waypoints + 1) * (waypoints + 2) // 2
    assert Row.reads <= 20 * (waypoints + 1)


@pytest.mark.parametrize("unreachable", [True, False])
def test_actual_native_osrm_consumer_never_publishes_disconnected_dropoff(
    monkeypatch, unreachable
):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            edges = [
                [0, 1, 2, None],
                [None, 0, 1, None],
                [None, None, 0, None],
                [None, None, None, 0],
            ]
            if not unreachable:
                edges[0][3], edges[1][3], edges[2][3] = 3, 2, 1
            payload = {
                "code": "Ok",
                "distances": [
                    [None if x is None else x * 1000 for x in row] for row in edges
                ],
                "durations": [
                    [None if x is None else x * 60 for x in row] for row in edges
                ],
            }
            body = json.dumps(payload).encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setattr(
        osrm_client, "OSRM_BASE_URL", f"http://127.0.0.1:{server.server_port}"
    )
    try:
        result = m.find_mid_trip_loads(
            {"lat": 0.0, "lng": 0.0},
            [{"lat": 0.0, "lng": 1.0}],
            {"weight_kg": 10.0, "length_m": 10.0, "width_m": 10.0, "height_m": 10.0},
            [
                {
                    "load_id": "candidate",
                    "pickup_lat": 0.0,
                    "pickup_lng": 2.0,
                    "dropoff_lat": 0.0,
                    "dropoff_lng": 3.0,
                    "weight_kg": 1.0,
                    "length_m": 1.0,
                    "width_m": 1.0,
                    "height_m": 1.0,
                    "payment_inr": 100.0,
                    "pickup_deadline": (
                        datetime.now(timezone.utc) + timedelta(days=1)
                    ).isoformat(),
                }
            ],
        )
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
    json.dumps(result, allow_nan=False)
    if unreachable:
        assert result == {"recommendations": []}
    else:
        assert len(result["recommendations"]) == 1
        assert result["recommendations"][0]["detour_km"] == 2.0
        assert result["recommendations"][0]["detour_minutes"] == 2.0
