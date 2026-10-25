"""Bounded routing tests with controlled providers and loopback HTTP only."""
import json
import threading
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

import pytest
import requests
from app.models import deadhead_eliminator as routing

DESTINATION = {"lat": 12.97, "lng": 77.62}


def loads(count):
    return [{"load_id": f"load-{index}", "origin_lat": 12.97 + index * 0.00001,
             "origin_lng": 77.62, "dest_lat": 13.1, "dest_lng": 77.8,
             "weight_kg": 1000, "length_m": 2, "width_m": 1, "height_m": 1,
             "pickup_deadline": "2026-08-10T09:00:00", "payment_inr": 10000 + index}
            for index in range(count)]


def response(payload):
    return SimpleNamespace(raise_for_status=lambda: None, json=lambda: payload,
                           close=lambda: None)


def coordinates(url):
    return url.split("/driving/")[1].split(";")


@pytest.fixture(autouse=True)
def offline_configuration(monkeypatch):
    monkeypatch.setenv("TRUXIFY_ML_USE_OSRM", "true")
    monkeypatch.setenv("OSRM_BASE_URL", "http://routing.invalid")


@pytest.mark.parametrize("count,sizes", [(1, [2]), (99, [100]), (100, [100, 2]),
                                        (250, [100, 100, 53])])
def test_batches_align_durations_and_use_valid_urls(monkeypatch, count, sizes):
    calls = []
    offset = [0]

    def get(url, params, timeout):
        points = coordinates(url)
        assert url.startswith("http://routing.invalid/table/v1/driving/")
        assert "$" not in url and "\\" not in url
        assert params == {"sources": "0", "destinations": ";".join(
            str(index) for index in range(1, len(points))), "annotations": "duration"}
        assert 0 < timeout <= 1.5
        calls.append(len(points))
        count = len(points) - 1
        values = list(range(offset[0], offset[0] + count))
        offset[0] += count
        return response({"code": "Ok", "durations": [values]})

    monkeypatch.setattr(routing.requests, "get", get)
    assert routing._fetch_pickup_route_durations(DESTINATION, loads(count)) == list(range(count))
    assert calls == sizes


@pytest.mark.parametrize("failure", ["http", "json", "shape", "code"])
def test_partial_failure_retains_success_and_unreachable_entries(monkeypatch, failure):
    calls = []
    candidates = loads(200)

    def get(url, **kwargs):
        calls.append(url)
        size = len(coordinates(url)) - 1
        if len(calls) == 2:
            if failure == "http":
                raise requests.Timeout("offline")
            if failure == "json":
                return SimpleNamespace(raise_for_status=lambda: None,
                                       json=lambda: (_ for _ in ()).throw(ValueError("bad json")),
                                       close=lambda: None)
            return response({"code": "NoTable" if failure == "code" else "Ok",
                             "durations": [[55] * (size if failure == "code" else size - 1)]})
        return response({"code": "Ok", "durations": [[None] + [120.0] * (size - 1)]})

    monkeypatch.setattr(routing.requests, "get", get)
    result = routing._fetch_pickup_route_durations(DESTINATION, candidates)
    assert len(result) == 200
    assert result[0] is None and result[1] == 120.0 and result[198] is None
    load = candidates[99]
    expected = routing._haversine(12.97, 77.62, load["origin_lat"], load["origin_lng"]) / 40 * 3600
    assert result[99] == expected
    assert len(calls) == 3


def test_request_count_budget_falls_back_only_unattempted_remainder(monkeypatch):
    calls = []
    monkeypatch.setattr(routing, "_route_now", lambda: 0, raising=False)

    def get(url, **kwargs):
        calls.append(url)
        return response({"durations": [[120] * (len(coordinates(url)) - 1)]})

    monkeypatch.setattr(routing.requests, "get", get)
    result = routing._fetch_pickup_route_durations(DESTINATION, loads(450))
    assert len(calls) == 4
    assert result[:396] == [120] * 396
    assert result[396] != 120
    assert len(result) == 450


