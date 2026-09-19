import heapq
import os
import time

from . import models as _models
from routes import gnn_routes as _gnn_routes


def _positive_env_int(name, default):
    try:
        value = int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default
    return max(1, value)


DEFAULT_PARETO_MAX_LABELS_PER_NODE = _positive_env_int("GNN_PARETO_MAX_LABELS_PER_NODE", 256)
DEFAULT_PARETO_MAX_LABELS = _positive_env_int("GNN_PARETO_MAX_LABELS", 10000)
DEFAULT_PARETO_MAX_EXPANSIONS = _positive_env_int("GNN_PARETO_MAX_EXPANSIONS", 50000)
DEFAULT_PARETO_MAX_SECONDS = max(0.001, float(os.getenv("GNN_PARETO_MAX_SECONDS", "30")))


class ParetoSearchLimitExceeded(RuntimeError):
    """Raised when exact Pareto search exceeds its configured resource budget."""


def get_pareto_metrics(self):
    return dict(getattr(self, "_last_pareto_metrics", {}))


def _find_pareto_routes(self, start, end, graph_data, objectives, constraints=None):
    constraints = dict(constraints or {})
    metrics = {
        "labels_expanded": 0,
        "labels_pruned": 0,
        "labels_stored": 1,
        "frontier_size": 0,
        "search_time_seconds": 0.0,
    }
    started = time.monotonic()

    max_labels_per_node = DEFAULT_PARETO_MAX_LABELS_PER_NODE
    max_labels = DEFAULT_PARETO_MAX_LABELS
    max_expansions = DEFAULT_PARETO_MAX_EXPANSIONS
    max_seconds = DEFAULT_PARETO_MAX_SECONDS

    for key, configured in (
        ("max_pareto_labels_per_node", "node"),
        ("max_pareto_labels", "total"),
        ("max_pareto_expansions", "expansions"),
    ):
        requested = constraints.get(key)
        if requested is None:
            continue
        try:
            requested = max(1, int(requested))
        except (TypeError, ValueError):
            continue
        if configured == "node":
            max_labels_per_node = min(max_labels_per_node, requested)
        elif configured == "total":
            max_labels = min(max_labels, requested)
        else:
            max_expansions = min(max_expansions, requested)

    requested_seconds = constraints.get("max_pareto_seconds")
    if requested_seconds is not None:
        try:
            max_seconds = min(max_seconds, max(0.001, float(requested_seconds)))
        except (TypeError, ValueError):
            pass

    metrics.update({
        "max_labels_per_node": max_labels_per_node,
        "max_labels": max_labels,
        "max_expansions": max_expansions,
        "max_seconds": max_seconds,
    })

    try:
        if not hasattr(graph_data, "graph"):
            return []
        if start not in graph_data.graph or end not in graph_data.graph:
            return []
        if start == end:
            metrics["frontier_size"] = 1
            return [self._build_route_result([])]

        labels = {start: [((0.0,) * len(objectives), 0.0, (start,))]}
        queue = [(tuple(0.0 for _ in objectives), 0.0, (start,))]

        while queue:
            if metrics["labels_expanded"] >= max_expansions:
                raise ParetoSearchLimitExceeded(
                    f"Pareto search expansion limit exceeded ({max_expansions})"
                )
            if time.monotonic() - started > max_seconds:
                raise ParetoSearchLimitExceeded(
                    f"Pareto search time budget exceeded ({max_seconds:.3f}s)"
                )

            current_values, current_time, current_path = heapq.heappop(queue)
            metrics["labels_expanded"] += 1
            current_node = current_path[-1]
            if current_node == end:
                continue

            for neighbor in graph_data.graph.neighbors(current_node):
                if neighbor in current_path:
                    continue

                edge_data = graph_data.graph[current_node][neighbor]
                if not self._edge_is_feasible(edge_data, constraints):
                    continue

                edge_time = float(edge_data.get("time", 0))
                new_time = current_time + edge_time
                max_time = constraints.get("max_time")
                if max_time is None:
                    max_time = constraints.get("hos_limit")
                if max_time is not None and new_time > max_time:
                    continue

                new_values = tuple(
                    current_values[index] + float(edge_data.get(objective, 0))
                    for index, objective in enumerate(objectives)
                )
                new_path = current_path + (neighbor,)
                new_label = (new_values, new_time, new_path)

                existing_labels = labels.setdefault(neighbor, [])
                candidate_result = self._route_result_for_path(new_path, graph_data)

                dominated = False
                survivors = []
                for existing_values, existing_time, existing_path in existing_labels:
                    existing_result = self._route_result_for_path(existing_path, graph_data)
                    if self._pareto_dominates(existing_result, candidate_result, objectives):
                        dominated = True
                        survivors.append((existing_values, existing_time, existing_path))
                        continue
                    if self._pareto_dominates(candidate_result, existing_result, objectives):
                        metrics["labels_pruned"] += 1
                        continue
                    survivors.append((existing_values, existing_time, existing_path))

                if dominated:
                    metrics["labels_pruned"] += 1
                    labels[neighbor] = survivors
                    continue

                removed = len(existing_labels) - len(survivors)
                metrics["labels_stored"] -= removed
                if len(survivors) + 1 > max_labels_per_node:
                    raise ParetoSearchLimitExceeded(
                        f"Pareto label limit exceeded for node '{neighbor}' ({max_labels_per_node} labels)"
                    )
                if metrics["labels_stored"] + 1 > max_labels:
                    raise ParetoSearchLimitExceeded(
                        f"Pareto label budget exceeded ({max_labels} labels)"
                    )

                survivors.append(new_label)
                labels[neighbor] = survivors
                metrics["labels_stored"] += 1
                heapq.heappush(queue, new_label)

        destination_labels = labels.get(end, [])
        candidates = [
            self._route_result_for_path(path, graph_data)
            for _, _, path in destination_labels
        ]
        frontier = self._pareto_frontier(candidates, objectives)
        metrics["frontier_size"] = len(frontier)
        return frontier
    finally:
        metrics["search_time_seconds"] = time.monotonic() - started
        self._last_pareto_metrics = dict(metrics)


