import asyncio
import time

import pytest

from app import execution
from app.execution import (
    run_inference,
    inference_capacity,
    close_inference_executor,
)


@pytest.fixture(autouse=True)
def restore_execution():
    """Isolate test config so a capped/rebuild executor never leaks into
    other test modules (which run their own TestClient event loops)."""
    yield
    execution.configure()


class TestRunInference:
    def test_returns_result(self):
        async def scenario():
            return await run_inference(lambda: 6 * 7)

        assert asyncio.run(scenario()) == 42

    def test_passes_args_and_kwargs(self):
        def combine(a, b, *, suffix):
            return f"{a}{b}{suffix}"

        async def scenario():
            return await run_inference(combine, "foo", "bar", suffix="baz")

        assert asyncio.run(scenario()) == "foobarbaz"

    def test_runs_off_the_event_loop_thread(self):
        import threading

        async def scenario():
            loop_thread = threading.get_ident()
            worker_thread = await run_inference(threading.get_ident)
            return loop_thread, worker_thread

        loop_thread, worker_thread = asyncio.run(scenario())
        assert worker_thread != loop_thread

    def test_propagates_callable_exception(self):
        def boom():
            raise ValueError("boom")

        async def scenario():
            return await run_inference(boom)

        with pytest.raises(ValueError, match="boom"):
            asyncio.run(scenario())

    def test_releases_capacity_after_exception(self):
        execution.configure(max_concurrent=1, max_workers=1)

        def boom():
            raise RuntimeError("boom")

        async def scenario():
            semaphore = execution._get_semaphore()
            with pytest.raises(RuntimeError):
                await run_inference(boom)
            # A second call must be able to acquire immediately; otherwise the
            # leaked slot would have wedged the pipeline.
            result = await run_inference(lambda: "ok")
            return semaphore, result

        semaphore, result = asyncio.run(scenario())
        assert result == "ok"
        assert semaphore.locked() is False

    def test_works_across_separate_event_loops(self):
        """pytest / TestClient run the app on a fresh loop per module; the
        per-loop semaphore must never raise 'bound to a different event loop'."""
        async def one():
            return await run_inference(lambda: "a")

        async def two():
            return await run_inference(lambda: "b")

        assert asyncio.run(one()) == "a"
        assert asyncio.run(two()) == "b"


class TestConcurrencyCap:
    def test_limits_concurrent_executions(self):
        execution.configure(max_concurrent=2, max_workers=2)
        active = 0
        peak = 0
        lock = __import__("threading").Lock()

        def work(i):
            nonlocal active, peak
            with lock:
                active += 1
                peak = max(peak, active)
            time.sleep(0.1)
            with lock:
                active -= 1
            return i

        async def scenario():
            return await asyncio.gather(*(run_inference(work, i) for i in range(6)))

        results = asyncio.run(scenario())
        assert results == [0, 1, 2, 3, 4, 5]
        assert peak == 2

    def test_capacity_exhausted_returns_503(self):
        execution.configure(max_concurrent=1, max_workers=1, queue_timeout=0.05)

        def slow(i):
            time.sleep(0.2)
            return i

        async def scenario():
            return await asyncio.gather(
                run_inference(slow, "a"),
                run_inference(slow, "b"),
                return_exceptions=True,
            )

        results = asyncio.run(scenario())
        errors = [r for r in results if isinstance(r, BaseException)]
        assert results[0] == "a"
        assert len(errors) == 1
        assert errors[0].status_code == 503
        assert "capacity" in str(errors[0].detail)

    def test_configure_rebuilds_and_restores(self):
        execution.configure(max_concurrent=8, max_workers=8)
        assert inference_capacity() == 8

        execution.configure()
        assert inference_capacity() == execution.ML_MAX_CONCURRENT_INFERENCE

    def test_workers_never_below_cap(self):
        execution.configure(max_concurrent=5, max_workers=1)
        assert execution.ML_INFERENCE_MAX_WORKERS == 5


class TestCloseExecutor:
    def test_close_is_idempotent(self):
        close_inference_executor()
        close_inference_executor()
