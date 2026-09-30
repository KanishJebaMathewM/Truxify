import logging
import warnings
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import networkx as nx
import numpy as np
import pandas as pd
from causalnex.structure.notears import from_pandas
from dowhy import CausalModel
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import LinearRegression
from sklearn.preprocessing import StandardScaler

warnings.filterwarnings("ignore")

logger = logging.getLogger(__name__)


class CausalDiscovery:
    """Discover causal relationships from logistics data."""

    def __init__(self):
        self.structure_model = None
        self.inference_engine = None
        self.causal_graph = nx.DiGraph()

        logger.info("Causal Discovery initialized")

    def discover_causal_graph(
        self,
        data: pd.DataFrame,
        method: str = "notears",
    ) -> nx.DiGraph:
        """Discover causal graph from data."""
        try:
            if data.empty:
                logger.warning("Cannot discover causal graph from empty data")
                self.causal_graph = nx.DiGraph()
                return self.causal_graph

            if method == "notears":
                self.structure_model = from_pandas(
                    data,
                    tabu_edges=[],
                    max_iter=100,
                )
                self.causal_graph = self.structure_model.to_nx()

            elif method == "pc":
                from causalnex.structure import PC

                pc = PC()
                self.structure_model = pc.learn(data)
                self.causal_graph = self.structure_model.to_nx()

            else:
                raise ValueError(
                    f"Unsupported causal discovery method: {method}"
                )

            logger.info(
                "Causal graph discovered with %d nodes and %d edges",
                len(self.causal_graph.nodes),
                len(self.causal_graph.edges),
            )

            return self.causal_graph

        except Exception as e:
            logger.error("Causal discovery failed: %s", e)
            self.causal_graph = nx.DiGraph()
            return self.causal_graph

    def identify_causes(self, target_variable: str) -> List[str]:
        """Identify direct causes of target variable."""
        if target_variable not in self.causal_graph:
            return []

        return list(self.causal_graph.predecessors(target_variable))

    def identify_effects(self, source_variable: str) -> List[str]:
        """Identify direct effects of source variable."""
        if source_variable not in self.causal_graph:
            return []

        return list(self.causal_graph.successors(source_variable))

    def get_causal_paths(
        self,
        source: str,
        target: str,
    ) -> List[List[str]]:
        """Find all causal paths from source to target."""
        if source not in self.causal_graph or target not in self.causal_graph:
            return []

        try:
            return list(
                nx.all_simple_paths(
                    self.causal_graph,
                    source,
                    target,
                )
            )
        except nx.NetworkXNoPath:
            return []

    def calculate_effect_strength(
        self,
        source: str,
        target: str,
    ) -> float:
        """Calculate causal effect strength."""
        if self.structure_model is None:
            return 0.0

        try:
            return float(
                self.structure_model.get_edge_strength(
                    source,
                    target,
                )
            )
        except Exception as e:
            logger.warning(
                "Could not calculate effect strength for %s -> %s: %s",
                source,
                target,
                e,
            )
            return 0.0


