import logging
import math
import random
from datetime import datetime, timezone
from typing import Any

import pandas as pd
from app.models.base import get_active_generation, restore_previous_model
from app.models.demand_forecast import MODEL_NAME as DEMAND_MODEL_NAME
from app.models.demand_forecast import reset_model_cache
from services.ab_experiment_ledger import ExperimentLedger
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
        """Compare performance of production vs shadow model"""
        test_state = self.ledger.read(test_id)
        session = self.Session()
        try:
            metrics = (
                session.query(ABTestMetrics)
                .filter(ABTestMetrics.test_id == test_id)
                .all()
            )

            df = pd.DataFrame(
                [
                    {
                        "model_version": m.model_version,
                        "metric_name": m.metric_name,
                        "metric_value": m.metric_value,
                    }
                    for m in metrics
                ]
            )

            if df.empty:
                return {"error": "No metrics found"}

            results = {}
            logged_versions = df["model_version"].unique()
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

            for metric in df["metric_name"].unique():
                metric_df = df[df["metric_name"] == metric]
                avg_metrics = metric_df.groupby("model_version")["metric_value"].mean()

                prod_val = avg_metrics.get(prod_version, None)
                shadow_val = avg_metrics.get(shadow_version, None)

                lower_is_better_keywords = {
                    "rmse",
                    "mae",
                    "mse",
                    "loss",
                    "error_rate",
                    "latency",
                    "error",
                }
                higher_is_better = not any(
                    k in metric.lower() for k in lower_is_better_keywords
                )

                results[metric] = {
                    "production": prod_val,
                    "shadow": shadow_val,
                    "improvement": self.calculate_improvement(
                        prod_val if prod_val is not None else 0.0,
                        shadow_val if shadow_val is not None else 0.0,
                        higher_is_better=higher_is_better,
                    ),
                }

            comparable_metrics = [
                values
                for values in results.values()
                if values.get("production") is not None
                and values.get("shadow") is not None
                and pd.notna(values.get("production"))
                and pd.notna(values.get("shadow"))
                and math.isfinite(values.get("production"))
                and math.isfinite(values.get("shadow"))
            ]

            if not comparable_metrics:
                has_shadow_data = any(
                    values.get("shadow") is not None
                    and pd.notna(values.get("shadow"))
                    and math.isfinite(values.get("shadow"))
                    for values in results.values()
                )
                if has_shadow_data:
                    # Shadow metrics exist but none are comparable to production —
                    # report a non-comparable evaluation rather than an error so
                    # rollback handling can distinguish it from missing data.
                    return {
                        "test_id": test_id,
                        "results": results,
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
                "shadow_better": is_better,
                "should_rollback": has_comparison and not is_better,
                "has_comparison": has_comparison,
                "timestamp": datetime.now(timezone.utc)
                .replace(tzinfo=None)
                .isoformat(),
            }
        finally:
            session.close()

    def calculate_improvement(
        self, prod_value: float, shadow_value: float, higher_is_better: bool = True
    ) -> float:
        """Calculate percentage improvement taking metric direction into account."""
        if prod_value == 0:
            if shadow_value == 0:
                return 0.0
            diff = shadow_value - prod_value
            pct = diff * 100.0
            return pct if higher_is_better else -pct

        diff = shadow_value - prod_value
        pct = (diff / abs(prod_value)) * 100.0
        return pct if higher_is_better else -pct

    def is_shadow_better(self, results: dict) -> bool:
        """Determine if shadow model outperforms production based on metric direction and threshold."""
        better_count = 0
        total_metrics = 0
        lower_is_better_keywords = {
            "rmse",
            "mae",
            "mse",
            "loss",
            "error_rate",
            "latency",
            "error",
        }

        for metric, values in results.items():
            prod = values.get("production")
            shadow = values.get("shadow")
            if (
                prod is None
                or shadow is None
                or not pd.notna(prod)
                or not pd.notna(shadow)
            ):
                continue

            total_metrics += 1
            metric_lower = metric.lower()
            is_lower_better = any(k in metric_lower for k in lower_is_better_keywords)

            if is_lower_better:
                if shadow < prod * self.threshold:
                    better_count += 1
            else:
                if shadow > prod * self.threshold:
                    better_count += 1

        return better_count > (total_metrics / 2) if total_metrics > 0 else False

    def get_active_test(self) -> dict | None:
        """Only durable, active, paired experiments are eligible for routing."""
        return self.ledger.active()

    def get_production_version(self) -> str:
        return get_active_generation(DEMAND_MODEL_NAME) or "production"

    def mark_test_terminal(self, test_id: str, status: str) -> dict:
        """Terminal status is authoritative and cannot be reopened by late metrics."""
        return self.ledger.terminal(test_id, status)

    def trigger_rollback(self, test_id: str) -> dict[str, Any]:
        """Auto-rollback to previous version if shadow model underperforms"""
        state = self.ledger.read(test_id)
        if state and state["status"] in {"rolled_back", "rollback_failed"}:
            return {
                "action": "none",
                "test_id": test_id,
                "reason": "Experiment is terminal",
                "status": state["status"],
                "timestamp": datetime.now(timezone.utc)
                .replace(tzinfo=None)
                .isoformat(),
            }
        evaluation = self.evaluate_test(test_id)

        if evaluation.get("error"):
            return {
                "action": "none",
                "test_id": test_id,
                "reason": evaluation["error"],
                "timestamp": datetime.now(timezone.utc)
                .replace(tzinfo=None)
                .isoformat(),
            }

        if not evaluation.get("has_comparison", False):
            return {
                "action": "insufficient_metrics",
                "test_id": test_id,
                "reason": "Production and shadow metrics are not comparable",
                "timestamp": datetime.now(timezone.utc)
                .replace(tzinfo=None)
                .isoformat(),
            }

        if evaluation.get("should_rollback", False):
            restored = restore_previous_model(DEMAND_MODEL_NAME)
            if restored:
                reset_model_cache()

            self.mark_test_terminal(
                test_id, "rolled_back" if restored else "rollback_failed"
            )

            logger.warning(
                "Demand forecast rollback %s for test %s",
                "completed" if restored else "failed",
                test_id,
            )

            return {
                "action": "rollback" if restored else "rollback_failed",
                "test_id": test_id,
                "reason": "Shadow model underperformed",
                "rolled_back": restored,
                "production_version": self.get_production_version(),
                "timestamp": datetime.now(timezone.utc)
                .replace(tzinfo=None)
                .isoformat(),
            }

        return {
            "action": "promote",
            "test_id": test_id,
            "reason": "Shadow model performed well",
            "timestamp": datetime.now(timezone.utc).replace(tzinfo=None).isoformat(),
        }
