import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from services.traffic_pipeline import TrafficPipeline

SOURCE = {'lat': 12, 'lng': 77}
DEST = {'lat': 13, 'lng': 78}
ROUTE = {'routes': [{'duration': 100, 'distance': 1000}]}


def pipeline():
    instance = TrafficPipeline.__new__(TrafficPipeline)
    instance.osrm_url = 'http://localhost:5000'
    instance.traffic_connect_timeout = 2
    instance.traffic_total_timeout = 5
    instance._osrm_failure_count = 0
    instance._osrm_circuit_open = False
    return instance


def http_client(json_result):
    response = MagicMock()
    response.json = AsyncMock(side_effect=json_result)
    session = MagicMock()
    session.get.return_value.__aenter__.return_value = response
    client = MagicMock()
    client.__aenter__ = AsyncMock(return_value=session)
    client.__aexit__ = AsyncMock(return_value=None)
    return client


@pytest.mark.asyncio
async def test_actual_fetch_recovers_after_cooldown():
    instance = pipeline()
    now = [0.0]
    client = http_client([asyncio.TimeoutError()] * 15 + [ROUTE])
    with patch('time.monotonic', side_effect=lambda: now[0], create=True), \
            patch('services.traffic_pipeline.aiohttp.ClientSession', return_value=client) as sessions, \
            patch('services.traffic_pipeline.asyncio.sleep', new_callable=AsyncMock):
        for _ in range(5):
            await instance._fetch_osrm_data(SOURCE, DEST)
        assert instance._osrm_circuit_open
        assert sessions.call_count == 15
        await instance._fetch_osrm_data(SOURCE, DEST)
        assert sessions.call_count == 15
        now[0] = 31.0
        result = await instance._fetch_osrm_data(SOURCE, DEST)
        assert result['duration'] == 100
        assert not instance._osrm_circuit_open
        assert sessions.call_count == 16


@pytest.mark.asyncio
async def test_concurrent_calls_share_one_probe_and_cancellation_releases_it():
    instance = pipeline()
    circuit = instance._get_osrm_circuit()
    now = [100.0]
    circuit._clock = lambda: now[0]
    circuit._open()
    now[0] += 30
    entered = asyncio.Event()
    release = asyncio.Event()

    async def stalled_response():
        entered.set()
        await release.wait()
        return ROUTE

    client = http_client(stalled_response)
    with patch('services.traffic_pipeline.aiohttp.ClientSession', return_value=client) as sessions:
        probe = asyncio.create_task(instance._fetch_osrm_data(SOURCE, DEST))
        await entered.wait()
        results = await asyncio.gather(*(instance._fetch_osrm_data(SOURCE, DEST) for _ in range(25)))
        assert all('duration' not in result for result in results)
        assert sessions.call_count == 1
        probe.cancel()
        with pytest.raises(asyncio.CancelledError):
            await probe
        assert instance.get_osrm_health()['state'] == 'open'
        assert instance.get_osrm_health()['cancelled_probes'] == 1
        now[0] += 30
        release.set()
        assert (await instance._fetch_osrm_data(SOURCE, DEST))['duration'] == 100
        assert sessions.call_count == 2
        assert instance.get_osrm_health()['state'] == 'closed'


@pytest.mark.asyncio
async def test_failed_probe_uses_one_attempt_and_reopens():
    instance = pipeline()
    circuit = instance._get_osrm_circuit()
    now = [0.0]
    circuit._clock = lambda: now[0]
    circuit._open()
    now[0] = 30
    client = http_client([asyncio.TimeoutError()])
    with patch('services.traffic_pipeline.aiohttp.ClientSession', return_value=client) as sessions, \
            patch('services.traffic_pipeline.asyncio.sleep', new_callable=AsyncMock) as sleep:
        result = await instance._fetch_osrm_data(SOURCE, DEST)
        assert 'duration' not in result
        assert sessions.call_count == 1
        sleep.assert_not_awaited()
        assert instance.get_osrm_health()['state'] == 'open'
        await instance._fetch_osrm_data(SOURCE, DEST)
        assert sessions.call_count == 1


