from . import models as _models

_BaseRouteOptimizer = _models.RouteOptimizer


class RouteOptimizer(_BaseRouteOptimizer):
    """Keep route metrics consistent with the active graph."""

    def real_time_update(
        self,
        current_route,
        new_traffic_data,
        graph_data=None,
        objectives=None,
        constraints=None,
    ):
        if graph_data is not None and hasattr(graph_data, "graph"):
            graph = graph_data.graph
            valid_edge_ids = {f"{source}-{target}" for source, target in graph.edges}
            if not graph.is_directed():
                valid_edge_ids.update(f"{target}-{source}" for source, target in graph.edges)
            new_traffic_data = {
                edge_id: update
                for edge_id, update in new_traffic_data.items()
                if edge_id in valid_edge_ids
            }

        return super().real_time_update(
            current_route,
            new_traffic_data,
            graph_data=graph_data,
            objectives=objectives,
            constraints=constraints,
        )


_models.RouteOptimizer = RouteOptimizer