class DoCalculus:
    """Do-calculus for intervention analysis."""

    def __init__(self):
        self.causal_model: Optional[CausalModel] = None
        self.do_results: Dict[str, Any] = {}

        logger.info("Do-Calculus initialized")

    def set_causal_model(
        self,
        data: pd.DataFrame,
        treatments: List[str],
        outcomes: List[str],
    ) -> None:
        """Set up causal model for do-calculus."""

        if data.empty:
            raise ValueError("Cannot create causal model from empty data")

        if not treatments:
            raise ValueError("At least one treatment is required")

        if not outcomes:
            raise ValueError("At least one outcome is required")

        missing_treatments = [
            treatment
            for treatment in treatments
            if treatment not in data.columns
        ]

        missing_outcomes = [
            outcome
            for outcome in outcomes
            if outcome not in data.columns
        ]

        if missing_treatments:
            raise ValueError(
                f"Treatment columns not found: {missing_treatments}"
            )

        if missing_outcomes:
            raise ValueError(
                f"Outcome columns not found: {missing_outcomes}"
            )

        graph = self._build_graph(
            treatments,
            outcomes,
            data,
        )

        self.causal_model = CausalModel(
            data=data,
            treatment=treatments,
            outcome=outcomes,
            graph=graph,
        )

        logger.info("Causal model set")

    def _build_graph(
        self,
        treatments: List[str],
        outcomes: List[str],
        data: pd.DataFrame,
    ) -> str:
        """
        Build graph structure using the real dataframe column names.

        Every non-treatment/non-outcome column is treated as a potential
        common cause of treatments and outcomes.
        """

        treatment_set = set(treatments)
        outcome_set = set(outcomes)

        confounders = [
            column
            for column in data.columns
            if column not in treatment_set
            and column not in outcome_set
        ]

        lines = []

        for treatment in treatments:
            for outcome in outcomes:
                lines.append(
                    f"    {treatment} -> {outcome};"
                )

        for confounder in confounders:
            for treatment in treatments:
                lines.append(
                    f"    {confounder} -> {treatment};"
                )

            for outcome in outcomes:
                lines.append(
                    f"    {confounder} -> {outcome};"
                )

        return "digraph {\n" + "\n".join(lines) + "\n}"

    def estimate_ate(
        self,
        treatment: str,
        outcome: str,
    ) -> Optional[Dict[str, Any]]:
        """
        Estimate the Average Treatment Effect (ATE) using
        backdoor propensity score weighting.
        """

        if self.causal_model is None:
            logger.error("Causal model has not been initialized")
            return None

        try:
            identified_estimand = self.causal_model.identify_effect()

            estimate = self.causal_model.estimate_effect(
                identified_estimand,
                method_name="backdoor.propensity_score_weighting",
            )

            effect_value = float(estimate.value)

            if abs(effect_value) > 0.5:
                effect_size = "large"
            elif abs(effect_value) > 0.2:
                effect_size = "medium"
            else:
                effect_size = "small"

            confidence_interval = None

            if hasattr(
                estimate,
                "get_confidence_intervals",
            ):
                try:
                    confidence_interval = (
                        estimate.get_confidence_intervals()
                    )
                except Exception:
                    confidence_interval = None

            result = {
                "treatment": treatment,
                "outcome": outcome,
                "ate": effect_value,
                "effect_size": effect_size,
                "confidence_interval": confidence_interval,
                "method": "backdoor.propensity_score_weighting",
            }

            self.do_results[
                f"{treatment}->{outcome}"
            ] = result

            return result

        except Exception as e:
            logger.error(
                "ATE estimation failed for %s -> %s: %s",
                treatment,
                outcome,
                e,
            )
            return None

    def estimate_cate(
        self,
        treatment: str,
        outcome: str,
        features: List[str],
    ) -> Optional[Dict[str, Any]]:
        """
        Estimate a population-level ATE.

        The current DoWhy configuration does not produce a true
        Conditional Average Treatment Effect (CATE). The supplied
        features are retained for API compatibility.
        """

        if self.causal_model is None:
            logger.error("Causal model has not been initialized")
            return None

        try:
            identified_estimand = self.causal_model.identify_effect()

            estimate = self.causal_model.estimate_effect(
                identified_estimand,
                method_name="backdoor.propensity_score_weighting",
                target_units="ate",
            )

            return {
                "treatment": treatment,
                "outcome": outcome,
                "ate": float(estimate.value),
                "features": features,
            }

        except Exception as e:
            logger.error(
                "ATE estimation failed for %s -> %s: %s",
                treatment,
                outcome,
                e,
            )
            return None

    def estimate_ite(
        self,
        treatment: str,
        outcome: str,
    ) -> Optional[Dict[str, Any]]:
        """
        Estimate the Average Treatment Effect on the Treated (ATT).

        target_units="att" produces an aggregate ATT rather than
        individual treatment effects.
        """

        if self.causal_model is None:
            logger.error("Causal model has not been initialized")
            return None

        try:
            identified_estimand = self.causal_model.identify_effect()

            estimate = self.causal_model.estimate_effect(
                identified_estimand,
                method_name="backdoor.propensity_score_weighting",
                target_units="att",
            )

            return {
                "treatment": treatment,
                "outcome": outcome,
                "att": float(estimate.value),
            }

        except Exception as e:
            logger.error(
                "ATT estimation failed for %s -> %s: %s",
                treatment,
                outcome,
                e,
            )
            return None


