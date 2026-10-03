import pytest

torch_geometric = pytest.importorskip("torch_geometric")
from gnn.models import GraphNetworkBuilder, RouteOptimizer


def _build_frontier_graph():
    builder = GraphNetworkBuilder()
    nodes = [
        {'id': 'S', 'lat': 10.0, 'lng': 20.0},
        {'id': 'M', 'lat': 10.1, 'lng': 20.1},
        {'id': 'E', 'lat': 10.2, 'lng': 20.2},
    ]
    edges = [
        {
            'source': 'S',
            'target': 'E',
            'distance': 10.0,
            'time': 10.0,
            'cost': 100.0,
            'fuel': 10.0,
        },
        {
            'source': 'S',
            'target': 'M',
            'distance': 8.0,
            'time': 15.0,
            'cost': 40.0,
            'fuel': 7.0,
        },
        {
            'source': 'M',
            'target': 'E',
            'distance': 8.0,
            'time': 15.0,
            'cost': 40.0,
            'fuel': 7.0,
        },
    ]
    builder.build_road_network(nodes, edges)
    return builder.get_pytorch_data()


class TestParetoFrontier:
    """Regression coverage for multi-objective route frontier calculation."""

    def test_returns_all_nondominated_routes(self):
        graph_data = _build_frontier_graph()
        optimizer = RouteOptimizer()

        result = optimizer.multi_objective_optimization('S', 'E', graph_data)

        assert result is not None
        assert result['success'] is True
        assert result['pareto_count'] == 2

        frontier = result['pareto_routes']
        route_metrics = {
            (
                route['total_time'],
                route['total_cost'],
                route['total_fuel'],
            )
            for route in frontier
        }

        assert route_metrics == {
            (10.0, 100.0, 10.0),
            (30.0, 80.0, 14.0),
        }

    def test_representative_route_comes_from_frontier(self):
        graph_data = _build_frontier_graph()
        optimizer = RouteOptimizer()

        result = optimizer.multi_objective_optimization('S', 'E', graph_data)

        frontier_paths = {
            tuple((edge['from'], edge['to']) for edge in route['route'])
            for route in result['pareto_routes']
        }
        selected_path = tuple((edge['from'], edge['to']) for edge in result['route'])

        assert selected_path in frontier_paths

    def test_zero_hop_route_has_single_frontier_member(self):
        graph_data = _build_frontier_graph()
        optimizer = RouteOptimizer()

        result = optimizer.multi_objective_optimization('S', 'S', graph_data)

        assert result is not None
        assert result['success'] is True
        assert result['route'] == []
        assert result['pareto_count'] == 1
        assert result['pareto_routes'][0]['route'] == []

    def test_frontier_respects_hard_time_constraint(self):
        graph_data = _build_frontier_graph()
        optimizer = RouteOptimizer()

        result = optimizer.multi_objective_optimization(
            'S',
            'E',
            graph_data,
            constraints={'max_time': 20.0},
        )

        assert result is not None
        assert result['pareto_count'] == 1
        assert result['pareto_routes'][0]['total_time'] == 10.0
