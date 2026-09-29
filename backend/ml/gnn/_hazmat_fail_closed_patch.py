from . import models as _models

_BaseGraphNetworkBuilder = _models.GraphNetworkBuilder
_BaseRouteOptimizer = _models.RouteOptimizer


class GraphNetworkBuilder(_BaseGraphNetworkBuilder):
    """Preserve unknown hazmat permissions instead of defaulting to allowed."""

    def build_road_network(self, nodes, edges):
        normalized_edges = []
        for edge in edges:
            edge_copy = dict(edge)
            if "hazmat_allowed" not in edge_copy:
                edge_copy["hazmat_allowed"] = None
            normalized_edges.append(edge_copy)
        return super().build_road_network(nodes, normalized_edges)


class RouteOptimizer(_BaseRouteOptimizer):
    """Require explicit hazmat permission when hazmat constraints are active."""

    def _edge_is_feasible(self, edge_data, constraints):
        constraints = constraints or {}
        if constraints.get("hazmat", False) and edge_data.get("hazmat_allowed") is not True:
            return False

        truck_weight = constraints.get("truck_weight") or constraints.get("weight")
        max_weight = edge_data.get("max_weight") or edge_data.get("weight_limit")
        if truck_weight is not None and max_weight is not None and truck_weight > max_weight:
            return False

        truck_height = constraints.get("truck_height") or constraints.get("height")
        max_height = edge_data.get("max_height") or edge_data.get("height_limit")
        if truck_height is not None and max_height is not None and truck_height > max_height:
            return False

        return True


_models.GraphNetworkBuilder = GraphNetworkBuilder
_models.RouteOptimizer = RouteOptimizer

try:
    from routes import gnn_routes as _gnn_routes

    if hasattr(_gnn_routes.Edge, "model_fields"):
        _gnn_routes.Edge.model_fields["hazmat_allowed"].default = None
        if hasattr(_gnn_routes.Edge, "model_rebuild"):
            _gnn_routes.Edge.model_rebuild(force=True)
    elif hasattr(_gnn_routes.Edge, "__fields__"):
        _gnn_routes.Edge.__fields__["hazmat_allowed"].default = None
        _gnn_routes.Edge.__fields__["hazmat_allowed"].required = False
except Exception:
    pass
