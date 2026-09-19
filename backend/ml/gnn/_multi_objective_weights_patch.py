from . import models as _models
from routes import gnn_routes as _gnn_routes


DEFAULT_MULTI_OBJECTIVE_WEIGHTS = {
    "time": 0.5,
    "cost": 0.3,
    "fuel": 0.2,
    "distance": 0.2,
    "congestion": 2.0,
}


def _multi_objective_optimization(self, start, end, graph_data, constraints=None):
    objectives = ["time", "cost", "fuel"]
    frontier = self._find_pareto_routes(
        start,
        end,
        graph_data,
        objectives,
        constraints,
    )
    if not frontier:
        return None

    best_route = min(
        frontier,
        key=lambda candidate: sum(
            DEFAULT_MULTI_OBJECTIVE_WEIGHTS[objective]
            * candidate[f"total_{objective}"]
            for objective in objectives
        ),
    )
    result = dict(best_route)
    result["pareto_routes"] = frontier
    result["pareto_count"] = len(frontier)
    return result


def _route_multi_objective_optimization(
    start,
    end,
    graph_data,
    objectives=None,
    constraints=None,
):
    requested_objectives = list(objectives) if objectives else ["time", "cost", "fuel"]
    allowed_objectives = set(DEFAULT_MULTI_OBJECTIVE_WEIGHTS)
    invalid_objectives = [
        objective for objective in requested_objectives
        if objective not in allowed_objectives
    ]
    if invalid_objectives:
        raise ValueError(
            f"Unsupported objectives: {', '.join(invalid_objectives)}"
        )

    frontier = _gnn_routes.optimizer._find_pareto_routes(
        start,
        end,
        graph_data,
        requested_objectives,
        constraints,
    )
    if not frontier:
        return None

    best_route = min(
        frontier,
        key=lambda candidate: sum(
            DEFAULT_MULTI_OBJECTIVE_WEIGHTS.get(objective, 1.0)
            * candidate.get(f"total_{objective}", 0)
            for objective in requested_objectives
        ),
    )

    result = dict(best_route)
    result["pareto_routes"] = frontier
    result["pareto_count"] = len(frontier)
    return result


_models.DEFAULT_MULTI_OBJECTIVE_WEIGHTS = DEFAULT_MULTI_OBJECTIVE_WEIGHTS
_models.RouteOptimizer.multi_objective_optimization = _multi_objective_optimization
_gnn_routes.DEFAULT_MULTI_OBJECTIVE_WEIGHTS = DEFAULT_MULTI_OBJECTIVE_WEIGHTS
_gnn_routes._multi_objective_optimization = _route_multi_objective_optimization