class CausalImpact:
    """Measure causal impact of interventions."""

    def __init__(self):
        self.impact_results: Dict[str, Any] = {}

        logger.info("Causal Impact initialized")

    def measure_impact(
        self,
        pre_data: np.ndarray,
        post_data: np.ndarray,
        intervention_point: int,
    ) -> Optional[Dict[str, Any]]:
        """Measure impact of an intervention."""

        if pre_data is None or post_data is None:
            raise ValueError("Pre and post data are required")

        pre_data = np.asarray(pre_data)
        post_data = np.asarray(post_data)

        if pre_data.size == 0:
            raise ValueError("pre_data cannot be empty")

        if post_data.size == 0:
            raise ValueError("post_data cannot be empty")

        data = np.concatenate(
            [
                pre_data,
                post_data,
            ]
        )

        series = pd.DataFrame(
            {
                "value": data,
            }
        )

        if (
            intervention_point < 0
            or intervention_point >= len(data)
        ):
            raise ValueError(
                f"intervention_point {intervention_point} is outside "
                f"the combined pre/post series of length {len(data)}"
            )

        if intervention_point == 0:
            raise ValueError(
                "intervention_point must leave at least one "
                "pre-intervention observation"
            )

        if intervention_point >= len(data) - 1:
            raise ValueError(
                "intervention_point must leave at least one "
                "post-intervention observation"
            )

        try:
            pre_period = [
                0,
                intervention_point - 1,
            ]

            post_period = [
                intervention_point,
                len(data) - 1,
            ]

            from causalimpact import CausalImpact

            impact = CausalImpact(
                series,
                pre_period,
                post_period,
            )

            impact.run()

            summary = impact.summary()
            report = impact.report()

            result = {
                "absolute_effect": summary.get(
                    "absolute_effect",
                    0,
                ),
                "relative_effect": summary.get(
                    "relative_effect",
                    0,
                ),
                "p_value": summary.get(
                    "p_value",
                    1.0,
                ),
                "confidence_interval": summary.get(
                    "confidence_interval",
                    [0, 0],
                ),
                "summary": summary,
                "report": report,
            }

            self.impact_results[
                str(intervention_point)
            ] = result

            return result

        except Exception as e:
            logger.error(
                "Causal impact measurement failed: %s",
                e,
            )
            return None

    def calculate_lift(
        self,
        pre: float,
        post: float,
    ) -> Dict[str, Any]:
        """Calculate lift from intervention."""

        lift = (
            ((post - pre) / pre) * 100
            if pre != 0
            else 0
        )

        return {
            "pre_value": pre,
            "post_value": post,
            "lift_percentage": lift,
            "improvement": (
                "positive"
                if lift > 0
                else "negative"
                if lift < 0
                else "neutral"
            ),
        }


