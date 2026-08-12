import pytest

torch_geometric = pytest.importorskip("torch_geometric")
import torch
from torch_geometric.data import Data
from gat.model import SpatialTemporalGAT, GATTrainer, TrafficGraphBuilder
from routes.gat_routes import in_features as route_in_features

class TestGATModel:
    def test_gat_init(self):
        model = SpatialTemporalGAT(
            in_features=5,
            hidden_features=8,
            out_features=4,
            num_heads=2,
            num_layers=2,
            time_steps=1,
            prediction_horizon=2,
        )
        assert model is not None
        assert hasattr(model, 'forward')

class TestGATTrainInputShapes:
    def test_trainer_handles_2d_node_features(self):
        """Regression guard for #10146: GATTrainer.train_step must reshape the
        builder's 2-D (N, F) node features to the 4-D tensor the model forward
        unpacks, and accept targets shaped (batch, nodes, horizon)."""
        model = SpatialTemporalGAT(
            in_features=5,
            hidden_features=8,
            out_features=4,
            num_heads=2,
            num_layers=2,
            time_steps=1,
            prediction_horizon=2,
        )
        trainer = GATTrainer(model)
        data = Data(
            x=torch.randn(4, 5),
            edge_index=torch.tensor(
                [[0, 1, 1, 2, 2, 3], [1, 0, 2, 1, 3, 2]],
                dtype=torch.long,
            ),
        )
        targets = torch.randn(1, 4, 2)
        loss = trainer.train_step(data, targets)
        assert isinstance(loss, float)

    def test_route_in_features_matches_builder(self):
        """The builder emits 5 node features (traffic, speed, road_type, lat,
        lng); the route must construct the model with in_features=5 so the first
        GATConv layer matches the feature matrix."""
        probe = TrafficGraphBuilder()
        probe.build_graph(
            [
                {"id": 0, "lat": 19.0, "lng": 72.0},
                {"id": 1, "lat": 19.1, "lng": 72.1},
            ],
            [{"source": 0, "target": 1, "distance": 5.0}],
        )
        data = probe.get_pytorch_data()
        assert data.x.shape[1] == route_in_features
