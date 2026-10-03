from . import models as _models

_BaseRouteOptimizer = _models.RouteOptimizer


class RouteOptimizer(_BaseRouteOptimizer):
    """Keep GNN model state isolated while route inference runs."""

    def optimize_route(
        self,
        start_node,
        end_node,
        graph_data,
        objectives=['time', 'cost', 'fuel'],
        constraints=None,
    ):
        was_training = self.model.training
        self.model.eval()
        try:
            return super().optimize_route(
                start_node,
                end_node,
                graph_data,
                objectives,
                constraints,
            )
        finally:
            self.model.train(was_training)


_models.RouteOptimizer = RouteOptimizer
