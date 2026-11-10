"""Request-admission circuit for callers sharing one asyncio event loop.

Transitions contain no awaits, so only one request can claim the recovery probe.
Generations prevent older in-flight requests from changing a newer circuit state.
"""
import math
import time
from dataclasses import dataclass


@dataclass(frozen=True)
class Admission:
    generation: int
    probe: bool


class RecoveryCircuit:
    def __init__(self, failure_threshold=5, recovery_seconds=30, clock=None):
        if isinstance(failure_threshold, bool) or not isinstance(failure_threshold, int) or failure_threshold < 1:
            raise ValueError('failure_threshold must be a positive integer')
        if not math.isfinite(recovery_seconds) or recovery_seconds <= 0:
            raise ValueError('recovery_seconds must be positive and finite')
        self.failure_threshold = failure_threshold
        self.recovery_seconds = recovery_seconds
        self._clock = clock or time.monotonic
        self.state = 'closed'
        self.failures = 0
        self._generation = 0
        self._opened_at = None
        self._successes = 0
        self._failed_requests = 0
        self._rejections = 0
        self._cancelled_probes = 0

    def admit(self):
        if self.state == 'closed':
            return Admission(self._generation, False)
        if self.state == 'open' and self._clock() - self._opened_at >= self.recovery_seconds:
            self.state = 'half_open'
            return Admission(self._generation, True)
        self._rejections += 1
        return None

    def _open(self):
        self.state = 'open'
        self._opened_at = self._clock()
        self._generation += 1

    def is_current(self, admission):
        return (admission.generation == self._generation
                and admission.probe == (self.state == 'half_open'))

    def finish(self, admission, *, succeeded):
        if not self.is_current(admission):
            return
        if succeeded:
            self._successes += 1
            self.failures = 0
            if admission.probe:
                self.state = 'closed'
                self._opened_at = None
                self._generation += 1
        else:
            self._failed_requests += 1
            self.failures += 1
            if admission.probe or self.failures >= self.failure_threshold:
                self._open()

    def cancel(self, admission):
        # A cancelled probe cannot leave recovery stuck in half-open forever.
        if admission.probe and admission.generation == self._generation and self.state == 'half_open':
            self._cancelled_probes += 1
            self._open()

    def snapshot(self):
        remaining = 0.0
        if self.state != 'closed':
            remaining = max(0.0, self.recovery_seconds - (self._clock() - self._opened_at))
        return {
            'state': self.state,
            'consecutive_failures': self.failures,
            'retry_after_seconds': remaining,
            'successful_requests': self._successes,
            'failed_requests': self._failed_requests,
            'rejected_requests': self._rejections,
            'cancelled_probes': self._cancelled_probes,
        }