def multi_objective_optimization(self, start, end, graph_data, constraints=None):
    objectives = ["time", "cost", "fuel"]
    frontier = self._find_pareto_routes(start, end, graph_data, objectives, constraints)
    if not frontier:
        return None
    weights = {"time": 0.5, "cost": 0.3, "fuel": 0.2}
    best_route = min(
        frontier,
        key=lambda candidate: sum(
            weights[objective] * candidate[f"total_{objective}"]
            for objective in objectives
        ),
    )
    result = dict(best_route)
    result["pareto_routes"] = frontier
    result["pareto_count"] = len(frontier)
    result["pareto_metrics"] = self.get_pareto_metrics()
    return result


def _build_multi_objective_response(result):
    if result:
        return {
            "success": True,
            "data": result,
            "timestamp": _gnn_routes.datetime.now().isoformat(),
        }
    return {
        "success": False,
        "error": "Multi-objective route optimization failed",
        "timestamp": _gnn_routes.datetime.now().isoformat(),
    }


async def _multi_objective_optimize_with_budget(request):
    _gnn_routes.validate_route_objectives(request.objectives)
    try:
        graph = _gnn_routes.builder.build_road_network(
            [node.dict() for node in request.nodes],
            [edge.dict() for edge in request.edges],
        )
        graph_data = _gnn_routes.builder.get_pytorch_data()
        result = _gnn_routes._multi_objective_optimization(
            request.start_node,
            request.end_node,
            graph_data,
            objectives=request.objectives,
            constraints=request.constraints,
        )
        return _build_multi_objective_response(result)
    except ParetoSearchLimitExceeded as exc:
        _gnn_routes.logger.warning(f"Pareto search budget exceeded: {exc}")
        raise _gnn_routes.HTTPException(
            status_code=503,
            detail=(
                "Multi-objective route optimization exceeded its resource budget: "
                f"{exc}"
            ),
        )
    except _gnn_routes.HTTPException:
        raise
    except Exception as exc:
        _gnn_routes.logger.error(f"Multi-objective optimization failed: {exc}")
        _gnn_routes.logger.error(f"Internal error: {exc}")
        raise _gnn_routes.HTTPException(status_code=500, detail="Internal server error")


_models.ParetoSearchLimitExceeded = ParetoSearchLimitExceeded
_models.RouteOptimizer.get_pareto_metrics = get_pareto_metrics
_models.RouteOptimizer._find_pareto_routes = _find_pareto_routes
_models.RouteOptimizer.multi_objective_optimization = multi_objective_optimization
_gnn_routes.ParetoSearchLimitExceeded = ParetoSearchLimitExceeded
_gnn_routes.multi_objective_optimize = _multi_objective_optimize_with_budget

for route in _gnn_routes.router.routes:
    if (
        getattr(route, "path", None) == "/gnn/multi-objective"
        and "POST" in getattr(route, "methods", set())
    ):
        route.endpoint = _multi_objective_optimize_with_budget
        break
