"""Actual Requests/loopback HTTP tests of bilateral matrix and native ownership."""

import importlib.util
import json
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pytest

SPEC = importlib.util.spec_from_file_location(
    "bilateral_under_test",
    os.environ.get(
        "BILATERAL_SOURCE",
        str(Path(__file__).parents[1] / "app/models/bilateral_matcher.py"),
    ),
)
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)


def drivers(n):
    return [{"current_lat": 12.0, "current_lng": 70 + i / 1000} for i in range(n)]


def loads(n):
    return [{"origin_lat": 12.01, "origin_lng": 80 + i / 1000} for i in range(n)]


@pytest.fixture(autouse=True)
def ownership(monkeypatch):
    pool = ThreadPoolExecutor(max_workers=4)
    monkeypatch.setattr(m, "_route_executor", pool, raising=False)
    monkeypatch.setattr(m, "_route_slots", threading.BoundedSemaphore(4), raising=False)
    monkeypatch.setenv("TRUXIFY_ML_USE_OSRM", "true")
    # Even baseline/submit-failure tests can never reach a production provider.
    monkeypatch.setenv("OSRM_BASE_URL", "http://127.0.0.1:1")
    monkeypatch.setattr(m, "_OSRM_MATRIX_DEADLINE_SECONDS", 1.0, raising=False)
    monkeypatch.setattr(
        m,
        "_ROUTE_UNAVAILABLE",
        getattr(m, "_ROUTE_UNAVAILABLE", object()),
        raising=False,
    )
    yield
    pool.shutdown(wait=True)


@pytest.fixture
def provider(monkeypatch):
    servers = []

    def create(responder):
        seen = []

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                u = urlsplit(self.path)
                coordinates = [
                    tuple(map(float, p.split(",")))
                    for p in u.path.rsplit("/", 1)[-1].split(";")
                ]
                q = parse_qs(u.query)
                sources = [coordinates[int(i)] for i in q["sources"][0].split(";")]
                destinations = [
                    coordinates[int(i)] for i in q["destinations"][0].split(";")
                ]
                seen.append((coordinates, sources, destinations))
                try:
                    responder(self, sources, destinations)
                except (BrokenPipeError, ConnectionResetError):
                    pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        server.daemon_threads = True
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        servers.append((server, thread))
        monkeypatch.setenv("OSRM_BASE_URL", f"http://127.0.0.1:{server.server_port}")
        return seen

    yield create
    for server, thread in servers:
        server.shutdown()
        server.server_close()
        thread.join(2)


def respond(handler, payload, status=200):
    data = json.dumps(payload).encode()
    handler.send_response(status)
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


def numbered(handler, sources, destinations):
    if len(sources) + len(destinations) > 100:
        return respond(handler, {"code": "TooBig"}, 400)
    respond(
        handler,
        {
            "code": "Ok",
            "durations": [
                [
                    round((s[0] - 70) * 1000) * 1000 + round((d[0] - 80) * 1000)
                    for d in destinations
                ]
                for s in sources
            ],
        },
    )


@pytest.mark.parametrize(
    "rows,cols", [(60, 60), (1, 201), (201, 1), (7, 203), (203, 7), (50, 50)]
)
def test_native_tiles_keep_original_indices(provider, rows, cols):
    seen = provider(numbered)
    matrix = m._fetch_route_duration_matrix(drivers(rows), loads(cols))
    assert matrix is not None
    assert matrix == [[i * 1000 + j for j in range(cols)] for i in range(rows)]
    assert all(len(coords) <= 100 for coords, _, _ in seen)


@pytest.mark.parametrize(
    "bad",
    [None, -1, "10", True, float("inf"), float("nan"), 10**1000],
    ids=["null", "negative", "string", "bool", "inf", "nan", "huge-int"],
)
def test_explicit_unreachable_and_invalid_cells_do_not_become_unknown(provider, bad):
    provider(lambda h, s, d: respond(h, {"durations": [[bad]]}))
    matrix = m._fetch_route_duration_matrix(drivers(1), loads(1))
    assert matrix is not None
    assert matrix[0][0] is not m._ROUTE_UNAVAILABLE
    assert matrix[0][0] is None if bad is None else matrix[0][0] == float("inf")


