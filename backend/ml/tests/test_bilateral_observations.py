"""Independent native HTTP controls for the admitted matching problem."""

import copy
import importlib.util
import json
import threading
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pytest

SPEC = importlib.util.spec_from_file_location(
    "bilateral_observations",
    Path(__file__).parents[1] / "app/models/bilateral_matcher.py",
)
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)


def load():
    return {
        "origin_lat": 0.0,
        "origin_lng": 0.0,
        "dest_lat": 0.0,
        "dest_lng": 0.0,
        "weight_kg": 2.0,
        "length_m": 1.0,
        "width_m": 1.0,
        "height_m": 1.0,
        "deadline_hours": 1.0,
    }


def driver():
    return {
        "current_lat": 0.0,
        "current_lng": 0.0,
        "max_weight_kg": 3.0,
        "max_length_m": 2.0,
        "max_width_m": 2.0,
        "max_height_m": 2.0,
        "rating": 3.0,
        "preferred_dest_lat": 0.0,
        "preferred_dest_lng": 0.0,
    }


@pytest.fixture(autouse=True)
def private_provider(monkeypatch):
    pool = ThreadPoolExecutor(max_workers=4)
    monkeypatch.setattr(m, "_route_executor", pool)
    monkeypatch.setattr(m, "_route_slots", threading.BoundedSemaphore(4))
    monkeypatch.setenv("TRUXIFY_ML_USE_OSRM", "false")
    monkeypatch.setenv("OSRM_BASE_URL", "http://127.0.0.1:1")
    monkeypatch.setattr(m, "_OSRM_MATRIX_DEADLINE_SECONDS", 5.0)
    yield
    pool.shutdown(wait=True)


@pytest.fixture
def http_provider(monkeypatch):
    servers = []

    def start(mutate):
        seen = []

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                url = urlsplit(self.path)
                query = parse_qs(url.query)
                coordinates = url.path.rsplit("/", 1)[-1].split(";")
                seen.append(coordinates)
                mutate(len(seen))
                rows = len(query["sources"][0].split(";"))
                cols = len(query["destinations"][0].split(";"))
                payload = json.dumps(
                    {"code": "Ok", "durations": [[0.0] * cols for _ in range(rows)]}
                ).encode()
                self.send_response(200)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        servers.append((server, thread))
        monkeypatch.setenv("TRUXIFY_ML_USE_OSRM", "true")
        monkeypatch.setenv("OSRM_BASE_URL", f"http://127.0.0.1:{server.server_port}")
        return seen

    yield start
    for server, thread in servers:
        server.shutdown()
        server.server_close()
        thread.join(2)


@pytest.mark.parametrize(
    "side,field",
    [
        *(("load", key) for key in load()),
        *(("driver", key) for key in driver()),
    ],
)
def test_native_http_mutations_cannot_change_scoring(http_provider, side, field):
    l, d = load(), driver()
    seen = http_provider(
        lambda _: (l if side == "load" else d).__setitem__(field, float("nan"))
    )
    result = m.match_bilateral([l], [d])
    assert seen
    assert result == {
        "assignments": [{"load_index": 0, "driver_index": 0, "match_score": 1.0}],
        "unmatched_loads": [],
        "unmatched_drivers": [],
    }


def test_overweight_cannot_be_accepted_by_native_capacity_replacement(http_provider):
    l, d = load(), driver()
    d["max_weight_kg"] = 1.0
    http_provider(lambda _: d.__setitem__("max_weight_kg", float("nan")))
    assert m.match_bilateral([l], [d]) == {
        "assignments": [],
        "unmatched_loads": [0],
        "unmatched_drivers": [0],
    }


@pytest.mark.parametrize("size", [(1, 102), (102, 1), (60, 60)])
def test_native_tiles_and_result_indices_keep_admitted_cardinality(
    http_provider, monkeypatch, size
):
    n, k = size
    ls, ds = [load() for _ in range(n)], [driver() for _ in range(k)]
    baseline = m.match_bilateral(copy.deepcopy(ls), copy.deepcopy(ds))

    def mutate(call):
        if call == 1:
            for record in ls + ds:
                record.clear()
            ls.clear()
            ds.clear()

    seen = http_provider(mutate)
    assert m.match_bilateral(ls, ds) == baseline
    assert len(seen) >= 2
    assert all(set(coords) == {"0.0,0.0"} for coords in seen)
    assert not ls and not ds


@pytest.mark.parametrize("converter", [str, Decimal])
def test_admitted_numeric_coercions_are_used_without_mutating_callers(converter):
    l, d = load(), driver()
    expected = m.match_bilateral([l], [d])
    l = {key: converter(value) for key, value in l.items()}
    d = {key: converter(value) for key, value in d.items()}
    before = copy.deepcopy((l, d))
    assert m.match_bilateral([l], [d]) == expected
    assert (l, d) == before


@pytest.mark.parametrize(
    "preference", [{}, {"preferred_dest_lat": None}, {"preferred_dest_lng": "0"}]
)
def test_optional_preferences_and_rating_default_stay_compatible(preference):
    d = driver()
    for key in ("rating", "preferred_dest_lat", "preferred_dest_lng"):
        d.pop(key)
    d.update(preference)
    before = copy.deepcopy(d)
    assert m.match_bilateral([load()], [d])["assignments"][0]["match_score"] == 1.0
    assert d == before


def test_invalid_last_record_is_rejected_before_provider_dispatch(monkeypatch):
    def unexpected(*args):
        pytest.fail("invalid admitted problem reached provider")

    monkeypatch.setattr(m, "_fetch_route_duration_matrix", unexpected)
    good, bad = driver(), driver()
    bad["rating"] = float("nan")
    before = copy.deepcopy(good)
    with pytest.raises(ValueError, match=r"drivers\[1\].rating"):
        m.match_bilateral([load()], [good, bad])
    assert good == before
