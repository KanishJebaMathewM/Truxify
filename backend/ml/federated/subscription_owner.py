"""Process-local Redis listener ownership; admitted callbacks drain natively."""

import logging
import math
from threading import Event, RLock, Thread, current_thread

logger = logging.getLogger(__name__)


class _Listener(Thread):
    def __init__(self, pubsub):
        super().__init__(daemon=True, name='federated-subscription')
        self.pubsub = pubsub
        self.retired = Event()

    def stop(self):
        self.retired.set()

    def run(self):
        try:
            while not self.retired.is_set():
                self.pubsub.get_message(ignore_subscribe_messages=True, timeout=0.05)
        except Exception:
            logger.exception('Federated subscription reader exited')
        finally:
            # This thread is the sole reader. Never close underneath its parser.
            try:
                self.pubsub.close()
            except Exception:
                logger.exception('Federated subscription close failed')


class SubscriptionOwner:
    """One active or draining generation, with no replacement until native exit."""

    def __init__(self):
        self._lock = RLock()
        self._thread = None
        self._pubsub = None
        self._token = None
        self._accepting = False

    @property
    def thread(self):
        with self._lock:
            return self._thread

    @property
    def pubsub(self):
        with self._lock:
            return self._pubsub

    def _reap(self):
        if self._thread is not None and self._thread.is_alive():
            return False
        if self._pubsub is not None:
            self._pubsub.close()
        self._thread = self._pubsub = self._token = None
        self._accepting = False
        return True

    def start(self, redis_client, channel, handler):
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return self._accepting and not self._thread.retired.is_set()
            if not self._reap():
                return False
            token = object()

            def admitted(message):
                with self._lock:
                    if (
                        self._token is not token or not self._accepting
                        or self._thread is None or self._thread.retired.is_set()
                        or not self._thread.is_alive()
                    ):
                        return
                # Stop retires admission and joins this reader; timeout retains it.
                handler(message)

            pubsub = redis_client.pubsub()
            try:
                pubsub.subscribe(**{channel: admitted})
                thread = _Listener(pubsub)
                self._pubsub, self._thread = pubsub, thread
                self._token, self._accepting = token, True
                thread.start()
            except BaseException:
                self._accepting = False
                self._token = None
                pubsub.close()
                self._thread = self._pubsub = None
                raise
            return True

    def stop(self, timeout=1.0):
        """True means drained. False retains the retired worker and blocks restart."""
        if isinstance(timeout, bool) or not isinstance(timeout, (int, float)):
            raise TypeError('timeout must be finite and between 0 and 30 seconds')
        if not math.isfinite(timeout) or not 0 <= timeout <= 30:
            raise ValueError('timeout must be finite and between 0 and 30 seconds')
        with self._lock:
            self._accepting = False
            thread = self._thread
            if thread is None:
                return self._reap()
            thread.stop()
        if thread is current_thread():
            return False  # A callback cannot join itself; ownership remains draining.
        thread.join(timeout)
        with self._lock:
            # A concurrent stop/start may already have retired/replaced this owner.
            if self._thread is not thread:
                return not thread.is_alive()
            return self._reap()
