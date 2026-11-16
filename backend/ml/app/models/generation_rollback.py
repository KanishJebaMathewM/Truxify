"""Provisional process-local generation rollback with ordinary-failure recovery."""

from contextlib import contextmanager

from . import base


class RollbackRecoveryError(RuntimeError):
    """Storage recovery failed; the caller must not claim a preserved outcome."""


class ProvisionalRollback:
    def __init__(self, model_name):
        self.model_name = model_name
        self.original = None
        self.pending = False
        self.restored = None

    def restore_pair(self, expected_active, expected_previous):
        """Restore only the two exact, available, verified generation identities."""
        current = base.get_active_generation(self.model_name)
        previous = base.get_previous_generation(self.model_name)
        if (not expected_active or not expected_previous
                or current != expected_active or previous != expected_previous
                or current == previous):
            return None
        for generation in (current, previous):
            if (not base._generation_exists(self.model_name, generation)
                    or not base._verify_artifact(
                        base._generation_model_path(self.model_name, generation))):
                return None
        self.original = (current, previous)
        # Set before the first native write: a write may mutate and then raise.
        self.pending = True
        try:
            self._publish(previous, current)
        except Exception:
            self.recover()
            raise
        self.restored = previous
        return previous

    def _publish(self, active, previous):
        base._atomic_write_json(base._previous_ptr_path(self.model_name),
                                {"generation": previous})
        base._atomic_write_json(base._active_ptr_path(self.model_name),
                                {"generation": active})
        base._mirror_to_flat(self.model_name, active)
        base._sign_artifact(base.get_model_path(self.model_name))

    def recover(self):
        if not self.pending:
            return
        try:
            self._publish(*self.original)
        except Exception as exc:
            raise RollbackRecoveryError("Model rollback recovery failed") from exc
        self.pending = False
        self.restored = None

    def leave_unconfirmed(self):
        """Do not guess compensation when the ledger outcome is unreadable."""
        self.pending = False

    def accept(self):
        """Only call after the coordinating ledger publication is confirmed."""
        self.pending = False


@contextmanager
def provisional_rollback(model_name):
    """Retain the existing writer/read owner through mutation and ledger commit.

    The caller takes this owner before its ledger transaction. Ordinary
    exceptions recover the admitted pair and signed flat compatibility mirror.
    This cannot provide a crash-atomic filesystem/database transaction, and
    does not coordinate external processes or arbitrary reentrant writers.
    """
    with base._get_write_lock(model_name):
        mutation = ProvisionalRollback(model_name)
        try:
            yield mutation
        finally:
            mutation.recover()
