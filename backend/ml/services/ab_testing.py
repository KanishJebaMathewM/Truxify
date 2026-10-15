import logging
import random
from datetime import datetime, timezone
from typing import Any

from app.models.base import get_active_generation
from app.models.demand_forecast import MODEL_NAME as DEMAND_MODEL_NAME
from app.models.demand_forecast import reset_model_cache
from services.ab_experiment_ledger import ExperimentLedger
from services.ab_metric_comparison import (
    admit_threshold,
    eligible_pairs,
    improvement,
    shadow_better,
    summarize,
)
from sqlalchemy import (
    Column,
    DateTime,
    Float,
    Integer,
    String,
    create_engine,
    inspect,
    text,
)
from sqlalchemy.orm import declarative_base, sessionmaker

logger = logging.getLogger(__name__)
Base = declarative_base()


class ABTestMetrics(Base):
    __tablename__ = "ab_test_metrics"

    id = Column(Integer, primary_key=True)
    model_version = Column(String(50))
    test_id = Column(String(100))
    metric_name = Column(String(50))
    metric_value = Column(Float)
    sample_size = Column(Integer)
    timestamp = Column(
        DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None)
    )
    request_id = Column(String(100))
    status = Column(String(30), default="active")


class ABTestModel:
    """A/B Testing with shadow deployment and auto-rollback"""

    def __init__(self, db_url: str, threshold: float = 0.95):
        threshold = admit_threshold(threshold)
        self.engine = create_engine(db_url)
        Base.metadata.create_all(self.engine)
        if "status" not in {
            column["name"]
            for column in inspect(self.engine).get_columns("ab_test_metrics")
        }:
            with self.engine.begin() as connection:
                connection.execute(
                    text(
                        "ALTER TABLE ab_test_metrics ADD COLUMN status VARCHAR(30) DEFAULT 'active'"
                    )
                )
        self.Session = sessionmaker(bind=self.engine)
        self.threshold = threshold  # If new model < threshold% of old, rollback
        self.traffic_split = 0.10  # 10% to new model
        self._test_states: dict[
            str, dict[str, Any]
        ] = {}  # Legacy compatibility; never authoritative.
        self.ledger = ExperimentLedger(
            self.engine,
            self.Session,
            ABTestMetrics,
            lambda: self.get_production_version(),
        )

    def get_model_for_request(self, request_id: str) -> dict[str, Any]:
        """Route request to production or shadow model based on A/B split"""
        test_config = self.get_active_test()

        if not test_config:
            return {
                "model": "production",
                "version": self.get_production_version(),
                "test_id": None,
            }

        is_shadow = random.random() < self.traffic_split
        return {
            "model": "shadow" if is_shadow else "production",
            "version": test_config["shadow_version"]
            if is_shadow
            else test_config["production_version"],
            "test_id": test_config["test_id"],
            "is_shadow": is_shadow,
        }

    def log_metrics(
        self,
        test_id: str,
        model_version: str,
        metrics: dict[str, float],
        request_id: str,
    ):
        """Atomically bind experiment identity and admit a complete metric batch."""
        return self.ledger.log(test_id, model_version, metrics, request_id)

    def evaluate_test(self, test_id: str) -> dict[str, Any]:
        """Compare one coherent native ledger identity/metric snapshot."""
        with self.ledger.transaction() as session:
            state = self.ledger._ensure(session, test_id)
            metrics = session.query(ABTestMetrics).filter(
                ABTestMetrics.test_id == test_id).all()
            return self._evaluate_snapshot(
                test_id, self.ledger.snapshot(state) if state else None, metrics)

    def _evaluate_snapshot(self, test_id, test_state, metrics):
        if not metrics:
            return {"error": "No metrics found"}

        logged_versions = {m.model_version for m in metrics}
        if not test_state or not test_state.get("production_version"):
            return {
                "test_id": test_id,
                "results": {},
                "has_comparison": False,
                "shadow_better": False,
                "should_rollback": False,
                "error": "Legacy experiment identities are ambiguous",
            }
        prod_version = test_state["production_version"]
        shadow_version = test_state.get("shadow_version")

        # Keep evaluating legacy tests whose metrics used the old literal
        # production label, while new tests compare real generations.
        if prod_version not in logged_versions and "production" in logged_versions:
            prod_version = "production"

        results, invalid_names = summarize(metrics, prod_version, shadow_version)
        comparable_metrics = list(eligible_pairs(results))
        if not comparable_metrics:
            has_shadow_data = any(values['shadow'] is not None for values in results.values())
            if has_shadow_data:
                # Shadow metrics exist but none are comparable to production —
                # report a non-comparable evaluation rather than an error so
                # rollback handling can distinguish it from missing data.
                return {
                    "test_id": test_id,
                    "results": results,
                    **({"invalid_metric_rows": invalid_names} if invalid_names else {}),
                    "shadow_better": False,
                    "should_rollback": False,
                    "has_comparison": False,
                    "timestamp": datetime.now(timezone.utc)
                    .replace(tzinfo=None)
                    .isoformat(),
                }
            return {
                "test_id": test_id,
                "results": results,
                **({"invalid_metric_rows": invalid_names} if invalid_names else {}),
                "shadow_better": False,
                "should_rollback": False,
                "error": "Insufficient metrics for production vs shadow comparison",
                "timestamp": datetime.now(timezone.utc)
                .replace(tzinfo=None)
                .isoformat(),
            }

        is_better = self.is_shadow_better(results)

        has_comparison = len(comparable_metrics) > 0

        return {
            "test_id": test_id,
            "results": results,
            **({"invalid_metric_rows": invalid_names} if invalid_names else {}),
            "shadow_better": is_better,
            "should_rollback": has_comparison and not is_better,
            "has_comparison": has_comparison,
            "timestamp": datetime.now(timezone.utc)
            .replace(tzinfo=None)
            .isoformat(),
        }

    def calculate_improvement(
        self, prod_value: float, shadow_value: float, higher_is_better: bool = True
    ) -> float | None:
        """Finite display, or None when a valid exact change exceeds binary64."""
        return improvement(prod_value, shadow_value, higher_is_better)

    def is_shadow_better(self, results: dict) -> bool:
        """Vote only complete finite pairs using the existing directional gates."""
        return shadow_better(results, self.threshold)

    def get_active_test(self) -> dict | None:
        """Only durable, active, paired experiments are eligible for routing."""
        return self.ledger.active()

    def get_production_version(self) -> str:
        return get_active_generation(DEMAND_MODEL_NAME) or "production"

    def mark_test_terminal(self, test_id: str, status: str) -> dict:
        """Terminal status is authoritative and cannot be reopened by late metrics."""
        return self.ledger.terminal(test_id, status)

    def trigger_rollback(self, test_id: str) -> dict[str, Any]:
        """Own native experiment/model rollback and its publication receipt."""
        from services.ab_rollback import rollback_experiment

        result = rollback_experiment(self, test_id, DEMAND_MODEL_NAME)
        if result.get("rolled_back"):
            reset_model_cache()
        return result
