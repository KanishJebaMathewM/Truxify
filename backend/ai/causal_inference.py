
import logging
from datetime import datetime
from typing import Dict, List, Optional, Any

import numpy as np
import pandas as pd
import networkx as nx

from causalnex.structure.notears import from_pandas
from dowhy import CausalModel
from causalimpact import CausalImpact as PyCausalImpact

logger = logging.getLogger(__name__)


def _validate_data(data: pd.DataFrame) -> pd.DataFrame:
    """Validate and prepare numerical data."""
    if not isinstance(data, pd.DataFrame) or data.empty:
        raise ValueError("Input must be a non-empty pandas DataFrame.")

    if data.columns.duplicated().any():
        raise ValueError("Duplicate column names are not allowed.")

    if not all(pd.api.types.is_numeric_dtype(data[c]) for c in data.columns):
        raise ValueError("All columns must contain numerical values.")

    data = data.replace([np.inf, -np.inf], np.nan).dropna()

    if len(data) < 10:
        raise ValueError("At least 10 valid observations are required.")

    if data.shape[1] < 2:
        raise ValueError("At least two variables are required.")

    return data


def measure_impact(pre_data, post_data):
    """Measure causal impact using pre- and post-intervention data."""
    pre = np.asarray(pre_data, dtype=float).reshape(-1)
    post = np.asarray(post_data, dtype=float).reshape(-1)

    if len(pre) < 2 or len(post) < 1:
        raise ValueError("Insufficient pre/post intervention data.")

    if not np.isfinite(pre).all() or not np.isfinite(post).all():
        raise ValueError("Data contains invalid numerical values.")

    full_data = np.concatenate([pre, post])

    return PyCausalImpact(
        pd.DataFrame({"value": full_data}),
        [0, len(pre) - 1],
        [len(pre), len(full_data) - 1]
    )


class CausalDiscovery:
    """Discover causal relationships from logistics data."""

    def __init__(self):
        self.structure_model = None
        self.causal_graph = nx.DiGraph()
        logger.info("Causal Discovery initialized")

    def discover_causal_graph(
        self,
        data: pd.DataFrame,
        method: str = "notears"
    ) -> nx.DiGraph:
        """Discover causal relationships using NOTEARS."""

        try:
            data = _validate_data(data)

            if method.lower() != "notears":
                raise ValueError(
                    "Only NOTEARS is supported by this implementation."
                )

            self.structure_model = from_pandas(
                data,
                tabu_edges=[],
                max_iter=100,
                w_threshold=0.1
            )

            self.causal_graph = nx.DiGraph(
                self.structure_model.to_directed()
            )

            logger.info(
                "Causal graph discovered: %s nodes, %s edges",
                self.causal_graph.number_of_nodes(),
                self.causal_graph.number_of_edges()
            )

            return self.causal_graph

        except Exception:
            logger.exception("Causal discovery failed")
            self.structure_model = None
            self.causal_graph = nx.DiGraph()
            raise

    def identify_causes(self, target_variable: str) -> List[str]:
        """Identify direct causes of a target variable."""

        if target_variable not in self.causal_graph:
            return []

        return list(self.causal_graph.predecessors(target_variable))

    def identify_effects(self, source_variable: str) -> List[str]:
        """Identify direct effects of a source variable."""

        if source_variable not in self.causal_graph:
            return []

        return list(self.causal_graph.successors(source_variable))

    def get_causal_paths(
        self,
        source: str,
        target: str
    ) -> List[List[str]]:
        """Find all simple causal paths."""

        if (
            source not in self.causal_graph
            or target not in self.causal_graph
        ):
            return []

        return list(
            nx.all_simple_paths(self.causal_graph, source, target)
        )

    def calculate_effect_strength(
        self,
        source: str,
        target: str
    ) -> float:
        """Return the learned edge weight."""

        if self.structure_model is None:
            return 0.0

        if not self.structure_model.has_edge(source, target):
            return 0.0

        return float(
            self.structure_model.get_edge_data(
                source, target
            ).get("weight", 0.0)
        )


