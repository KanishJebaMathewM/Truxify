import pytest
import torch

torch_geometric = pytest.importorskip("torch_geometric")
from gnn.models import RouteGNN, GNNRouteModel, GraphNetworkBuilder, RouteOptimizer

class TestGNNModel:
    """Test suite for GNN route model initialization and forward operations."""

    def test_route_gnn_init(self):
        """Verify backward-compatible RouteGNN initialization with channel aliases."""
        model = RouteGNN(in_channels=10, hidden_channels=32, out_channels=2)
        assert model is not None
        assert hasattr(model, 'forward')

    def test_forward_with_edge_attributes(self):
        """Verify GNNRouteModel forward pass consumes edge attributes."""
        model = GNNRouteModel(input_dim=9, hidden_dim=16, output_dim=8, edge_dim=5)
        model.eval()
        x = torch.randn(4, 9)
        edge_index = torch.tensor([[0, 1, 2, 3], [1, 2, 3, 0]], dtype=torch.long)
        edge_attr = torch.randn(4, 5)

        out = model(x, edge_index, edge_attr=edge_attr)
        assert out is not None

class TestRouteOptimizer:
    """Test suite for constrained route optimization algorithms."""

    @pytest.fixture
    def sample_network(self):
        """Build sample road network with multi-attribute edges and constraints."""
        builder = GraphNetworkBuilder()
        nodes = [
            {'id': 'A', 'lat': 12.97, 'lng': 77.59, 'traffic': 20, 'road_type': 'highway', 'speed_limit': 80},
            {'id': 'B', 'lat': 12.98, 'lng': 77.60, 'traffic': 30, 'road_type': 'arterial', 'speed_limit': 60},
            {'id': 'C', 'lat': 12.99, 'lng': 77.61, 'traffic': 10, 'road_type': 'highway', 'speed_limit': 80},
            {'id': 'D_isolated', 'lat': 13.50, 'lng': 78.00, 'traffic': 0, 'road_type': 'local', 'speed_limit': 40}
        ]
        edges = [
            {'source': 'A', 'target': 'B', 'distance': 10.0, 'time': 15.0, 'cost': 100.0, 'fuel': 5.0, 'congestion': 0.2, 'hazmat_allowed': True, 'max_weight': 40.0},
            {'source': 'B', 'target': 'C', 'distance': 15.0, 'time': 20.0, 'cost': 150.0, 'fuel': 7.0, 'congestion': 0.1, 'hazmat_allowed': True, 'max_weight': 40.0},
            # Alternate direct edge with hazmat restriction
            {'source': 'A', 'target': 'C', 'distance': 22.0, 'time': 25.0, 'cost': 300.0, 'fuel': 10.0, 'congestion': 0.5, 'hazmat_allowed': False, 'max_weight': 20.0}
        ]
        builder.build_road_network(nodes, edges)
        graph_data = builder.get_pytorch_data()
        return builder, graph_data

    def test_optimize_route_success(self, sample_network):
        """Verify successful constrained pathfinding returns valid metrics and reached destination."""
        _, graph_data = sample_network
        optimizer = RouteOptimizer()
        result = optimizer.optimize_route('A', 'C', graph_data)

        assert result is not None
        assert result.get('success') is True
        assert len(result['route']) > 0
        assert result['route'][0]['from'] == 'A'
        assert result['route'][-1]['to'] == 'C'
        assert result['total_distance'] > 0
        assert result['total_time'] > 0

    def test_optimize_route_zero_hop(self, sample_network):
        """Verify start == end produces a successful zero-hop route with 1 node visited."""
        _, graph_data = sample_network
        optimizer = RouteOptimizer()
        result = optimizer.optimize_route('A', 'A', graph_data)

        assert result is not None
        assert result.get('success') is True
        assert result['route'] == []
        assert result['nodes_visited'] == 1
        assert result['total_distance'] == 0
        assert result['total_time'] == 0

    def test_optimize_route_disconnected_returns_none(self, sample_network):
        """Verify unreachable / disconnected destination returns None instead of partial route."""
        _, graph_data = sample_network
        optimizer = RouteOptimizer()
        result = optimizer.optimize_route('A', 'D_isolated', graph_data)
        assert result is None

    def test_optimize_route_missing_node(self, sample_network):
        """Verify non-existent nodes cleanly return None."""
        _, graph_data = sample_network
        optimizer = RouteOptimizer()
        result = optimizer.optimize_route('A', 'NON_EXISTENT_NODE', graph_data)
        assert result is None

    def test_optimize_route_hazmat_constraint(self, sample_network):
        """Verify hazmat constraint bypasses restricted direct edge and selects compliant path."""
        _, graph_data = sample_network
        optimizer = RouteOptimizer()

        result = optimizer.optimize_route('A', 'C', graph_data, constraints={'hazmat': True})
        assert result is not None
        assert result['success'] is True
        assert result['route'][-1]['to'] == 'C'
        hops = [(r['from'], r['to']) for r in result['route']]
        assert ('A', 'B') in hops
        assert ('B', 'C') in hops

    def test_optimize_route_weight_constraint(self, sample_network):
        """Verify excessive truck weight exceeding all route limits returns None."""
        _, graph_data = sample_network
        optimizer = RouteOptimizer()

        result = optimizer.optimize_route('A', 'C', graph_data, constraints={'truck_weight': 50.0})
        assert result is None

    def test_optimize_route_hos_time_constraint(self, sample_network):
        """Verify HOS time limit rejects paths that exceed maximum allowed time."""
        _, graph_data = sample_network
        optimizer = RouteOptimizer()

        result = optimizer.optimize_route('A', 'C', graph_data, constraints={'hos_limit': 10.0})
        assert result is None

    def test_optimize_route_hos_finds_feasible_alternate_path(self):
        """Verify HOS search pruning discovers feasible alternate path when primary path is too slow."""
        builder = GraphNetworkBuilder()
        nodes = [
            {'id': 'S', 'lat': 10.0, 'lng': 20.0, 'traffic': 0, 'road_type': 'highway', 'speed_limit': 80},
            {'id': 'M1', 'lat': 10.1, 'lng': 20.1, 'traffic': 0, 'road_type': 'highway', 'speed_limit': 80},
            {'id': 'M2', 'lat': 10.2, 'lng': 20.2, 'traffic': 0, 'road_type': 'highway', 'speed_limit': 80},
            {'id': 'E', 'lat': 10.3, 'lng': 20.3, 'traffic': 0, 'road_type': 'highway', 'speed_limit': 80}
        ]
        edges = [
            # Cheap route S -> M1 -> E: cost 10, but time 80 (violates HOS=50)
            {'source': 'S', 'target': 'M1', 'distance': 40.0, 'time': 40.0, 'cost': 5.0, 'fuel': 2.0},
            {'source': 'M1', 'target': 'E', 'distance': 40.0, 'time': 40.0, 'cost': 5.0, 'fuel': 2.0},
            # Faster route S -> M2 -> E: cost 50, but time 30 (satisfies HOS=50)
            {'source': 'S', 'target': 'M2', 'distance': 15.0, 'time': 15.0, 'cost': 25.0, 'fuel': 5.0},
            {'source': 'M2', 'target': 'E', 'distance': 15.0, 'time': 15.0, 'cost': 25.0, 'fuel': 5.0},
        ]
        builder.build_road_network(nodes, edges)
        graph_data = builder.get_pytorch_data()

        optimizer = RouteOptimizer()
        result = optimizer.optimize_route('S', 'E', graph_data, objectives=['cost'], constraints={'hos_limit': 50.0})
        assert result is not None
        assert result['success'] is True
        assert result['route'][-1]['to'] == 'E'
        assert result['total_time'] <= 50.0
        # Selected the faster M2 alternate
        hops = [(r['from'], r['to']) for r in result['route']]
        assert ('S', 'M2') in hops
        assert ('M2', 'E') in hops

    def test_optimize_route_height_constraint(self):
        """Verify truck height exceeding low clearance bypasses restricted edge and selects compliant route."""
        builder = GraphNetworkBuilder()
        nodes = [
            {'id': 'S', 'lat': 10.0, 'lng': 20.0, 'traffic': 0, 'road_type': 'highway', 'speed_limit': 80},
            {'id': 'M', 'lat': 10.1, 'lng': 20.1, 'traffic': 0, 'road_type': 'arterial', 'speed_limit': 60},
            {'id': 'E', 'lat': 10.2, 'lng': 20.2, 'traffic': 0, 'road_type': 'highway', 'speed_limit': 80}
        ]
        edges = [
            # Direct route S -> E with low clearance underpass (3.5m), faster and cheaper
            {'source': 'S', 'target': 'E', 'distance': 10.0, 'time': 10.0, 'cost': 50.0, 'fuel': 3.0, 'max_height': 3.5},
            # Longer alternate route S -> M -> E with standard clearance (4.5m)
            {'source': 'S', 'target': 'M', 'distance': 15.0, 'time': 15.0, 'cost': 80.0, 'fuel': 5.0, 'max_height': 4.5},
            {'source': 'M', 'target': 'E', 'distance': 15.0, 'time': 15.0, 'cost': 80.0, 'fuel': 5.0, 'max_height': 4.5},
        ]
        builder.build_road_network(nodes, edges)
        graph_data = builder.get_pytorch_data()

        optimizer = RouteOptimizer()

        # Truck with height 4.0m exceeds direct route clearance (3.5m) and must take alternate S -> M -> E (4.5m)
        result = optimizer.optimize_route('S', 'E', graph_data, constraints={'truck_height': 4.0})
        assert result is not None
        assert result['success'] is True
        assert result['route'][-1]['to'] == 'E'
        hops = [(r['from'], r['to']) for r in result['route']]
        assert ('S', 'M') in hops
        assert ('M', 'E') in hops
        assert ('S', 'E') not in hops

        # Oversized truck with height 5.0m exceeds all road clearances (max 4.5m) -> returns None
        result_oversized = optimizer.optimize_route('S', 'E', graph_data, constraints={'truck_height': 5.0})
        assert result_oversized is None

    def test_multi_objective_optimization(self, sample_network):
        """Verify Pareto multi-objective selection finds optimal balanced route."""
        _, graph_data = sample_network
        optimizer = RouteOptimizer()
        result = optimizer.multi_objective_optimization('A', 'C', graph_data)
        assert result is not None
        assert result['success'] is True
        assert result['route'][-1]['to'] == 'C'

    def test_multi_objective_optimization_unreachable(self, sample_network):
        """Verify multi-objective optimization returns None for unreachable targets."""
        _, graph_data = sample_network
        optimizer = RouteOptimizer()
        result = optimizer.multi_objective_optimization('A', 'D_isolated', graph_data)
        assert result is None

