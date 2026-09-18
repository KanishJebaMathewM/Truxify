import torch
import pytest
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from backend.ml.gnn.models import FeatureScaler, RouteOptimizer, GraphNetworkBuilder

def test_feature_scaler_preserves_categorical():
    scaler = FeatureScaler()
    node_features = torch.tensor([
        [1.0, 2.0, 3.0, 1.0, 0.0, 0.0, 0.0, 0.0, 4.0],
        [5.0, 6.0, 7.0, 0.0, 1.0, 0.0, 0.0, 0.0, 8.0]
    ])
    edge_features = torch.tensor([
        [1.0, 2.0, 3.0, 4.0, 5.0],
        [6.0, 7.0, 8.0, 9.0, 10.0]
    ])
    scaler.fit(node_features, edge_features)
    out_node, out_edge = scaler.transform(node_features, edge_features)
    
    # Categoricals are indices 3, 4, 5, 6, 7
    assert torch.allclose(out_node[:, 3:8], node_features[:, 3:8])

def test_feature_scaler_distribution():
    scaler = FeatureScaler()
    node_features = torch.rand((100, 9)) * 100
    edge_features = torch.rand((200, 5)) * 50
    
    scaler.fit(node_features, edge_features)
    out_node, out_edge = scaler.transform(node_features, edge_features)
    
    # Mean should be close to 0, std to 1
    node_cont = out_node[:, scaler.node_cont_indices]
    edge_cont = out_edge[:, scaler.edge_cont_indices]
    
    assert torch.allclose(node_cont.mean(dim=0), torch.zeros(4), atol=1e-5)
    assert torch.allclose(node_cont.std(dim=0, unbiased=True), torch.ones(4), atol=1e-4)

    assert torch.allclose(edge_cont.mean(dim=0), torch.zeros(5), atol=1e-5)
    assert torch.allclose(edge_cont.std(dim=0, unbiased=True), torch.ones(5), atol=1e-4)

def test_scaling_checkpoint_restoration(tmp_path):
    opt = RouteOptimizer(allow_untrained=True)
    scaler = opt.model.scaler
    node_features = torch.rand((10, 9))
    edge_features = torch.rand((10, 5))
    scaler.fit(node_features, edge_features)
    
    model_path = tmp_path / "model.pth"
    opt.save_model(model_path)
    
    opt2 = RouteOptimizer(model_path=model_path)
    scaler2 = opt2.model.scaler
    
    assert scaler2.is_fitted.item() == True
    assert torch.allclose(scaler.node_mean, scaler2.node_mean)
    assert torch.allclose(scaler.node_std, scaler2.node_std)
    assert torch.allclose(scaler.edge_mean, scaler2.edge_mean)
    assert torch.allclose(scaler.edge_std, scaler2.edge_std)
