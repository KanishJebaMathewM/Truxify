"""Coordinated native experiment admission and local generation rollback."""

from datetime import datetime, timezone

from app.models.generation_rollback import (
    RollbackRecoveryError,
    provisional_rollback,
)
from services.ab_experiment_ledger import TERMINAL, ABExperiment
from sqlalchemy import select, update
from sqlalchemy.exc import SQLAlchemyError


def _result(test_id, action, reason, **fields):
    return {"action": action, "test_id": test_id, "reason": reason,
            "timestamp": datetime.now(timezone.utc).replace(tzinfo=None).isoformat(),
            **fields}


class RollbackOutcomeUnknown(RuntimeError):
    """The ledger outcome cannot be reconciled; no success is claimed."""


def _confirmed(service, test_id, receipt):
    """Reconcile a commit acknowledgement error using the exact native receipt."""
    if receipt is None:
        return False
    try:
        with service.Session() as session:
            state = session.scalar(select(ABExperiment).where(
                ABExperiment.test_id == test_id))
            return bool(state is not None
                        and (state.revision, state.status, state.production_version,
                             state.shadow_version) == receipt)
    except SQLAlchemyError as exc:
        raise RollbackOutcomeUnknown("Cannot confirm rollback ledger publication") from exc


def rollback_experiment(service, test_id, model_name):
    ledger = service.ledger
    ledger._identifier(test_id, 100, "test id")
    receipt = None
    result = None
    # Consistent order: model writer first, then native ledger transaction.
    # SQLite log admission reads a pointer, never acquires the model writer.
    with provisional_rollback(model_name) as mutation:
        try:
            with ledger.transaction() as session:
                state = ledger._ensure(session, test_id)
                if state is not None and state.status in TERMINAL:
                    return _result(test_id, "none", "Experiment is terminal",
                                   status=state.status)
                metrics = session.query(service.ledger.Metric).filter(
                    service.ledger.Metric.test_id == test_id).all()
                evaluation = service._evaluate_snapshot(
                    test_id, ledger.snapshot(state) if state else None, metrics)
                if evaluation.get("error"):
                    return _result(test_id, "none", evaluation["error"])
                if not evaluation.get("has_comparison", False):
                    return _result(test_id, "insufficient_metrics",
                                   "Production and shadow metrics are not comparable")
                if not evaluation.get("should_rollback", False):
                    return _result(test_id, "promote", "Shadow model performed well")
                if state is None or state.status != "active":
                    return _result(test_id, "none", "Experiment is not active")
                revision = state.revision
                reserved = session.execute(update(ABExperiment).where(
                    ABExperiment.test_id == test_id,
                    ABExperiment.status == "active",
                    ABExperiment.revision == revision,
                ).values(status="rolling_back", revision=revision + 1))
                if reserved.rowcount != 1:
                    raise ValueError("Experiment changed before rollback admission")
                try:
                    restored = mutation.restore_pair(
                        state.shadow_version, state.production_version)
                    failure_reason = "Model generations do not match the experiment or are unavailable"
                except RollbackRecoveryError:
                    raise
                except Exception:  # noqa: BLE001 -- recovered native mutation boundary
                    # restore_pair recovered the original pair before returning
                    # control; failures are terminal without a model side effect.
                    restored = None
                    failure_reason = "Native model rollback failed and was recovered"
                status = "rolled_back" if restored else "rollback_failed"
                terminal = session.execute(update(ABExperiment).where(
                    ABExperiment.test_id == test_id,
                    ABExperiment.status == "rolling_back",
                    ABExperiment.revision == revision + 1,
                ).values(status=status, revision=revision + 2))
                if terminal.rowcount != 1:
                    raise ValueError("Experiment changed during rollback publication")
                session.execute(update(ledger.Metric).where(
                    ledger.Metric.test_id == test_id).values(status=status))
                receipt = (revision + 2, status, state.production_version,
                           state.shadow_version)
                result = _result(
                    test_id, "rollback" if restored else "rollback_failed",
                    "Shadow model underperformed" if restored else failure_reason,
                    rolled_back=bool(restored),
                    production_version=restored if restored else None,
                )
        except Exception:
            # The context has rolled back/closed the failed native session.
            # A commit that succeeded before its acknowledgement failed must
            # not be compensated, or files and the terminal ledger would diverge.
            try:
                confirmed = _confirmed(service, test_id, receipt)
            except RollbackOutcomeUnknown:
                mutation.leave_unconfirmed()
                raise
            if not confirmed:
                raise
        mutation.accept()
    return result