def test_failed_block_retains_successful_road_data(provider):
    def mixed(h, s, d):
        if d[0][0] >= 80.05:
            respond(h, {"code": "Error"}, 503, raising=False)
        else:
            respond(h, {"durations": [[7200.0] * len(d) for _ in s]})

    provider(mixed)
    matrix = m._fetch_route_duration_matrix(drivers(60), loads(60))
    assert matrix is not None
    assert all(row[:50] == [7200.0] * 50 for row in matrix)
    assert all(v is m._ROUTE_UNAVAILABLE for row in matrix for v in row[50:])


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"durations": []},
        {"durations": [[]]},
        {"code": "NoTable", "durations": [[1]]},
    ],
)
def test_malformed_tiles_use_existing_unknown_fallback(provider, payload):
    provider(lambda h, s, d: respond(h, payload))
    assert m._fetch_route_duration_matrix(drivers(1), loads(1)) is None


def test_optional_matrix_allocation_cap_precedes_http(provider, monkeypatch):
    seen = provider(numbered)
    monkeypatch.setattr(m, "_OSRM_MAX_MATRIX_CELLS", 3, raising=False)
    assert m._fetch_route_duration_matrix(drivers(2), loads(2)) is None
    assert not seen


def test_disabled_provider_stays_off(provider, monkeypatch):
    seen = provider(numbered)
    monkeypatch.setenv("TRUXIFY_ML_USE_OSRM", "false")
    assert m._fetch_route_duration_matrix(drivers(2), loads(2)) is None
    assert not seen


def test_slow_stream_has_total_caller_deadline(provider, monkeypatch):
    def trickle(h, s, d):
        body = json.dumps({"durations": [[1]]}).encode()
        h.send_response(200)
        h.send_header("Content-Length", str(len(body)))
        h.end_headers()
        for byte in body:
            h.wfile.write(bytes([byte]))
            h.wfile.flush()
            time.sleep(0.02)

    provider(trickle)
    monkeypatch.setattr(m, "_OSRM_MATRIX_DEADLINE_SECONDS", 0.07, raising=False)
    started = time.monotonic()
    assert m._fetch_route_duration_matrix(drivers(1), loads(1)) is None
    assert time.monotonic() - started < 0.3


def test_native_slots_survive_caller_expiry_and_reject_without_queue(
    provider, monkeypatch
):
    gate = threading.Event()
    admitted = threading.Event()
    guard = threading.Lock()
    active = 0

    def blocked(h, s, d):
        nonlocal active
        with guard:
            active += 1
            if active == 4:
                admitted.set()
        body = json.dumps({"durations": [[1]]}).encode() + b" " * 8192
        h.send_response(200)
        h.send_header("Content-Length", str(len(body)))
        h.end_headers()
        offset = 0
        # Keep a real native body read alive beyond the caller deadline.
        while not gate.is_set() and offset < len(body):
            h.wfile.write(body[offset : offset + 128])
            h.wfile.flush()
            offset += 128
            time.sleep(0.02)
        h.wfile.write(body[offset:])

    seen = provider(blocked)
    monkeypatch.setattr(m, "_OSRM_MATRIX_DEADLINE_SECONDS", 0.2, raising=False)
    callers = ThreadPoolExecutor(max_workers=4)
    try:
        futures = [
            callers.submit(m._fetch_route_duration_matrix, drivers(1), loads(1))
            for _ in range(4)
        ]
        assert admitted.wait(1)
        assert all(f.result(1) is None for f in futures)
        started = time.monotonic()
        assert m._fetch_route_duration_matrix(drivers(1), loads(1)) is None
        assert time.monotonic() - started < 0.1
        assert len(seen) == 4
    finally:
        gate.set()
        callers.shutdown(wait=True)
    end = time.monotonic() + 2
    while time.monotonic() < end:
        if m._route_slots.acquire(blocking=False):
            m._route_slots.release()
            break
        time.sleep(0.01)
    else:
        pytest.fail("native settlement failed to restore admission")
    assert m._fetch_route_duration_matrix(drivers(1), loads(1)) == [[1.0]]


