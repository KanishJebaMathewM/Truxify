"""Durable A/B identities and atomic metric admission on the existing database."""

import math
from contextlib import contextmanager
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Integer, String, select, text, update
from sqlalchemy.orm import declarative_base

LedgerBase = declarative_base()
TERMINAL = {"rolled_back", "rollback_failed"}


class ABExperiment(LedgerBase):
    __tablename__ = "ab_experiments"
    test_id = Column(String(100), primary_key=True)
    production_version = Column(String(50), nullable=True)
    shadow_version = Column(String(50), nullable=True)
    started_at = Column(DateTime, nullable=False)
    status = Column(String(30), nullable=False, default="active")
    revision = Column(Integer, nullable=False, default=0)


class ExperimentLedger:
    def __init__(self, engine, session_factory, metric_class, production_version):
        self.engine = engine
        self.Session = session_factory
        self.Metric = metric_class
        self.production_version = production_version
        LedgerBase.metadata.create_all(engine)

    @contextmanager
    def transaction(self):
        session = self.Session()
        try:
            if self.engine.dialect.name == "sqlite":
                # SQLite has no SELECT FOR UPDATE. Acquire its native write lock
                # before reading, so concurrent services cannot upgrade stale reads.
                session.execute(text("BEGIN IMMEDIATE"))
            yield session
            session.commit()
        except BaseException:
            session.rollback()
            raise
        finally:
            session.close()

    @staticmethod
    def _identifier(value, limit, name):
        if not isinstance(value, str) or not value.strip() or len(value) > limit:
            raise ValueError(f"Invalid {name}")
        return value

    @staticmethod
    def snapshot(state):
        return {
            "test_id": state.test_id,
            "production_version": state.production_version,
            "shadow_version": state.shadow_version,
            "started_at": state.started_at.isoformat(),
            "status": state.status,
        }

    def _ensure(self, session, test_id, create=False):
        state = session.get(ABExperiment, test_id)
        if state is not None:
            return state
        rows = session.scalars(
            select(self.Metric)
            .where(self.Metric.test_id == test_id)
            .order_by(self.Metric.timestamp, self.Metric.id)
        ).all()
        if not rows and not create:
            return None
        if rows:
            versions = {row.model_version for row in rows}
            # Old real-generation rows carry no authoritative role metadata.
            # Only the legacy literal production label proves a recoverable pair.
            unambiguous = "production" in versions and len(versions) <= 2
            production = "production" if unambiguous else None
            shadow = (
                next((v for v in versions if v != "production"), None)
                if unambiguous
                else None
            )
            terminal = {row.status for row in rows if row.status in TERMINAL}
            status = (
                ("rollback_failed" if "rollback_failed" in terminal else "rolled_back")
                if terminal
                else ("active" if unambiguous else "ambiguous")
            )
            started = rows[0].timestamp
        else:
            production = self._identifier(
                self.production_version(), 50, "production version"
            )
            shadow, status = None, "active"
            started = datetime.now(timezone.utc).replace(tzinfo=None)
        state = ABExperiment(
            test_id=test_id,
            production_version=production,
            shadow_version=shadow,
            started_at=started,
            status=status,
            revision=0,
        )
        session.add(state)
        session.flush()
        return state

    def read(self, test_id):
        self._identifier(test_id, 100, "test id")
        with self.transaction() as session:
            state = self._ensure(session, test_id)
            return self.snapshot(state) if state is not None else None

    def log(self, test_id, model_version, metrics, request_id):
        self._identifier(test_id, 100, "test id")
        self._identifier(model_version, 50, "model version")
        self._identifier(request_id, 100, "request id")
        if not isinstance(metrics, dict) or not metrics:
            raise ValueError("Metrics must be a nonempty mapping")
        admitted = {}
        for name, value in metrics.items():
            self._identifier(name, 50, "metric name")
            if type(value) not in (int, float):
                raise ValueError("Metric values must be finite numbers")
            try:
                numeric = float(value)
            except OverflowError as exc:
                raise ValueError("Metric values must be finite numbers") from exc
            if not math.isfinite(numeric):
                raise ValueError("Metric values must be finite numbers")
            admitted[name] = numeric
        with self.transaction() as session:
            state = self._ensure(session, test_id, create=True)
            if state.status in TERMINAL:
                return False
            if state.status != "active":
                raise ValueError("Legacy experiment identities are ambiguous")
            shadow = state.shadow_version
            if model_version not in (state.production_version, "production"):
                if shadow is not None and shadow != model_version:
                    raise ValueError("Experiment shadow version is already bound")
                shadow = model_version
            changed = session.execute(
                update(ABExperiment)
                .where(
                    ABExperiment.test_id == test_id,
                    ABExperiment.status == "active",
                    ABExperiment.revision == state.revision,
                )
                .values(shadow_version=shadow, revision=state.revision + 1)
            )
            if changed.rowcount != 1:
                raise ValueError("Experiment state changed; retry metric admission")
            stamp = datetime.now(timezone.utc).replace(tzinfo=None)
            session.add_all(
                [
                    self.Metric(
                        test_id=test_id,
                        model_version=model_version,
                        metric_name=name,
                        metric_value=value,
                        sample_size=1,
                        request_id=request_id,
                        status="active",
                        timestamp=stamp,
                    )
                    for name, value in admitted.items()
                ]
            )
        return True

    def terminal(self, test_id, status):
        if status not in TERMINAL:
            raise ValueError(f"Unsupported terminal A/B test status: {status}")
        with self.transaction() as session:
            state = self._ensure(session, test_id)
            if state is None:
                raise ValueError("Unknown experiment")
            if state.status in TERMINAL:
                return self.snapshot(state)
            changed = session.execute(
                update(ABExperiment)
                .where(
                    ABExperiment.test_id == test_id,
                    ABExperiment.revision == state.revision,
                    ABExperiment.status == state.status,
                )
                .values(status=status, revision=state.revision + 1)
            )
            if changed.rowcount != 1:
                raise ValueError("Experiment state changed; retry terminal transition")
            session.execute(
                update(self.Metric)
                .where(self.Metric.test_id == test_id)
                .values(status=status)
            )
            session.refresh(state)
            return self.snapshot(state)

    def active(self):
        with self.transaction() as session:
            missing = session.scalars(
                select(self.Metric.test_id)
                .outerjoin(ABExperiment, ABExperiment.test_id == self.Metric.test_id)
                .where(ABExperiment.test_id.is_(None))
                .distinct()
            ).all()
            for test_id in missing:
                self._ensure(session, test_id)
            state = session.scalars(
                select(ABExperiment)
                .where(
                    ABExperiment.status == "active",
                    ABExperiment.production_version.is_not(None),
                    ABExperiment.shadow_version.is_not(None),
                )
                .order_by(ABExperiment.started_at.desc(), ABExperiment.test_id)
            ).first()
            return self.snapshot(state) if state else None
