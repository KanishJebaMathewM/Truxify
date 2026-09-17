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

    def _calculate_score(
        self,
        embeddings,
        current,
        neighbor,
        objectives,
        graph_data,
        node_map=None,
        edge_data=None,
    ):
        score = super()._calculate_score(
            embeddings,
            current,
            neighbor,
            objectives,
            graph_data,
            node_map,
            edge_data,
        )
        if score < 0:
            raise ValueError(f"Negative route edge score is not allowed: {score}")
        return score


_models.GraphNetworkBuilder = GraphNetworkBuilder
_models.RouteOptimizer = RouteOptimizer
