from . import models as _models


_BaseGraphNetworkBuilder = _models.GraphNetworkBuilder
_BaseRouteOptimizer = _models.RouteOptimizer
_EDGE_METRICS = ("distance", "time", "cost", "fuel", "congestion")


class GraphNetworkBuilder(_BaseGraphNetworkBuilder):
    """Validate routing metrics before mutating the road graph."""

    def build_road_network(self, nodes, edges):
        for edge in edges:
            for metric in _EDGE_METRICS:
                value = edge.get(metric, 0)
                if value is None:
                    continue
                try:
                    numeric_value = float(value)
                except (TypeError, ValueError) as exc:
                    raise ValueError(
                        f"Edge metric '{metric}' must be numeric; got {value!r}"
                    ) from exc
                if numeric_value < 0:
                    raise ValueError(
                        f"Negative edge metric '{metric}' is not allowed: {value!r}"
                    )
        return super().build_road_network(nodes, edges)


class RouteOptimizer(_BaseRouteOptimizer):
    """Reject negative route scores instead of masking them with a clamp."""

    def _calculate_score(self, embeddings, current, neighbor, objectives, graph_data, node_map=None):
        score = 0.0
        edge_data = graph_data.graph[current][neighbor]
        weights = {
            "time": 1.0,
            "cost": 0.5,
            "fuel": 0.3,
            "distance": 0.2,
            "congestion": 2.0,
        }
        for objective in objectives:
            if objective in edge_data:
                score += weights.get(objective, 1.0) * float(edge_data[objective])
        node_map = node_map if node_map is not None else getattr(graph_data, "node_map", None)
        if embeddings is not None and node_map and current in node_map and neighbor in node_map:
            try:
                import numpy as np
                score += 0.1 * float(
                    np.linalg.norm(
                        embeddings[node_map[current]] - embeddings[node_map[neighbor]]
                    )
                )
            except Exception:
                pass
        if score < 0:
            raise ValueError(f"Negative route edge score is not allowed: {score}")
        return score


_models.GraphNetworkBuilder = GraphNetworkBuilder
_models.RouteOptimizer = RouteOptimizer
