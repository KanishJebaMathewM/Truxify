"""Actual requests/HTTP boundary controls; no mocked transport or routing math."""

import json
import math
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import ClassVar
from urllib.parse import parse_qs, urlsplit

import pytest
from utils import osrm_client as client


@pytest.fixture(scope="module")
def server():
    class Handler(BaseHTTPRequestHandler):
        payload: ClassVar = {}
        requests_seen: ClassVar = []

        def do_GET(self):
            self.requests_seen.append(self.path)
            self.send_response(200)
            self.end_headers()
            self.wfile.write(json.dumps(self.payload).encode())

        def log_message(self, *args):
            pass

    http = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=http.serve_forever, daemon=True)
    thread.start()
    yield Handler, f"http://127.0.0.1:{http.server_port}"
    http.shutdown()
    http.server_close()
    thread.join()


@pytest.fixture
def endpoint(server, monkeypatch):
    handler, address = server
    handler.requests_seen.clear()
    handler.payload = {}
    monkeypatch.setattr(client, "OSRM_BASE_URL", address)
    return handler


def table():
    return {
        "code": "Ok",
        "distances": [[0, 1234], [4321, 0]],
        "durations": [[0, 60], [120, 0]],
    }


def fallback_reference(points):
    # Independent central-angle reference using atan2 of Cartesian cross/dot.
    vectors = [
        (
            math.cos(math.radians(a)) * math.cos(math.radians(b)),
            math.cos(math.radians(a)) * math.sin(math.radians(b)),
            math.sin(math.radians(a)),
        )
        for a, b in points
    ]
    result = []
    for x in vectors:
        row = []
        for y in vectors:
            cross = (
                x[1] * y[2] - x[2] * y[1],
                x[2] * y[0] - x[0] * y[2],
                x[0] * y[1] - x[1] * y[0],
            )
            row.append(
                6371
                * math.atan2(
                    math.sqrt(sum(v * v for v in cross)),
                    sum(a * b for a, b in zip(x, y)),
                )
            )
        result.append(row)
    return result


def assert_fallback(points):
    distances, durations = client.get_route_matrix_with_duration(points)
    reference = fallback_reference(points)
    for actual, expected, minutes in zip(distances, reference, durations):
        assert actual == pytest.approx(expected, abs=1e-7)
        assert minutes == pytest.approx([v * 1.5 for v in expected], abs=1e-7)
    return distances, durations


def test_directed_conversion_and_query(endpoint):
    endpoint.payload = table()
    points = [(12.5, 80.1), (-8, 140)]
    assert client.get_route_matrix_with_duration(points) == (
        [[0, 1.234], [4.321, 0]],
        [[0, 1], [2, 0]],
    )
    query = urlsplit(endpoint.requests_seen[-1])
    assert query.path.endswith("/80.1,12.5;140.0,-8.0")
    assert parse_qs(query.query) == {"annotations": ["distance,duration"]}
    assert client.get_route_matrix(points) == [[0, 1.234], [4.321, 0]]


@pytest.mark.parametrize(
    "payload",
    [
        [],
        None,
        1,
        "bad",
        {},
        {"code": "NoTable"},
        {"code": "Ok", "distances": [[0]], "durations": [[0]]},
        {"code": "Ok", "distances": [[0, 1], [1]], "durations": [[0, 1], [1, 0]]},
    ],
)
def test_complete_response_fallback(endpoint, payload):
    endpoint.payload = payload
    assert_fallback([(0, 0), (1, 1)])


@pytest.mark.parametrize(
    "bad", [-1, float("nan"), float("inf"), True, "1000", {}, 10**400]
)
@pytest.mark.parametrize("dimension", ["distances", "durations"])
def test_any_invalid_cell_rejects_both_tables(endpoint, bad, dimension):
    endpoint.payload = table()
    endpoint.payload[dimension][1][0] = bad
    distances, _ = assert_fallback([(0, 0), (1, 1)])
    assert distances[0][1] != 1.234  # Never mix valid road cells with fallback.


def test_nulls_are_preserved_without_inventing_roads(endpoint):
    endpoint.payload = table()
    endpoint.payload["distances"][0][1] = None
    endpoint.payload["durations"][0][1] = None
    distances, durations = client.get_route_matrix_with_duration([(0, 0), (1, 1)])
    assert distances == [[0, math.inf], [4.321, 0]]
    assert durations == [[0, math.inf], [2, 0]]


@pytest.mark.parametrize(
    "point",
    [
        (91, 0),
        (0, -181),
        (float("nan"), 0),
        (0, float("inf")),
        (True, 0),
        ("1", 0),
        [1],
        None,
        (10**400, 0),
    ],
)
def test_complete_input_admission_before_http(endpoint, point):
    endpoint.payload = table()
    with pytest.raises((ValueError, TypeError)):
        client.get_route_matrix_with_duration([(0, 0), point])
    with pytest.raises((ValueError, TypeError)):
        client.get_route_distance((0, 0), point)
    assert not endpoint.requests_seen


def test_size_boundary_empty_and_singleton(endpoint):
    assert client.get_route_matrix_with_duration([]) == ([], [])
    with pytest.raises((ValueError, TypeError)):
        client.get_route_matrix_with_duration([(0, 0)] * 101)
    assert not endpoint.requests_seen
    endpoint.payload = {"code": "Ok", "distances": [[0]], "durations": [[0]]}
    assert client.get_route_matrix_with_duration([(0, 0)]) == ([[0]], [[0]])
    endpoint.payload = []
    distances, durations = client.get_route_matrix_with_duration([(0, 0)] * 100)
    assert len(distances) == len(durations) == 100
    assert all(len(row) == 100 for row in distances)


@pytest.mark.parametrize(
    "payload",
    [
        [],
        {"code": "NoRoute"},
        {"code": "Ok", "routes": {}},
        {"code": "Ok", "routes": [None]},
        {"code": "Ok", "routes": [{"distance": -1, "duration": 60}]},
        {"code": "Ok", "routes": [{"distance": 1000, "duration": float("nan")}]},
        {"code": "Ok", "routes": [{"distance": True, "duration": 60}]},
    ],
)
def test_route_numeric_protocol(endpoint, payload):
    endpoint.payload = payload
    distance = fallback_reference([(0, 0), (1, 1)])[0][1]
    assert client.get_route_distance((0, 0), (1, 1)) == pytest.approx(
        (distance, distance * 1.5)
    )


def test_route_valid_zero_and_units(endpoint):
    endpoint.payload = {"code": "Ok", "routes": [{"distance": 1234, "duration": 60}]}
    assert client.get_route_distance((0, 0), (1, 1)) == (1.234, 1)
    endpoint.payload["routes"][0] = {"distance": 0, "duration": 0}
    assert client.get_route_distance((0, 0), (0, 0)) == (0, 0)


@pytest.mark.parametrize(
    "points", [[(0, 0), (0, 180)], [(89, 12), (-89, -168)], [(90, 180), (-90, -180)]]
)
def test_antipodal_fallback(endpoint, points):
    endpoint.payload = []
    assert_fallback(points)