def test_monotonic_dispatch_budget_reduces_timeout_and_stops_new_batches(monkeypatch):
    clock = [0.0]
    timeouts = []
    monkeypatch.setattr(routing, "_route_now", lambda: clock[0], raising=False)

    def get(url, timeout, **kwargs):
        timeouts.append(timeout)
        clock[0] += 1.8
        return response({"durations": [[120] * (len(coordinates(url)) - 1)]})

    monkeypatch.setattr(routing.requests, "get", get)
    result = routing._fetch_pickup_route_durations(DESTINATION, loads(300))
    assert timeouts == pytest.approx([1.5, 1.2])
    assert result[:198] == [120] * 198
    assert result[198] != 120


def test_native_admission_retained_through_response_parsing(monkeypatch):
    semaphore = threading.BoundedSemaphore(1)
    monkeypatch.setattr(routing, "_OSRM_NATIVE_ADMISSION", semaphore, raising=False)
    entered, release = threading.Event(), threading.Event()
    calls = []

    def parse():
        entered.set()
        assert release.wait(5)
        return {"durations": [[120]]}

    def get(url, **kwargs):
        calls.append(url)
        return SimpleNamespace(raise_for_status=lambda: None, json=parse, close=lambda: None)

    monkeypatch.setattr(routing.requests, "get", get)
    with ThreadPoolExecutor(1) as pool:
        owner = pool.submit(routing._fetch_pickup_route_durations, DESTINATION, loads(1))
        try:
            assert entered.wait(3)
            assert routing._fetch_pickup_route_durations(DESTINATION, loads(1)) is None
            assert len(calls) == 1
        finally:
            release.set()
        assert owner.result() == [120]
    assert routing._fetch_pickup_route_durations(DESTINATION, loads(1)) == [120]
    assert len(calls) == 2


def test_unexpected_parsing_error_releases_native_permit(monkeypatch):
    semaphore = threading.BoundedSemaphore(1)
    monkeypatch.setattr(routing, "_OSRM_NATIVE_ADMISSION", semaphore, raising=False)

    def parse():
        raise RuntimeError("unexpected")

    monkeypatch.setattr(routing.requests, "get", lambda *args, **kwargs: SimpleNamespace(
        raise_for_status=lambda: None, json=parse, close=lambda: None))
    with pytest.raises(RuntimeError, match="unexpected"):
        routing._fetch_pickup_route_durations(DESTINATION, loads(1))
    assert semaphore.acquire(blocking=False)
    semaphore.release()


@pytest.mark.parametrize("enabled,candidates", [("false", loads(1)), ("true", [])])
def test_disabled_or_empty_never_dispatches(monkeypatch, enabled, candidates):
    monkeypatch.setenv("TRUXIFY_ML_USE_OSRM", enabled)
    monkeypatch.setattr(routing.requests, "get", lambda *a, **k: pytest.fail("unexpected request"))
    assert routing._fetch_pickup_route_durations(DESTINATION, candidates) is None


def test_total_provider_outage_retains_existing_whole_list_fallback(monkeypatch):
    monkeypatch.setattr(routing.requests, "get", lambda *a, **k: (_ for _ in ()).throw(
        requests.ConnectionError("offline")))
    assert routing._fetch_pickup_route_durations(DESTINATION, loads(250)) is None


def test_actual_matcher_uses_bounded_loopback_tables_and_road_deadlines(monkeypatch):
    paths = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            parsed = urlsplit(self.path)
            points = parsed.path.split("/driving/")[1].split(";")
            paths.append((len(points), parse_qs(parsed.query)))
            if len(points) > 100:
                self.send_response(400)
                self.end_headers()
                return
            values = []
            for point in points[1:]:
                index = round((float(point.split(",")[1]) - 12.97) / 0.00001)
                values.append(7200 if index == 0 else None if index == 100 else 60)
            body = json.dumps({"code": "Ok", "durations": [values]}).encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setenv("OSRM_BASE_URL", f"http://127.0.0.1:{server.server_port}")
    try:
        result = routing.find_return_loads(DESTINATION, {
            "max_weight_kg": 10000, "max_length_m": 10,
            "max_width_m": 3, "max_height_m": 3,
        }, "2026-08-10T08:00:00", loads(101))
        ids = [item["load_id"] for item in result["recommendations"]]
        assert "load-100" not in ids and "load-0" not in ids
        assert "load-1" in ids and len(ids) == 10
        assert [size for size, _ in paths] == [100, 3]
        assert all(query["sources"] == ["0"] for _, query in paths)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(3)