class DoCalculus:
    """Perform causal effect estimation using DoWhy."""

    def __init__(self):
        self.causal_model = None
        self.data = None
        self.treatment = None
        self.outcome = None
        self.confounders = []

        logger.info("Do-Calculus initialized")

    def set_causal_model(
        self,
        data: pd.DataFrame,
        treatments: List[str],
        outcomes: List[str]
    ):
        """Initialize a causal model for one treatment and outcome."""

        data = _validate_data(data)

        if len(treatments) != 1 or len(outcomes) != 1:
            raise ValueError(
                "Provide exactly one treatment and one outcome."
            )

        treatment = treatments[0]
        outcome = outcomes[0]

        if treatment == outcome:
            raise ValueError("Treatment and outcome must differ.")

        if treatment not in data.columns or outcome not in data.columns:
            raise ValueError("Treatment or outcome column not found.")

        confounders = [
            col for col in data.columns
            if col not in (treatment, outcome)
        ]

        edges = [f'"{treatment}" -> "{outcome}"']

        for confounder in confounders:
            edges.append(f'"{confounder}" -> "{treatment}"')
            edges.append(f'"{confounder}" -> "{outcome}"')

        graph = "digraph {\n" + ";\n".join(edges) + ";\n}"

        self.causal_model = CausalModel(
            data=data,
            treatment=treatment,
            outcome=outcome,
            graph=graph
        )

        self.data = data
        self.treatment = treatment
        self.outcome = outcome
        self.confounders = confounders

        logger.info(
            "Causal model initialized: %s -> %s",
            treatment, outcome
        )

    def _validate_model(self, treatment, outcome):
        if self.causal_model is None:
            raise ValueError("Set the causal model first.")

        if treatment != self.treatment or outcome != self.outcome:
            raise ValueError("Requested treatment/outcome does not match model.")

    def _estimate(self, treatment, outcome, target_units="ate"):
        """Estimate an effect using linear regression adjustment."""

        self._validate_model(treatment, outcome)

        identified_estimand = self.causal_model.identify_effect()

        estimate = self.causal_model.estimate_effect(
            identified_estimand,
            method_name="backdoor.linear_regression",
            target_units=target_units
        )

        return estimate

    def estimate_ate(
        self,
        treatment: str,
        outcome: str
    ) -> Optional[Dict[str, Any]]:
        """Estimate Average Treatment Effect."""

        try:
            estimate = self._estimate(treatment, outcome, "ate")
            value = float(estimate.value)

            return {
                "treatment": treatment,
                "outcome": outcome,
                "ate": value,
                "effect_size": (
                    "large" if abs(value) > 0.5
                    else "medium" if abs(value) > 0.2
                    else "small"
                ),
                "method": "backdoor.linear_regression"
            }

        except Exception:
            logger.exception("ATE estimation failed")
            return None

    def estimate_cate(
        self,
        treatment: str,
        outcome: str,
        features: List[str]
    ) -> Optional[Dict[str, Any]]:
        """Estimate conditional effects using a Random Forest model."""

        try:
            self._validate_model(treatment, outcome)

            if not features:
                raise ValueError("At least one feature is required.")

            if not all(f in self.data.columns for f in features):
                raise ValueError("One or more features are missing.")

            if treatment in features or outcome in features:
                raise ValueError(
                    "Features must exclude treatment and outcome."
                )

            # A simple heterogeneous-effect estimator:
            # Fit separate outcome models for each treatment group.
            treatment_values = self.data[treatment].dropna().unique()

            if len(treatment_values) != 2:
                raise ValueError(
                    "This CATE implementation requires binary treatment."
                )

            group_a, group_b = sorted(treatment_values)

            models = {}

            from sklearn.ensemble import RandomForestRegressor

            for group in (group_a, group_b):
                subset = self.data[self.data[treatment] == group]

                if len(subset) < 5:
                    raise ValueError(
                        "Insufficient observations in a treatment group."
                    )

                model = RandomForestRegressor(
                    n_estimators=100,
                    random_state=42
                )

                model.fit(
                    subset[features],
                    subset[outcome]
                )

                models[group] = model

            x = self.data[features]

            prediction_a = models[group_a].predict(x)
            prediction_b = models[group_b].predict(x)

            individual_effects = prediction_b - prediction_a

            return {
                "treatment": treatment,
                "outcome": outcome,
                "features": features,
                "cate": float(np.mean(individual_effects)),
                "individual_effects": individual_effects.tolist(),
                "method": "random_forest_g_computation"
            }

        except Exception:
            logger.exception("CATE estimation failed")
            return None

    def estimate_ite(
        self,
        treatment: str,
        outcome: str
    ) -> Optional[Dict[str, Any]]:
        """Estimate aggregate ATT, not individual treatment effects."""

        try:
            estimate = self._estimate(treatment, outcome, "att")

            return {
                "treatment": treatment,
                "outcome": outcome,
                "att": float(estimate.value),
                "method": "backdoor.linear_regression"
            }

        except Exception:
            logger.exception("ATT estimation failed")
            return None


