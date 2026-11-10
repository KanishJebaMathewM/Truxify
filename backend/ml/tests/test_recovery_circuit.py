import math

import pytest
from services.recovery_circuit import RecoveryCircuit


@pytest.fixture
def circuit():
    now = [100.0]
    instance = RecoveryCircuit(failure_threshold=2, recovery_seconds=30, clock=lambda: now[0])
    return instance, now


def open_circuit(instance):
    for _ in range(2):
        instance.finish(instance.admit(), succeeded=False)
    assert instance.state == 'open'


def test_cooldown_admits_exactly_one_probe(circuit):
    instance, now = circuit
    open_circuit(instance)
    now[0] += 29.999
    assert instance.admit() is None
    now[0] += 0.001
    probe = instance.admit()
    assert probe.probe
    assert all(instance.admit() is None for _ in range(100))
    instance.finish(probe, succeeded=True)
    assert instance.state == 'closed'
    assert instance.failures == 0
    assert not instance.admit().probe


def test_failed_probe_restarts_cooldown(circuit):
    instance, now = circuit
    open_circuit(instance)
    now[0] += 30
    instance.finish(instance.admit(), succeeded=False)
    assert instance.state == 'open'
    assert instance.snapshot()['retry_after_seconds'] == 30
    assert instance.admit() is None
    now[0] += 30
    assert instance.admit().probe


@pytest.mark.parametrize('succeeded', [True, False])
def test_old_inflight_completion_cannot_change_new_outage(circuit, succeeded):
    instance, now = circuit
    old = instance.admit()
    open_circuit(instance)
    instance.finish(old, succeeded=succeeded)
    assert instance.failures == 2
    assert instance.state == 'open'
    now[0] += 30
    probe = instance.admit()
    instance.finish(old, succeeded=succeeded)
    assert instance.state == 'half_open'
    instance.finish(probe, succeeded=True)
    instance.finish(old, succeeded=succeeded)
    assert instance.state == 'closed'
    assert instance.failures == 0


def test_cancelled_probe_does_not_wedge_recovery(circuit):
    instance, now = circuit
    open_circuit(instance)
    now[0] += 30
    probe = instance.admit()
    instance.cancel(probe)
    assert instance.state == 'open'
    assert instance.snapshot()['cancelled_probes'] == 1
    assert instance.snapshot()['retry_after_seconds'] == 30
    instance.finish(probe, succeeded=True)
    assert instance.state == 'open'
    now[0] += 30
    instance.finish(instance.admit(), succeeded=True)
    assert instance.state == 'closed'


def test_closed_request_cancellation_is_not_an_outage(circuit):
    instance, _ = circuit
    instance.cancel(instance.admit())
    assert instance.snapshot()['state'] == 'closed'
    assert instance.snapshot()['consecutive_failures'] == 0


def test_success_resets_consecutive_failures(circuit):
    instance, _ = circuit
    instance.finish(instance.admit(), succeeded=False)
    instance.finish(instance.admit(), succeeded=True)
    instance.finish(instance.admit(), succeeded=False)
    assert instance.state == 'closed'
    assert instance.failures == 1


@pytest.mark.parametrize('threshold', [0, -1, True, 1.5])
def test_invalid_threshold_rejected(threshold):
    with pytest.raises(ValueError):
        RecoveryCircuit(failure_threshold=threshold)


@pytest.mark.parametrize('seconds', [0, -1, math.inf, math.nan])
def test_invalid_recovery_delay_rejected(seconds):
    with pytest.raises(ValueError):
        RecoveryCircuit(recovery_seconds=seconds)
