from math import isfinite

from . import models as _models


_DEFAULT_OBJECTIVE_WEIGHTS = {
    "time": 1.0,
    "cost": 0.5,
    "fuel": 0.3,
    "distance": 0.2,
    "congestion": 2.0,
}


def _objective_scales(self, graph_data, objectives):
    """Return graph-local metric scales so weighting is unit-invariant."""
    cache = getattr(graph_data, "_objective_normalization_scales", {})
    key = tuple(objectives)
    if key in cache:
        return cache[key]

    scales = {}
    graph = getattr(graph_data, "graph", None)
    for objective in objectives:
        maximum = 0.0
        if graph is not None:
            for _, _, edge_data in graph.edges(data=True):
                value = edge_data.get(objective, 0.0)
                try:
                    numeric_value = float(value)
                except (TypeError, ValueError):
                    continue
                if isfinite(numeric_value):
                    maximum = max(maximum, abs(numeric_value))
        scales[objective] = maximum if maximum > 0.0 else 1.0

    cache[key] = scales
    graph_data._objective_normalization_scales = cache
    return scales


def _calculate_score(
    self,
    embeddings,
    current,
    neighbor,
    objectives,
    graph_data,
    node_map=None,
):
    """Calculate a dimensionless route score from normalized edge objectives."""
    score = 0.0
    edge_data = graph_data.graph[current][neighbor]
    scales = self._objective_scales(graph_data, objectives)

    for objective in objectives:
        if objective not in edge_data:
            continue
        try:
            value = float(edge_data[objective])
        except (TypeError, ValueError):
            continue
        if not isfinite(value):
            continue
        normalized_value = value / scales[objective]
        score += _DEFAULT_OBJECTIVE_WEIGHTS.get(objective, 1.0) * normalized_value

    if node_map is None:
        node_map = getattr(graph_data, "node_map", None)

    if embeddings is not None and node_map and current in node_map and neighbor in node_map:
        try:
            import numpy as np

            emb_c = embeddings[node_map[current]]
            emb_n = embeddings[node_map[neighbor]]
            emb_dist = float(np.linalg.norm(emb_c - emb_n))
            score += 0.1 * emb_dist
        except Exception:
            pass

    return max(score, 1e-6)


_models.RouteOptimizer._objective_scales = _objective_scales
_models.RouteOptimizer._calculate_score = _calculate_score