class CausalImpact:
    """Measure causal impact of interventions."""

    def __init__(self):
        self.impact_results = {}
        logger.info("Causal Impact initialized")

    def measure_impact(
        self,
        pre_data: np.ndarray,
        post_data: np.ndarray,
        intervention_point: Optional[int] = None
    ) -> Optional[Dict[str, Any]]:
        """Measure intervention impact."""

        try:
            pre = np.asarray(pre_data, dtype=float).reshape(-1)
            post = np.asarray(post_data, dtype=float).reshape(-1)

            if len(pre) < 2 or len(post) < 1:
                raise ValueError("Insufficient pre/post data.")

            if not np.isfinite(pre).all() or not np.isfinite(post).all():
                raise ValueError("Invalid values in input data.")

            data = np.concatenate([pre, post])

            expected_point = len(pre)

            if (
                intervention_point is not None
                and intervention_point != expected_point
            ):
                raise ValueError(
                    f"intervention_point must equal {expected_point} "
                    "for the supplied pre/post arrays."
                )

            impact = PyCausalImpact(
                pd.DataFrame({"value": data}),
                [0, expected_point - 1],
                [expected_point, len(data) - 1]
            )

            summary = impact.summary()

            if isinstance(summary, pd.DataFrame):
                summary_result = summary.to_dict()
            else:
                summary_result = str(summary)

            report = impact.summary(output="report")

            result = {
                "absolute_effect": None,
                "relative_effect": None,
                "p_value": None,
                "confidence_interval": None,
                "summary": summary_result,
                "report": str(report)
            }

            self.impact_results[datetime.now().isoformat()] = result

            return result

        except Exception:
            logger.exception("Causal impact measurement failed")
            return None

    def calculate_lift(
        self,
        pre: float,
        post: float
    ) -> Dict[str, Any]:
        """Calculate percentage lift."""

        if pre == 0:
            lift = None
        else:
            lift = ((post - pre) / abs(pre)) * 100

        return {
            "pre_value": pre,
            "post_value": post,
            "lift_percentage": lift,
            "improvement": (
                "positive" if lift is not None and lift > 0
                else "negative" if lift is not None and lift < 0
                else "neutral" if lift is not None
                else "undefined"
            )
        }