@pytest.mark.parametrize("declared", [True, False])
def test_response_body_budget(provider, monkeypatch, declared):
    def oversized(h, s, d):
        body = b'{"durations": [[1]]}' + b" " * 1000
        h.send_response(200)
        if declared:
            h.send_header("Content-Length", str(len(body)))
        h.end_headers()
        h.wfile.write(body)

    provider(oversized)
    monkeypatch.setattr(m, "_OSRM_MAX_BODY_BYTES", 100, raising=False)
    assert m._fetch_route_duration_matrix(drivers(1), loads(1)) is None


def test_actual_matcher_preserves_deadlines_for_good_tiles_only(provider):
    def mixed(h, s, d):
        if d[0][0] >= 80.05:
            respond(h, {"code": "Error"}, 503)
        else:
            respond(h, {"durations": [[7200.0] * len(d) for _ in s]})

    provider(mixed)
    ds = drivers(60)
    ls = loads(60)
    for driver in ds:
        driver.update(
            max_weight_kg=1000,
            max_length_m=10,
            max_width_m=10,
            max_height_m=10,
            rating=3,
        )
    for load in ls:
        load.update(
            dest_lat=12,
            dest_lng=80,
            weight_kg=1,
            length_m=1,
            width_m=1,
            height_m=1,
            deadline_hours=0.5,
        )
    # Both sets are far apart geometrically; put sources near origins so the
    # legacy fallback is feasible only for the explicitly unknown final tile.
    for driver in ds:
        driver["current_lng"] += 10
    result = m.match_bilateral(ls, ds)
    assert len(result["assignments"]) == 10
    assert {pair["load_index"] for pair in result["assignments"]} == set(range(50, 60))


@pytest.mark.parametrize("mode", ["ok", "status", "shape", "body", "json"])
def test_native_response_closed_on_every_outcome(monkeypatch, mode):
    class Response:
        def __init__(self):
            self.headers = {}
            self.closed = False

        def raise_for_status(self):
            if mode == "status":
                raise m.requests.HTTPError("failed")

        def json(self):
            if mode == "json":
                raise ValueError("broken JSON")
            return {"durations": [] if mode == "shape" else [[1]]}

        def iter_content(self, chunk_size):
            if mode == "shape":
                yield b'{"durations": []}'
            elif mode == "body":
                yield b" " * (m._OSRM_MAX_BODY_BYTES + 1)
            elif mode == "json":
                yield b"broken"
            else:
                yield b'{"durations": [[1]]}'

        def close(self):
            self.closed = True

    response = Response()
    monkeypatch.setattr(m.requests, "get", lambda *a, **k: response)
    result = m._fetch_route_duration_matrix(drivers(1), loads(1))
    assert response.closed
    assert result == [[1.0]] if mode == "ok" else result is None


def test_submit_failure_releases_exact_native_owner(monkeypatch):
    class StoppedExecutor:
        def submit(self, *args):
            raise RuntimeError("executor unavailable")

    monkeypatch.setattr(m, "_route_executor", StoppedExecutor())
    assert m._fetch_route_duration_matrix(drivers(1), loads(1)) is None
    acquired = [m._route_slots.acquire(blocking=False) for _ in range(4)]
    try:
        assert all(acquired)
        assert not m._route_slots.acquire(blocking=False)
    finally:
        for owns in acquired:
            if owns:
                m._route_slots.release()
