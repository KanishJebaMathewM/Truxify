from . import models as _models

_BaseRouteOptimizer = _models.RouteOptimizer


class RouteOptimizer(_BaseRouteOptimizer):
    """Only reroute when a live update affects an edge on the active route."""

    def real_time_update(
        self,
        current_route,
        new_traffic_data,
        graph_data=None,
        objectives=None,
        constraints=None,
    ):
        if not current_route:
            return current_route

        active_edge_ids = {
            f"{edge.get('from')}-{edge.get('to')}"
            for edge in current_route
            if edge.get("from") is not None and edge.get("to") is not None
        }
        relevant_updates = {
            edge_id: update
            for edge_id, update in new_traffic_data.items()
            if edge_id in active_edge_ids
        }

        return super().real_time_update(
            current_route,
            relevant_updates,
            graph_data=graph_data,
            objectives=objectives,
            constraints=constraints,
        )


_models.RouteOptimizer = RouteOptimizer