class BottleneckAnalyzer:
    """Root cause analysis for logistics bottlenecks."""

    def __init__(self):
        self.bottlenecks = []
        self.root_causes = {}
        logger.info("Bottleneck Analyzer initialized")

    def identify_bottlenecks(
        self,
        data: pd.DataFrame,
        metrics: List[str]
    ) -> List[Dict[str, Any]]:
        """Identify values above the 75th percentile."""

        bottlenecks = []

        if data.empty:
            return bottlenecks

        for metric in metrics:
            if metric not in data.columns:
                continue

            values = pd.to_numeric(
                data[metric], errors="coerce"
            ).dropna()

            if values.empty:
                continue

            threshold = values.quantile(0.75)
            high_values = values[values > threshold]

            if high_values.empty:
                continue

            bottlenecks.append({
                "metric": metric,
                "threshold": float(threshold),
                "count": int(len(high_values)),
                "percentage": float(
                    len(high_values) / len(values) * 100
                ),
                "average_value": float(high_values.mean()),
                "max_value": float(high_values.max())
            })

        self.bottlenecks = bottlenecks
        return bottlenecks

    def find_root_causes(
        self,
        bottleneck: Dict[str, Any],
        causal_graph: nx.DiGraph
    ) -> List[Dict[str, Any]]:
        """Find direct and indirect ancestors of a bottleneck."""

        target = bottleneck.get("metric")

        if not target or target not in causal_graph:
            return []

        direct_causes = set(causal_graph.predecessors(target))
        ancestors = nx.ancestors(causal_graph, target)

        root_causes = []

        for ancestor in ancestors:
            try:
                path_length = nx.shortest_path_length(
                    causal_graph,
                    ancestor,
                    target
                )
            except nx.NetworkXNoPath:
                continue

            root_causes.append({
                "cause": ancestor,
                "type": (
                    "direct" if ancestor in direct_causes
                    else "indirect"
                ),
                "path_length": path_length
            })

        self.root_causes[target] = root_causes

        return root_causes

    def generate_recommendations(
        self,
        root_causes: List[Dict[str, Any]]
    ) -> List[str]:
        """Generate recommendations from identified causes."""

        recommendations = []

        for cause in root_causes:
            if cause["type"] == "direct":
                recommendations.append(
                    f"Address direct cause: {cause['cause']}"
                )
            else:
                recommendations.append(
                    f"Investigate indirect cause: {cause['cause']} "
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

        logger.info("Causal Inference Service initialized")

    def analyze_logistics_data(
        self,
        data: pd.DataFrame,
        target_metric: str
    ) -> Dict[str, Any]:
        """Perform complete causal analysis."""

        try:
            data = _validate_data(data)

            if target_metric not in data.columns:
                raise ValueError(
                    f"Target metric '{target_metric}' not found."
                )

            # Step 1: Discover causal graph.
            causal_graph = (
                self.causal_discovery.discover_causal_graph(data)
            )

            # Step 2: Identify direct causes.
            causes = self.causal_discovery.identify_causes(
                target_metric
            )

            # Step 3: Estimate each treatment separately.
            ate_results = []

            for cause in causes:
                self.do_calculus.set_causal_model(
                    data,
                    [cause],
                    [target_metric]
                )

                ate = self.do_calculus.estimate_ate(
                    cause,
                    target_metric
                )

                if ate is not None:
                    ate_results.append(ate)

            # Step 4: Identify bottlenecks.
            bottlenecks = (
                self.bottleneck_analyzer.identify_bottlenecks(
                    data,
                    [target_metric]
                )
            )

            # Step 5: Identify root causes.
            root_causes = []

            for bottleneck in bottlenecks:
                root_causes.extend(
                    self.bottleneck_analyzer.find_root_causes(
                        bottleneck,
                        causal_graph
                    )
                )

            # Step 6: Generate recommendations.
            recommendations = (
                self.bottleneck_analyzer.generate_recommendations(
                    root_causes
                )
            )

            return {
                "success": True,
                "causal_graph": {
                    "nodes": list(causal_graph.nodes()),
                    "edges": list(causal_graph.edges()),
                    "edges_count": causal_graph.number_of_edges()
                },
                "causes": causes,
                "treatment_effects": ate_results,
                "bottlenecks": bottlenecks,
                "root_causes": root_causes,
                "recommendations": recommendations,
                "timestamp": datetime.now().isoformat()
            }

        except Exception as e:
            logger.exception("Causal analysis failed")

            return {
                "success": False,
                "error": str(e)
            }