@pytest.mark.asyncio
async def test_no_route_response_proves_dependency_recovered():
    instance = pipeline()
    circuit = instance._get_osrm_circuit()
    now = [0.0]
    circuit._clock = lambda: now[0]
    circuit._open()
    now[0] = 30
    client = http_client([{'code': 'NoRoute', 'routes': []}])
    with patch('services.traffic_pipeline.aiohttp.ClientSession', return_value=client):
        assert 'duration' not in await instance._fetch_osrm_data(SOURCE, DEST)
        assert instance.get_osrm_health()['state'] == 'closed'


@pytest.mark.asyncio
async def test_http_errors_do_not_close_recovery_circuit():
    instance = pipeline()
    circuit = instance._get_osrm_circuit()
    now = [0.0]
    circuit._clock = lambda: now[0]
    circuit._open()
    now[0] = 30
    client = http_client([ROUTE])
    response = client.__aenter__.return_value.get.return_value.__aenter__.return_value
    import aiohttp
    response.raise_for_status.side_effect = aiohttp.ClientError('503')
    with patch('services.traffic_pipeline.aiohttp.ClientSession', return_value=client):
        assert 'duration' not in await instance._fetch_osrm_data(SOURCE, DEST)
        response.json.assert_not_awaited()
        assert instance.get_osrm_health()['state'] == 'open'


@pytest.mark.asyncio
async def test_actual_http_transport_recovers_from_server_outage():
    from aiohttp import web
    from services.recovery_circuit import RecoveryCircuit

    healthy = [False]
    calls = [0]

    async def route(_request):
        calls[0] += 1
        if not healthy[0]:
            return web.json_response({'message': 'unavailable'}, status=503)
        return web.json_response(ROUTE)

    app = web.Application()
    app.router.add_get('/route/v1/driving/{coordinates}', route)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, '127.0.0.1', 0)
    try:
        await site.start()
        port = site._server.sockets[0].getsockname()[1]
        instance = pipeline()
        instance.osrm_url = f'http://127.0.0.1:{port}'
        now = [0.0]
        instance._osrm_circuit = RecoveryCircuit(failure_threshold=1, clock=lambda: now[0])
        with patch('services.traffic_pipeline.asyncio.sleep', new_callable=AsyncMock):
            assert 'duration' not in await instance._fetch_osrm_data(SOURCE, DEST)
            assert calls[0] == 3
            healthy[0] = True
            assert 'duration' not in await instance._fetch_osrm_data(SOURCE, DEST)
            assert calls[0] == 3
            now[0] = 30
            assert (await instance._fetch_osrm_data(SOURCE, DEST))['distance'] == 1000
            assert calls[0] == 4
            assert instance.get_osrm_health()['state'] == 'closed'
    finally:
        await runner.cleanup()


@pytest.mark.asyncio
async def test_stale_inflight_failure_does_not_retry_into_new_outage():
    from services.recovery_circuit import RecoveryCircuit
    instance = pipeline()
    instance._osrm_circuit = RecoveryCircuit(failure_threshold=1)
    entered = asyncio.Event()
    release = asyncio.Event()

    async def late_failure():
        entered.set()
        await release.wait()
        raise asyncio.TimeoutError()

    client = http_client(late_failure)
    with patch('services.traffic_pipeline.aiohttp.ClientSession', return_value=client) as sessions, \
            patch('services.traffic_pipeline.asyncio.sleep', new_callable=AsyncMock):
        request = asyncio.create_task(instance._fetch_osrm_data(SOURCE, DEST))
        await entered.wait()
        circuit = instance._osrm_circuit
        circuit.finish(circuit.admit(), succeeded=False)
        release.set()
        assert 'duration' not in await request
        assert sessions.call_count == 1
        assert instance.get_osrm_health()['state'] == 'open'
        assert instance.get_osrm_health()['failed_requests'] == 1


@pytest.mark.asyncio
async def test_probe_cleanup_covers_failure_before_http_dispatch():
    instance = pipeline()
    circuit = instance._get_osrm_circuit()
    now = [0.0]
    circuit._clock = lambda: now[0]
    circuit._open()
    now[0] = 30
    with pytest.raises(KeyError):
        await instance._fetch_osrm_data({}, DEST)
    assert instance.get_osrm_health()['state'] == 'open'
    now[0] = 60
    assert circuit.admit().probe
