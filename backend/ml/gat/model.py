import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np
from typing import Dict, List, Tuple, Optional
from torch_geometric.nn import GATConv, global_mean_pool
from torch_geometric.data import Data, DataLoader
import networkx as nx
import logging

logger = logging.getLogger(__name__)

class GraphAttentionLayer(nn.Module):
    """Graph Attention Layer"""
    
    def __init__(self, in_features: int, out_features: int, num_heads: int = 8, dropout: float = 0.1):
        super().__init__()
        self.num_heads = num_heads
        self.out_features = out_features
        
        # Multi-head attention
        self.attentions = nn.ModuleList([
            GATConv(in_features, out_features // num_heads, heads=1, dropout=dropout)
            for _ in range(num_heads)
        ])
        
        self.dropout = nn.Dropout(dropout)
        
    def forward(self, x: torch.Tensor, edge_index: torch.Tensor) -> torch.Tensor:
        # Apply each attention head
        attention_outputs = []
        for attention in self.attentions:
            attn_out = attention(x, edge_index)
            attention_outputs.append(attn_out)
        
        # Concatenate outputs from all heads
        x = torch.cat(attention_outputs, dim=-1)
        x = self.dropout(x)
        
        return x

class SpatialTemporalGAT(nn.Module):
    """Spatial-Temporal Graph Attention Network for Traffic Prediction"""
    
    def __init__(
        self,
        in_features: int = 64,
        hidden_features: int = 128,
        out_features: int = 32,
        num_heads: int = 8,
        num_layers: int = 3,
        time_steps: int = 12,
        prediction_horizon: int = 6
    ):
        super().__init__()
        
        self.in_features = in_features
        self.hidden_features = hidden_features
        self.out_features = out_features
        self.num_heads = num_heads
        self.num_layers = num_layers
        self.time_steps = time_steps
        self.prediction_horizon = prediction_horizon
        
        # Spatial GAT layers
        self.spatial_layers = nn.ModuleList()
        for i in range(num_layers):
            in_dim = in_features if i == 0 else hidden_features
            out_dim = hidden_features if i < num_layers - 1 else out_features
            self.spatial_layers.append(
                GraphAttentionLayer(in_dim, out_dim, num_heads)
            )
        
        # Temporal attention
        self.temporal_attention = nn.MultiheadAttention(
            embed_dim=out_features,
            num_heads=num_heads,
            batch_first=True
        )
        
        # Temporal LSTM
        self.lstm = nn.LSTM(
            input_size=out_features,
            hidden_size=hidden_features,
            num_layers=2,
            batch_first=True,
            dropout=0.1
        )
        
        # Prediction head
        self.prediction_head = nn.Sequential(
            nn.Linear(hidden_features, hidden_features // 2),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(hidden_features // 2, prediction_horizon)
        )
        
        logger.info(f"✅ Spatial-Temporal GAT initialized with {num_layers} layers, {num_heads} heads")
    
    def forward(
        self,
        x: torch.Tensor,
        edge_index: torch.Tensor,
        time_features: Optional[torch.Tensor] = None
    ) -> torch.Tensor:
        # x shape: (batch_size, num_nodes, time_steps, features)
        batch_size, num_nodes, time_steps, features = x.shape
        
        # Reshape for spatial processing
        x = x.permute(0, 2, 1, 3).contiguous()  # (batch, time, nodes, features)
        x = x.view(batch_size * time_steps, num_nodes, features)
        
        # Spatial GAT
        for spatial_layer in self.spatial_layers:
            x = spatial_layer(x, edge_index)
            x = F.relu(x)
        
        # Reshape back
        x = x.view(batch_size, time_steps, num_nodes, -1)
        
        # Temporal attention
        x = x.permute(0, 2, 1, 3).contiguous()  # (batch, nodes, time, features)
        x = x.view(batch_size * num_nodes, time_steps, -1)
        
        # Apply temporal attention
        attn_out, _ = self.temporal_attention(x, x, x)
        x = x + attn_out  # Residual connection
        
        # LSTM for temporal modeling
        lstm_out, _ = self.lstm(x)
        
        # Prediction
        predictions = self.prediction_head(lstm_out)
        
        # Reshape to (batch, nodes, horizon)
        predictions = predictions.view(batch_size, num_nodes, self.prediction_horizon)
        
        return predictions
    
    def predict_traffic(
        self,
        node_features: torch.Tensor,
        edge_index: torch.Tensor,
        time_features: Optional[torch.Tensor] = None
    ) -> Dict:
        """Predict traffic for next time steps"""
        self.eval()
        with torch.no_grad():
            predictions = self.forward(node_features, edge_index, time_features)
            
            return {
                'predictions': predictions,
                'mean': predictions.mean(dim=1),
                'std': predictions.std(dim=1)
            }

class TrafficGraphBuilder:
    """Build traffic graph from road network"""
    
    def __init__(self):
        self.graph = nx.Graph()
        self.node_features = {}
        
        logger.info("✅ Traffic Graph Builder initialized")
    
    def build_graph(self, nodes: List[Dict], edges: List[Dict]) -> nx.Graph:
        """Build traffic graph from nodes and edges"""
        # Add nodes with features
        for node in nodes:
            self.graph.add_node(
                node['id'],
                lat=node['lat'],
                lng=node['lng'],
                traffic=node.get('traffic', 0),
                speed=node.get('speed', 50),
                road_type=node.get('road_type', 'local')
            )
        
        # Add edges
        for edge in edges:
            self.graph.add_edge(
                edge['source'],
                edge['target'],
                distance=edge['distance'],
                travel_time=edge.get('travel_time', 0),
                congestion=edge.get('congestion', 0)
            )
        
        return self.graph
    
    def get_pytorch_data(self) -> Data:
        """Convert graph to PyTorch Geometric Data"""
        # Node features
        node_features = []
        for node in self.graph.nodes(data=True):
            features = [
                node[1].get('traffic', 0) / 100,
                node[1].get('speed', 50) / 100,
                self._road_type_encoding(node[1].get('road_type', 'local')),
                node[1].get('lat', 0) / 90,
                node[1].get('lng', 0) / 180
            ]
            node_features.append(features)
        
        # Edge indices
        edge_indices = []
        for u, v in self.graph.edges():
            edge_indices.append([u, v])
            edge_indices.append([v, u])  # Undirected
        
        return Data(
            x=torch.tensor(node_features, dtype=torch.float),
            edge_index=torch.tensor(edge_indices, dtype=torch.long).t().contiguous()
        )
    
    def _road_type_encoding(self, road_type: str) -> float:
        """Encode road type"""
        types = ['highway', 'arterial', 'collector', 'local', 'street']
        if road_type in types:
            return types.index(road_type) / len(types)
        return 0

class GATTrainer:
    """Trainer for Graph Attention Network"""
    
    def __init__(
        self,
        model: SpatialTemporalGAT,
        lr: float = 1e-3,
        device: str = "cuda" if torch.cuda.is_available() else "cpu"
    ):
        self.model = model.to(device)
        self.device = device
        self.optimizer = torch.optim.Adam(model.parameters(), lr=lr)
        self.criterion = nn.MSELoss()
        
        logger.info(f"✅ GAT Trainer initialized on {self.device}")
    
    def train_step(self, data: Data, targets: torch.Tensor) -> float:
        """Single training step"""
        self.model.train()
        self.optimizer.zero_grad()
        
        # Forward pass
        data = data.to(self.device)
        predictions = self.model(data.x, data.edge_index)
        
        # Loss
        loss = self.criterion(predictions, targets.to(self.device))
        
        # Backward pass
        loss.backward()
        torch.nn.utils.clip_grad_norm_(self.model.parameters(), 1.0)
        self.optimizer.step()
        
        return loss.item()
    
    def train(
        self,
        train_data: Data,
        train_targets: torch.Tensor,
        epochs: int = 100,
        val_data: Optional[Data] = None,
        val_targets: Optional[torch.Tensor] = None
    ) -> Dict:
        """Full training loop"""
        losses = []
        val_losses = []
        
        for epoch in range(epochs):
            # Training
            loss = self.train_step(train_data, train_targets)
            losses.append(loss)
            
            # Validation
            if val_data is not None and val_targets is not None:
                val_loss = self.validate(val_data, val_targets)
                val_losses.append(val_loss)
            
            if (epoch + 1) % 10 == 0:
                if val_losses:
                    logger.info(f"Epoch {epoch+1}/{epochs}: Loss={loss:.4f}, Val Loss={val_loss:.4f}")
                else:
                    logger.info(f"Epoch {epoch+1}/{epochs}: Loss={loss:.4f}")
        
        return {
            'train_losses': losses,
            'val_losses': val_losses,
            'final_loss': losses[-1],
            'final_val_loss': val_losses[-1] if val_losses else None
        }
    
    def validate(self, data: Data, targets: torch.Tensor) -> float:
        """Validate model"""
        self.model.eval()
        with torch.no_grad():
            data = data.to(self.device)
            predictions = self.model(data.x, data.edge_index)
            loss = self.criterion(predictions, targets.to(self.device))
        return loss.item()
    
    def predict(self, data: Data) -> Dict:
        """Make predictions"""
        self.model.eval()
        with torch.no_grad():
            data = data.to(self.device)
            predictions = self.model(data.x, data.edge_index)
            
            return {
                'predictions': predictions.cpu().numpy(),
                'mean': predictions.mean(dim=1).cpu().numpy(),
                'std': predictions.std(dim=1).cpu().numpy()
            }
    
    def save(self, path: str = "models/gat_traffic.pth"):
        """Save model"""
        torch.save({
            'model_state_dict': self.model.state_dict(),
            'optimizer_state_dict': self.optimizer.state_dict()
        }, path)
        logger.info(f"✅ Model saved to {path}")
    
    def load(self, path: str = "models/gat_traffic.pth"):
        """Load model"""
        checkpoint = torch.load(path, map_location=self.device)
        self.model.load_state_dict(checkpoint['model_state_dict'])
        self.optimizer.load_state_dict(checkpoint['optimizer_state_dict'])
        logger.info(f"✅ Model loaded from {path}")