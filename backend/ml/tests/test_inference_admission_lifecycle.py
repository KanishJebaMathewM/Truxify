"""Actual native worker/loop lifecycle regressions, without model/provider calls."""

import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from app import execution
from fastapi import HTTPException


@pytest.fixture(autouse=True)
def restore():
    yield
    execution.configure()


async def started(event):
    async with asyncio.timeout(1):
        while not event.is_set():
            await asyncio.sleep(0.001)


async def idle():
    async with asyncio.timeout(1):
        while execution._active_inference:
            await asyncio.sleep(0.001)


@pytest.mark.parametrize("outcome", ["disconnect", "deadline"])
def test_cancelled_response_retains_capacity_until_native_exit(outcome):
    execution.configure(
        max_concurrent=1,
        max_workers=1,
        queue_timeout=0.005,
        inference_timeout=0.02 if outcome == "deadline" else 1,
    )
    entered, release = threading.Event(), threading.Event()

    def work():
        entered.set()
        release.wait(2)
        return 42

    async def scenario():
        task = asyncio.create_task(execution.run_inference(work))
        try:
            await started(entered)
            if outcome == "disconnect":
                task.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await task
            else:
                with pytest.raises(HTTPException) as error:
                    await task
                assert error.value.status_code == 504
            for _ in range(12):
                with pytest.raises(HTTPException) as error:
                    await execution.run_inference(lambda: "must not queue")
                assert error.value.status_code == 503
            assert execution._inference_executor._work_queue.qsize() == 0
            assert execution._active_inference == 1
        finally:
            release.set()
            await idle()
        assert await execution.run_inference(lambda: "recovered") == "recovered"

    asyncio.run(scenario())


def test_closed_loop_does_not_release_live_capacity_or_leak_completion():
    execution.configure(max_concurrent=1, max_workers=1, queue_timeout=0.01)
    entered, release, returned = threading.Event(), threading.Event(), threading.Event()

    def work():
        entered.set()
        release.wait(2)
        returned.set()

    async def first_loop():
        task = asyncio.create_task(execution.run_inference(work))
        await started(entered)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    try:
        asyncio.run(first_loop())

        async def next_loop():
            with pytest.raises(HTTPException) as error:
                await execution.run_inference(lambda: "forbidden")
            assert error.value.status_code == 503

        asyncio.run(next_loop())
    finally:
        release.set()
        assert returned.wait(1)
        asyncio.run(idle())

    async def recovered():
        return await execution.run_inference(lambda: "ok")

    assert asyncio.run(recovered()) == "ok"


def test_two_simultaneous_event_loops_share_native_admission():
    execution.configure(max_concurrent=1, max_workers=1, queue_timeout=0.01)
    entered, release = threading.Event(), threading.Event()

    def work():
        entered.set()
        release.wait(2)

    async def one():
        await execution.run_inference(work)

    async def two():
        with pytest.raises(HTTPException) as error:
            await execution.run_inference(lambda: "not submitted")
        assert error.value.status_code == 503

    with ThreadPoolExecutor(max_workers=1) as caller:
        first = caller.submit(asyncio.run, one())
        try:
            assert entered.wait(1)
            asyncio.run(two())
            assert execution._inference_executor._work_queue.qsize() == 0
        finally:
            release.set()
        first.result(timeout=1)


def test_waiter_budget_and_cancellation_cleanup():
    execution.configure(max_concurrent=1, max_workers=1, max_waiters=1, queue_timeout=1)
    entered, release = threading.Event(), threading.Event()

    def work():
        entered.set()
        release.wait(2)

    async def scenario():
        owner = asyncio.create_task(execution.run_inference(work))
        await started(entered)
        waiting = asyncio.create_task(execution.run_inference(lambda: "waiting"))
        try:
            await asyncio.sleep(0.005)
            assert execution._waiting_inference == 1
            with pytest.raises(HTTPException) as error:
                await execution.run_inference(lambda: "overflow")
            assert error.value.status_code == 503
            waiting.cancel()
            with pytest.raises(asyncio.CancelledError):
                await waiting
            assert execution._waiting_inference == 0
        finally:
            release.set()
            await owner

    asyncio.run(scenario())


def test_pool_reconfiguration_retains_old_worker_capacity():
    execution.configure(max_concurrent=1, max_workers=1, queue_timeout=0.01)
    entered, release = threading.Event(), threading.Event()

    def work():
        entered.set()
        release.wait(2)

    async def scenario():
        owner = asyncio.create_task(execution.run_inference(work))
        try:
            await started(entered)
            execution.configure(max_concurrent=1, max_workers=1, queue_timeout=0.01)
            with pytest.raises(HTTPException) as error:
                await execution.run_inference(lambda: "no new capacity")
            assert error.value.status_code == 503
        finally:
            release.set()
            await owner
        assert await execution.run_inference(lambda: 1) == 1

    asyncio.run(scenario())


def test_submission_failure_releases_capacity():
    execution.configure(max_concurrent=1, max_workers=1)
    execution.close_inference_executor()

    async def scenario():
        with pytest.raises(RuntimeError, match="shutdown"):
            await execution.run_inference(lambda: 1)

    asyncio.run(scenario())
    assert execution._active_inference == 0


def test_callable_timeout_is_not_relabelled_as_response_deadline():
    def work():
        raise TimeoutError("provider timeout")

    async def scenario():
        with pytest.raises(TimeoutError, match="provider timeout"):
            await execution.run_inference(work)

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "limits",
    [
        {"max_concurrent": 0},
        {"max_workers": 0},
        {"max_waiters": -1},
        {"queue_timeout": float("nan")},
        {"inference_timeout": 0},
    ],
)
def test_invalid_configuration_does_not_replace_pool(limits):
    old = execution._inference_executor
    with pytest.raises(ValueError):
        execution.configure(**limits)
    assert execution._inference_executor is old
