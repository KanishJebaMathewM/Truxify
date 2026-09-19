import heapq

from . import models as _models

_BaseRouteOptimizer = _models.RouteOptimizer
_ORIGINAL_FIND_OPTIMAL_ROUTE = _BaseRouteOptimizer._find_optimal_route


def _constrained_find_optimal_route(
    self,
    start,
    end,
    embeddings,
    graph_data,
    objectives,
    constraints=None,
):
    """Find a route while preserving nondominated score/time labels."""
    constraints = constraints or {}
    max_time = constraints.get("max_time")
    if max_time is None:
        max_time = constraints.get("hos_limit")
    if max_time is None:
        return _ORIGINAL_FIND_OPTIMAL_ROUTE(
            self, start, end, embeddings, graph_data, objectives, constraints
        )

    if not hasattr(graph_data, "graph"):
        return None
    graph = graph_data.graph
    if start not in graph or end not in graph:
        return None
    if start == end:
        return []

    node_map = getattr(graph_data, "node_map", None)

    def weight_func(current, neighbor, edge_attrs):
        """Return the weighted edge score, or None when hard constraints reject it."""
        if constraints.get("hazmat", False) and not edge_attrs.get("hazmat_allowed", True):
            return None

        truck_weight = constraints.get("truck_weight") or constraints.get("weight")
        max_weight = edge_attrs.get("max_weight") or edge_attrs.get("weight_limit")
        if truck_weight is not None and max_weight is not None and truck_weight > max_weight:
            return None

        truck_height = constraints.get("truck_height") or constraints.get("height")
        max_height = edge_attrs.get("max_height") or edge_attrs.get("height_limit")
        if truck_height is not None and max_height is not None and truck_height > max_height:
            return None

        return self._calculate_score(
            embeddings,
            current,
            neighbor,
            objectives,
            graph_data,
            node_map,
        )

    def dominates(existing, candidate):
        """Return whether an existing label dominates the candidate label."""
        existing_score, existing_time, existing_path = existing
        candidate_score, candidate_time, candidate_path = candidate
        if existing_score > candidate_score or existing_time > candidate_time:
            return False
        return set(existing_path).issubset(candidate_path)

    def path_to_route(path):
        """Convert a node path into the route edge records returned by callers."""
        route = []
        for current, neighbor in zip(path, path[1:]):
            edge_data = graph[current][neighbor]
            route.append(
                {
                    "from": current,
                    "to": neighbor,
                    "distance": edge_data.get("distance", 0),
                    "time": edge_data.get("time", 0),
                    "cost": edge_data.get("cost", 0),
                    "fuel": edge_data.get("fuel", 0),
                    "congestion": edge_data.get("congestion", 0),
                }
            )
        return route

    labels = {start: [(0.0, 0.0, (start,))]}
    queue = [(0.0, 0.0, 0, start, (start,))]
    counter = 1

    while queue:
        current_score, current_time, _, current, current_path = heapq.heappop(queue)
        current_label = (current_score, current_time, current_path)

        stored_labels = labels.get(current, [])
        if any(
            label != current_label and dominates(label, current_label)
            for label in stored_labels
        ):
            continue

        if current == end:
            return path_to_route(current_path)

        for neighbor in graph.neighbors(current):
            if neighbor in current_path:
                continue

            edge_attrs = graph[current][neighbor]
            edge_weight = weight_func(current, neighbor, edge_attrs)
            if edge_weight is None:
                continue

            edge_time = float(edge_attrs.get("time", 0))
            new_time = current_time + edge_time
            if new_time > max_time:
                continue

            new_score = current_score + edge_weight
            new_path = current_path + (neighbor,)
            new_label = (new_score, new_time, new_path)

            neighbor_labels = labels.setdefault(neighbor, [])
            if any(dominates(label, new_label) for label in neighbor_labels):
                continue

            neighbor_labels[:] = [
                label for label in neighbor_labels if not dominates(new_label, label)
            ]
            neighbor_labels.append(new_label)

            heapq.heappush(
                queue,
                (new_score, new_time, counter, neighbor, new_path),
            )
            counter += 1

    return None


_BaseRouteOptimizer._find_optimal_route = _constrained_find_optimal_route
_models.RouteOptimizer = _BaseRouteOptimizer
