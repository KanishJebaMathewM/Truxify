from . import models as _models

_BaseRouteOptimizer = _models.RouteOptimizer


class RouteOptimizer(_BaseRouteOptimizer):
    """Preserve exact source-to-target identity for directed live-traffic updates."""

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
        if graph_data is None or not hasattr(graph_data, 'graph'):
            logger = getattr(_models, 'logger', None)
            if logger:
                logger.warning(
                    "Real-time rerouting requires graph_data; returning the updated current route"
                )
            updated_route = [dict(edge) for edge in current_route]
            self._apply_traffic_to_route(updated_route, new_traffic_data)
            return updated_route

        graph = graph_data.graph.copy()
        edge_lookup = {f"{u}-{v}": (u, v) for u, v in graph.edges}
        changed = False
        updated_route = [dict(edge) for edge in current_route]

        for edge_id, update in new_traffic_data.items():
            if not isinstance(update, dict):
                continue
            endpoints = edge_lookup.get(edge_id)
            if endpoints is None:
                continue
            u, v = endpoints
            edge_attrs = graph[u][v]
            for field in ('time', 'cost', 'fuel', 'congestion'):
                if field in update and update[field] is not None:
                    value = float(update[field])
                    if edge_attrs.get(field) != value:
                        edge_attrs[field] = value
                        changed = True

        self._apply_traffic_to_route(updated_route, new_traffic_data)
        if not changed:
            return updated_route

        builder = _models.GraphNetworkBuilder()
        nodes = [
            {
                'id': node_id,
                'lat': attrs.get('lat', 0),
                'lng': attrs.get('lng', 0),
                'traffic': attrs.get('traffic', 0),
                'road_type': attrs.get('road_type', 'local'),
                'speed_limit': attrs.get('speed_limit', 50),
            }
            for node_id, attrs in graph.nodes(data=True)
        ]
        edges = [
            {
                'source': u,
                'target': v,
                'distance': attrs.get('distance', 0),
                'time': attrs.get('time', 0),
                'cost': attrs.get('cost', 0),
                'fuel': attrs.get('fuel', 0),
                'congestion': attrs.get('congestion', 0),
                'hazmat_allowed': attrs.get('hazmat_allowed', True),
                'max_weight': attrs.get('max_weight'),
                'max_height': attrs.get('max_height'),
            }
            for u, v, attrs in graph.edges(data=True)
        ]
        builder.build_road_network(nodes, edges)
        updated_graph_data = builder.get_pytorch_data()

        start = current_route[0].get('from')
        end = current_route[-1].get('to')
        if start is None or end is None:
            return updated_route

        rerouted = self._reoptimize(
            start,
            end,
            updated_graph_data,
            objectives or ['time', 'cost', 'fuel'],
            constraints,
        )
        return rerouted if rerouted is not None else updated_route


_models.RouteOptimizer = RouteOptimizer