class BottleneckAnalyzer:
    """Root cause analysis for logistics bottlenecks."""

    def __init__(self):
        self.bottlenecks: List[Dict[str, Any]] = []
        self.root_causes: Dict[str, List[Dict[str, Any]]] = {}

        logger.info("Bottleneck Analyzer initialized")

    def identify_bottlenecks(
        self,
        data: pd.DataFrame,
        metrics: List[str],
    ) -> List[Dict[str, Any]]:
        """Identify bottlenecks in logistics operations."""

        bottlenecks = []

        if data.empty:
            self.bottlenecks = []
            return []

        for metric in metrics:
            if metric not in data.columns:
                continue

            threshold = data[metric].quantile(0.75)

            high_values = data[
                data[metric] > threshold
            ]

            if len(high_values) > 0:
                bottlenecks.append(
                    {
                        "metric": metric,
                        "threshold": threshold,
                        "count": len(high_values),
                        "percentage": (
                            len(high_values)
                            / len(data)
                        ) * 100,
                        "average_value": high_values[
                            metric
                        ].mean(),
                        "max_value": high_values[
                            metric
                        ].max(),
                    }
                )

        self.bottlenecks = bottlenecks

        return bottlenecks

    def find_root_causes(
        self,
        bottleneck: Dict[str, Any],
        causal_graph: nx.DiGraph,
    ) -> List[Dict[str, Any]]:
        """Find root causes of a bottleneck."""

        root_causes = []

        target = bottleneck.get("metric")

        if target is None:
            logger.warning(
                "Cannot find root causes: "
                "bottleneck has no 'metric' value"
            )
            return []

        if target not in causal_graph:
            self.root_causes[target] = []
            return []

        ancestors = nx.ancestors(
            causal_graph,
            target,
        )

        direct_causes = set(
            causal_graph.predecessors(target)
        )

        for ancestor in ancestors:
            try:
                path_length = len(
                    nx.shortest_path(
                        causal_graph,
                        ancestor,
                        target,
                    )
                ) - 1
            except nx.NetworkXNoPath:
                path_length = 0

            root_causes.append(
                {
                    "cause": ancestor,
                    "type": (
                        "direct"
                        if ancestor in direct_causes
                        else "indirect"
                    ),
                    "path_length": path_length,
                }
            )

        self.root_causes[target] = root_causes

        return root_causes

    def generate_recommendations(
        self,
        root_causes: List[Dict[str, Any]],
    ) -> List[str]:
        """Generate recommendations based on root causes."""

        recommendations = []

        for cause in root_causes:
            if cause["type"] == "direct":
                recommendations.append(
                    f"Address direct cause: {cause['cause']}"
                )
            else:
                recommendations.append(
                    f"Consider indirect cause: "
                    f"{cause['cause']} "
                    f"(path length: {cause['path_length']})"
                )

        return recommendations


class CausalInferenceService:
    """Main Causal Inference Service."""

    def __init__(self):
        self.causal_discovery = CausalDiscovery()
        self.do_calculus = DoCalculus()
        self.causal_impact = CausalImpact()
        self.bottleneck_analyzer = BottleneckAnalyzer()

        logger.info(
            "Causal Inference Service initialized"
        )

    def analyze_logistics_data(
        self,
        data: pd.DataFrame,
        target_metric: str,
    ) -> Dict[str, Any]:
        """Complete causal analysis of logistics data."""

        try:
            if data.empty:
                raise ValueError(
                    "Cannot analyze empty logistics data"
                )

            if target_metric not in data.columns:
                raise ValueError(
                    f"Target metric '{target_metric}' "
                    "not found in data"
                )

            # Step 1: Discover causal graph
            causal_graph = (
                self.causal_discovery
                .discover_causal_graph(data)
            )

            # Step 2: Identify causes
            causes = (
                self.causal_discovery
                .identify_causes(target_metric)
            )

            # Step 3: Set up causal model
            if causes:
                self.do_calculus.set_causal_model(
                    data,
                    causes,
                    [target_metric],
                )

            # Step 4: Estimate treatment effects
            ate_results = []

            for cause in causes:
                if cause == target_metric:
                    continue

                ate = self.do_calculus.estimate_ate(
                    cause,
                    target_metric,
                )

                if ate is not None:
                    ate_results.append(ate)

            # Step 5: Identify bottlenecks
            bottlenecks = (
                self.bottleneck_analyzer
                .identify_bottlenecks(
                    data,
                    [target_metric],
                )
            )

            # Step 6: Find root causes
            root_causes = []

            for bottleneck in bottlenecks:
                causes_for_bottleneck = (
                    self.bottleneck_analyzer
                    .find_root_causes(
                        bottleneck,
                        causal_graph,
                    )
                )

                root_causes.extend(
                    causes_for_bottleneck
                )

            # Step 7: Generate recommendations
            recommendations = (
                self.bottleneck_analyzer
                .generate_recommendations(
                    root_causes,
                )
            )

            return {
                "success": True,
                "causal_graph": {
                    "nodes": list(
                        causal_graph.nodes()
                    ),
                    "edges": list(
                        causal_graph.edges()
                    ),
                    "edges_count": len(
                        causal_graph.edges()
                    ),
                },
                "causes": causes,
                "treatment_effects": ate_results,
                "bottlenecks": bottlenecks,
                "root_causes": root_causes,
                "recommendations": recommendations,
                "timestamp": datetime.now().isoformat(),
            }

        except Exception as e:
            logger.error(
                "Analysis failed: %s",
                e,
            )

            return {
                "success": False,
                "error": str(e),
            }
