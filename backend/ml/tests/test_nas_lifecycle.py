"""Actual native search cycles, publication and mounted ASGI worker controls."""

import asyncio
import copy
import threading
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest
import torch
from fastapi import FastAPI
from nas import model as module
from routes import nas_routes


def invoke(search, method, evaluator, trials=1):
    if method == "evolutionary":
        return search.evolutionary_search(1, trials, evaluator)
    if method == "reinforcement":
        return search.reinforcement_search(trials, evaluator)
    return search.random_search(trials, evaluator)


@pytest.fixture
def search():
    previous = torch.get_num_threads()
    torch.set_num_threads(1)
    engine = module.NASSearcher(module.NASSearchSpace())
    yield engine
    torch.set_num_threads(previous)


@pytest.mark.parametrize("method", ["random", "evolutionary", "reinforcement"])
def test_native_cycles_serialize_and_warm_history_remains_readable(search, method):
    search.random_search(1, lambda _: 0.2)
    prior = search.snapshot_history()
    entered, release, second_started, second_evaluator = [
        threading.Event() for _ in range(4)
    ]

    def held(_):
        entered.set()
        assert release.wait(5)
        return 0.1

    def second():
        second_started.set()
        return search.random_search(1, lambda _: second_evaluator.set() or 0.9)

    with ThreadPoolExecutor(max_workers=3) as pool:
        first = pool.submit(invoke, search, method, held)
        try:
            assert entered.wait(5)
            next_cycle = pool.submit(second)
            assert second_started.wait(5)
            assert not second_evaluator.wait(0.05)
            assert pool.submit(search.snapshot_history).result(0.5) == prior
        finally:
            release.set()
        assert first.result(5)["best_score"] == 0.1
        assert next_cycle.result(5)["best_score"] == 0.9
    state = search.snapshot_history()
    assert state["best_performance"] == state["history"][0]["score"] == 0.9


@pytest.mark.parametrize("method", ["random", "evolutionary", "reinforcement"])
def test_failed_candidate_retains_entire_prior_completed_generation(search, method):
    search.random_search(3, lambda _: 0.4)
    prior = search.snapshot_history()
    calls = 0

    def fails(_):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("native evaluator rejected candidate")
        return 0.8

    with pytest.raises(RuntimeError, match="native evaluator rejected"):
        invoke(search, method, fails, 2)
    assert search.snapshot_history() == prior
    assert search.random_search(1, lambda _: 0.6)["best_score"] == 0.6


def test_history_snapshots_and_results_have_independent_ownership(search):
    result = search.random_search(25, lambda _: 0.7)
    before = search.snapshot_history()
    assert before["total_trials"] == 25 and len(before["history"]) == 20
    view = search.snapshot_history()
    view["history"][0]["architecture"]["filters"][0] = 9999
    view["best_architecture"]["layers"].clear()
    result["history"].clear()
    result["best_architecture"]["filters"].clear()
    assert search.snapshot_history() == before


def test_publication_preparation_does_not_expose_partial_state(search, monkeypatch):
    search.random_search(1, lambda _: 0.2)
    prior = search.snapshot_history()
    entered, release = threading.Event(), threading.Event()
    original = module.deepcopy

    def held_copy(value):
        if (
            isinstance(value, list)
            and value
            and isinstance(value[0], dict)
            and value[0].get("score") == 0.8
        ):
            entered.set()
            assert release.wait(5)
        return original(value)

    monkeypatch.setattr(module, "deepcopy", held_copy)
    with ThreadPoolExecutor(max_workers=2) as pool:
        writer = pool.submit(search.random_search, 1, lambda _: 0.8)
        try:
            assert entered.wait(5)
            assert pool.submit(search.snapshot_history).result(0.5) == prior
        finally:
            release.set()
        writer.result(5)
    view = search.snapshot_history()
    assert view["best_performance"] == view["history"][0]["score"] == 0.8


@pytest.mark.parametrize("method", ["random", "evolutionary"])
def test_actual_asgi_worker_cancellation_retains_native_cycle(
    search, monkeypatch, method
):
    search.random_search(1, lambda _: 0.2)
    prior = search.snapshot_history()
    entered, release, second_sample = (
        threading.Event(),
        threading.Event(),
        threading.Event(),
    )
    original = search.search_space.sample_random_architecture
    calls = 0

    def held_sample():
        nonlocal calls
        calls += 1
        if calls == 1:
            entered.set()
            assert release.wait(5)
        else:
            second_sample.set()
        return original()

    monkeypatch.setattr(search.search_space, "sample_random_architecture", held_sample)
    monkeypatch.setattr(nas_routes, "searcher", search)
    app = FastAPI()
    app.include_router(nas_routes.router)

    async def scenario():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://local"
        ) as client:
            payload = {
                "method": method,
                "num_trials": 1,
                "population_size": 1,
                "generations": 1,
            }
            first = asyncio.create_task(client.post("/nas/search", json=payload))
            second = None
            try:
                assert await asyncio.wait_for(asyncio.to_thread(entered.wait, 2), 2.5)
                # Actual history route remains responsive and publishes the prior generation.
                history = await asyncio.wait_for(client.get("/nas/history"), 0.5)
                assert history.status_code == 200 and history.json()["data"] == prior
                first.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await first
                second = asyncio.create_task(
                    client.post(
                        "/nas/search", json={"method": "random", "num_trials": 1}
                    )
                )
                await asyncio.sleep(0.05)
                assert not second_sample.is_set()
                history = await asyncio.wait_for(client.get("/nas/history"), 0.5)
                assert history.json()["data"] == prior
            finally:
                release.set()
                await asyncio.gather(
                    first, *([second] if second else []), return_exceptions=True
                )
            assert second is not None and second.result().status_code == 200
            state = search.snapshot_history()
            assert state["best_performance"] == state["history"][0]["score"]

    asyncio.run(scenario())


def test_actual_asgi_model_construction_runs_in_worker(monkeypatch):
    entered, release = threading.Event(), threading.Event()
    original = nas_routes.NASModel
    arch = {"layers": ["conv3x3"] * 3, "filters": [32] * 3, "activations": ["relu"] * 3}

    def held_model(value):
        entered.set()
        assert release.wait(5)
        return original(value)

    monkeypatch.setattr(nas_routes, "NASModel", held_model)
    app = FastAPI()
    app.include_router(nas_routes.router)

    async def scenario():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://local"
        ) as client:
            build = asyncio.create_task(
                client.post("/nas/build-model", json=copy.deepcopy(arch))
            )
            try:
                assert await asyncio.wait_for(asyncio.to_thread(entered.wait, 2), 2.5)
                response = await asyncio.wait_for(client.get("/nas/search-space"), 0.5)
                assert response.status_code == 200
            finally:
                release.set()
                await build
            assert build.result().status_code == 200
            assert build.result().json()["data"]["parameters"] > 0

    asyncio.run(scenario())


def test_failed_outward_result_copy_does_not_publish_candidate(search, monkeypatch):
    search.random_search(1, lambda _: 0.2)
    prior = search.snapshot_history()
    original = module.deepcopy
    history_copies = 0

    def fail_result(value):
        nonlocal history_copies
        if (
            isinstance(value, list)
            and value
            and isinstance(value[0], dict)
            and value[0].get("score") == 0.8
        ):
            history_copies += 1
            if history_copies == 2:
                raise RuntimeError("result ownership copy failed")
        return original(value)

    monkeypatch.setattr(module, "deepcopy", fail_result)
    with pytest.raises(RuntimeError, match="result ownership copy failed"):
        search.random_search(1, lambda _: 0.8)
    assert search.snapshot_history() == prior
