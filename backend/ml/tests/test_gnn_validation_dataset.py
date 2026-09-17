import pytest
import torch
import torch.nn as nn


torch_geometric = pytest.importorskip("torch_geometric")
from torch_geometric.data import Data

from gnn.models import RouteOptimizer


class TinyTrainModel(nn.Module):
    """Small trainable model used to isolate RouteOptimizer training behavior."""

    def __init__(self):
        super().__init__()
        self.weight = nn.Parameter(torch.tensor(1.0))

    def forward(self, x, edge_index, edge_attr=None, batch=None):
        return self.weight.expand(x.size(0))


def make_data(target):
    return Data(
        x=torch.ones(2, 1),
        edge_index=torch.empty((2, 0), dtype=torch.long),
        edge_attr=torch.empty((0, 5)),
        batch=torch.zeros(2, dtype=torch.long),
        y=torch.full((2,), target, dtype=torch.float),
    )


def test_training_evaluates_validation_data_each_epoch():
    optimizer = RouteOptimizer()
    optimizer.model = TinyTrainModel().to(optimizer.device)

    train_data = [make_data(0.0)]
    val_data = [make_data(10.0)]

    train_loss = optimizer.train(train_data, val_data=val_data, epochs=2)

    assert isinstance(train_loss, float)
    assert len(optimizer.validation_history) == 2
    assert all(entry["validation_loss"] is not None for entry in optimizer.validation_history)
    assert optimizer.last_validation_loss == optimizer.validation_history[-1]["validation_loss"]
    assert optimizer.last_validation_loss > optimizer.validation_history[-1]["train_loss"]
    assert optimizer.model.training is True


def test_validation_metric_is_not_reported_without_validation_data():
    optimizer = RouteOptimizer()
    optimizer.model = TinyTrainModel().to(optimizer.device)

    optimizer.train([make_data(0.0)], val_data=None, epochs=1)

    assert len(optimizer.validation_history) == 1
    assert optimizer.validation_history[0]["validation_loss"] is None
    assert optimizer.last_validation_loss is None
