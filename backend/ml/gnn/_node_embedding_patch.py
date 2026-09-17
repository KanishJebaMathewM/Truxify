import torch
import torch.nn.functional as F
from torch_geometric.nn import global_mean_pool

from . import models as _models


_ORIGINAL_ROUTE_OPTIMIZER_TRAIN = _models.RouteOptimizer.train


def _encode_node_embeddings(self, x, edge_index, edge_attr=None):
    """Return the shared per-node representation used by route inference."""
    x = self.conv1(x, edge_index)
    x = F.relu(x)
    x = self.bn1(x)
    x = self.dropout(x)

    if getattr(self, "edge_dim", None) is not None:
        if edge_attr is None:
            edge_attr = torch.zeros(
                (edge_index.size(1), self.edge_dim),
                dtype=torch.float,
                device=x.device,
            )
        x = self.conv2(x, edge_index, edge_attr=edge_attr)
    else:
        x = self.conv2(x, edge_index)

    x = F.relu(x)
    x = self.bn2(x)
    x = self.dropout(x)
    x = self.conv3(x, edge_index)
    x = F.relu(x)
    return self.dropout(x)


def _forward(self, x, edge_index, edge_attr=None, batch=None):
    """Use node embeddings for serving and graph predictions for training."""
    node_embeddings = self.encode_node_embeddings(x, edge_index, edge_attr)
    if batch is None:
        return node_embeddings

    x = global_mean_pool(node_embeddings, batch)
    x = self.lin1(x)
    x = F.relu(x)
    x = self.dropout(x)
    x = self.lin2(x)
    return x.squeeze()


def _train(self, train_data, val_data=None, epochs=100):
    """Ensure each unbatched training sample has an explicit graph batch."""
    prepared_data = []
    for data in train_data:
        if getattr(data, "batch", None) is None:
            data = data.clone()
            data.batch = torch.zeros(data.x.size(0), dtype=torch.long)
        prepared_data.append(data)
    return _ORIGINAL_ROUTE_OPTIMIZER_TRAIN(self, prepared_data, val_data, epochs)


_models.GNNRouteModel.encode_node_embeddings = _encode_node_embeddings
_models.GNNRouteModel.forward = _forward
_models.RouteOptimizer.train = _train
