import math

from . import models as _models

_BaseGraphNetworkBuilder = _models.GraphNetworkBuilder
_BaseRouteOptimizer = _models.RouteOptimizer
_EDGE_METRICS = getattr(
    _models,
    "EDGE_METRICS",
    ("distance", "time", "cost", "fuel", "congestion"),
)
_TRAFFIC_METRICS = ("time", "cost", "fuel", "congestion")


def _validate_edge_metrics(edge):
    for metric in _EDGE_METRICS:
        value = edge.get(metric, 0)
        if value is None:
            continue
        numeric_value = float(value)
        if not math.isfinite(numeric_value):
            raise ValueError(
                f"Non-finite edge metric '{metric}' is not allowed: {value!r}"
            )
        if numeric_value < 0:
            raise ValueError(
                f"Negative edge metric '{metric}' is not allowed: {value!r}"
            )


class GraphNetworkBuilder(_BaseGraphNetworkBuilder):
    """Reject invalid edge metrics before they enter the road graph."""

    def build_road_network(self, nodes, edges):
        for edge in edges:
            _validate_edge_metrics(edge)
        return super().build_road_network(nodes, edges)


class RouteOptimizer(_BaseRouteOptimizer):
    """Reject non-finite traffic values and invalid negative route scores."""

    def real_time_update(
        self,
        current_route,
        new_traffic_data,
        graph_data=None,
        objectives=None,
        constraints=None,
    ):
        for update in new_traffic_data.values():
            if not isinstance(update, dict):
                continue
            for field in _TRAFFIC_METRICS:
                value = update.get(field)
                if value is None:
                    continue
                numeric_value = float(value)
                if not math.isfinite(numeric_value):
                    raise ValueError(
                        f"Non-finite traffic metric '{field}' is not allowed: {value!r}"
                    )

        return super().real_time_update(
            current_route,
            new_traffic_data,
            graph_data=graph_data,
            objectives=objectives,
            constraints=constraints,
        )

    def _calculate_score(
        self,
        embeddings,
        current,
        neighbor,
        objectives,
        graph_data,
        node_map=None,
    ):
        score = super()._calculate_score(
            embeddings,
            current,
            neighbor,
            objectives,
            graph_data,
            node_map,
        )
        if score < 0:
            raise ValueError(f"Negative route edge score is not allowed: {score}")
        return score


_models.GraphNetworkBuilder = GraphNetworkBuilder
_models.RouteOptimizer = RouteOptimizer
