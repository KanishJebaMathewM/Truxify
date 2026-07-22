import torch
import torch.nn as nn
import torch.nn.functional as F
from torch_geometric.nn import GCNConv, GATConv, SAGEConv, global_mean_pool
from torch_geometric.data import Data, DataLoader
import numpy as np
import networkx as nx
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

class GNNRouteModel(nn.Module):
    """Graph Neural Network for Route Optimization"""
    
    def __init__(self, input_dim=64, hidden_dim=128, output_dim=32):
        super(GNNRouteModel, self).__init__()
        
        # Graph convolution layers
        self.conv1 = GCNConv(input_dim, hidden_dim)
        self.conv2 = GATConv(hidden_dim, hidden_dim, heads=4, concat=True)
        self.conv3 = SAGEConv(hidden_dim * 4, hidden_dim)
        
        # Attention mechanism
        self.attention = nn.MultiheadAttention(hidden_dim, num_heads=8)
        
        # Output layers
        self.lin1 = nn.Linear(hidden_dim, output_dim)
        self.lin2 = nn.Linear(output_dim, 1)
        
        # Dropout
        self.dropout = nn.Dropout(0.2)
        
        # Batch normalization
        self.bn1 = nn.BatchNorm1d(hidden_dim)
        self.bn2 = nn.BatchNorm1d(hidden_dim * 4)
        
        logger.info("✅ GNN Route Model initialized")
    
    def forward(self, x, edge_index, edge_attr=None, batch=None):
        # First GCN layer
        x = self.conv1(x, edge_index)
        x = F.relu(x)
        x = self.bn1(x)
        x = self.dropout(x)
        
        # Second GAT layer
        x = self.conv2(x, edge_index)
        x = F.relu(x)
        x = self.bn2(x)
        x = self.dropout(x)
        
        # Third SAGE layer
        x = self.conv3(x, edge_index)
        x = F.relu(x)
        x = self.dropout(x)
        
        # Global pooling
        if batch is not None:
            x = global_mean_pool(x, batch)
        
        # Output
        x = self.lin1(x)
        x = F.relu(x)
        x = self.dropout(x)
        x = self.lin2(x)
        
        return x.squeeze()

class GraphNetworkBuilder:
    """Build road network graphs for GNN"""
    
    def __init__(self):
        self.graph = nx.Graph()
        self.node_features = {}
        self.edge_features = {}
        
    def build_road_network(self, nodes, edges):
        """Build road network from nodes and edges"""
        # Add nodes
        for node in nodes:
            self.graph.add_node(
                node['id'],
                lat=node['lat'],
                lng=node['lng'],
                traffic=node.get('traffic', 0),
                road_type=node.get('road_type', 'local'),
                speed_limit=node.get('speed_limit', 50)
            )
            
        # Add edges
        for edge in edges:
            self.graph.add_edge(
                edge['source'],
                edge['target'],
                distance=edge['distance'],
                time=edge['time'],
                cost=edge.get('cost', 0),
                fuel=edge.get('fuel', 0),
                congestion=edge.get('congestion', 0)
            )
            
        return self.graph
    
    def extract_features(self):
        """Extract node and edge features"""
        node_features = []
        edge_indices = []
        edge_features = []
        
        # Node features
        node_map = {}
        for i, (node, data) in enumerate(self.graph.nodes(data=True)):
            node_map[node] = i
            features = [
                data.get('lat', 0),
                data.get('lng', 0),
                data.get('traffic', 0) / 100,
                self._road_type_encoding(data.get('road_type', 'local')),
                data.get('speed_limit', 50) / 100
            ]
            node_features.append(features)
        
        # Edge features
        for u, v, data in self.graph.edges(data=True):
            edge_indices.append([node_map[u], node_map[v]])
            edge_features.append([
                data.get('distance', 0) / 100,
                data.get('time', 0) / 100,
                data.get('cost', 0) / 1000,
                data.get('fuel', 0) / 100,
                data.get('congestion', 0)
            ])
        
        return {
            'node_features': torch.tensor(node_features, dtype=torch.float),
            'edge_indices': torch.tensor(edge_indices, dtype=torch.long).t().contiguous(),
            'edge_features': torch.tensor(edge_features, dtype=torch.float)
        }
    
    def _road_type_encoding(self, road_type):
        """Encode road type to one-hot"""
        types = ['highway', 'arterial', 'collector', 'local', 'street']
        encoding = [0] * len(types)
        if road_type in types:
            encoding[types.index(road_type)] = 1
        return encoding
    
    def get_pytorch_data(self):
        """Convert to PyTorch Geometric Data object"""
        features = self.extract_features()
        return Data(
            x=features['node_features'],
            edge_index=features['edge_indices'],
            edge_attr=features['edge_features']
        )

class RouteOptimizer:
    """GNN-based Route Optimizer"""
    
    def __init__(self, model_path=None):
        self.model = None
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        
        if model_path:
            self.load_model(model_path)
        else:
            self.model = GNNRouteModel().to(self.device)
        
        logger.info(f"✅ Route Optimizer initialized on {self.device}")
    
    def optimize_route(self, start_node, end_node, graph_data, objectives=['time', 'cost', 'fuel']):
        """Optimize route using GNN"""
        try:
            # Convert to PyTorch Geometric
            data = graph_data.to(self.device)
            
            # Get node embeddings
            with torch.no_grad():
                embeddings = self.model(data.x, data.edge_index, data.edge_attr)
            
            # Find optimal route using embeddings
            route = self._find_optimal_route(
                start_node, end_node, 
                embeddings.cpu().numpy(),
                graph_data,
                objectives
            )
            
            return {
                'route': route,
                'total_distance': sum(r.get('distance', 0) for r in route),
                'total_time': sum(r.get('time', 0) for r in route),
                'total_cost': sum(r.get('cost', 0) for r in route),
                'total_fuel': sum(r.get('fuel', 0) for r in route),
                'nodes_visited': len(route),
                'timestamp': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Route optimization failed: {e}")
            return None
    
    def _find_optimal_route(self, start, end, embeddings, graph_data, objectives):
        """Find optimal route using Dijkstra with GNN embeddings"""
        # Use embeddings as heuristic
        # In production: implement A* or Dijkstra with GNN heuristic
        
        # Simple path finding
        route = []
        current = start
        visited = set()
        
        while current != end and len(visited) < 100:
            visited.add(current)
            neighbors = graph_data.graph.neighbors(current)
            
            best_neighbor = None
            best_score = float('inf')
            
            for neighbor in neighbors:
                if neighbor in visited:
                    continue
                    
                # Calculate score using GNN embeddings
                score = self._calculate_score(
                    embeddings, 
                    current, 
                    neighbor, 
                    objectives,
                    graph_data
                )
                
                if score < best_score:
                    best_score = score
                    best_neighbor = neighbor
            
            if best_neighbor is None:
                break
                
            route.append({
                'from': current,
                'to': best_neighbor,
                'distance': graph_data.graph[current][best_neighbor].get('distance', 0),
                'time': graph_data.graph[current][best_neighbor].get('time', 0),
                'cost': graph_data.graph[current][best_neighbor].get('cost', 0),
                'fuel': graph_data.graph[current][best_neighbor].get('fuel', 0)
            })
            
            current = best_neighbor
        
        return route
    
    def _calculate_score(self, embeddings, current, neighbor, objectives, graph_data):
        """Calculate route score using GNN embeddings"""
        score = 0
        edge_data = graph_data.graph[current][neighbor]
        
        weights = {
            'time': 1.0,
            'cost': 0.5,
            'fuel': 0.3
        }
        
        for obj in objectives:
            if obj in edge_data:
                score += weights.get(obj, 1.0) * edge_data[obj]
        
        # Add embedding distance
        emb_dist = np.linalg.norm(embeddings[current] - embeddings[neighbor])
        score += 0.1 * emb_dist
        
        return score
    
    def train(self, train_data, val_data=None, epochs=100):
        """Train GNN model"""
        optimizer = torch.optim.Adam(self.model.parameters(), lr=0.001)
        criterion = nn.MSELoss()
        
        for epoch in range(epochs):
            self.model.train()
            total_loss = 0
            
            for data in train_data:
                data = data.to(self.device)
                optimizer.zero_grad()
                
                # Forward pass
                out = self.model(data.x, data.edge_index, data.edge_attr, data.batch)
                loss = criterion(out, data.y)
                
                # Backward pass
                loss.backward()
                optimizer.step()
                
                total_loss += loss.item()
            
            avg_loss = total_loss / len(train_data)
            
            if epoch % 10 == 0:
                logger.info(f"Epoch {epoch}: Loss = {avg_loss:.4f}")
        
        return avg_loss
    
    def save_model(self, path='models/gnn_route.pth'):
        """Save GNN model"""
        torch.save(self.model.state_dict(), path)
        logger.info(f"✅ Model saved to {path}")
    
    def load_model(self, path='models/gnn_route.pth'):
        """Load GNN model"""
        self.model = GNNRouteModel().to(self.device)
        self.model.load_state_dict(torch.load(path, map_location=self.device))
        self.model.eval()
        logger.info(f"✅ Model loaded from {path}")
    
    def multi_objective_optimization(self, start, end, graph_data):
        """Multi-objective route optimization"""
        objectives = [
            {'name': 'time', 'weight': 0.5},
            {'name': 'cost', 'weight': 0.3},
            {'name': 'fuel', 'weight': 0.2}
        ]
        
        # Get Pareto optimal routes
        routes = []
        for obj in objectives:
            route = self.optimize_route(
                start, end, graph_data, 
                objectives=[obj['name']]
            )
            if route:
                routes.append(route)
        
        # Select best route
        best_route = min(routes, key=lambda x: 
            sum([obj['weight'] * x[f'total_{obj["name"]}'] for obj in objectives])
        )
        
        return best_route
    
    def real_time_update(self, current_route, new_traffic_data):
        """Update route based on real-time traffic"""
        # Update graph with new traffic data
        for edge in current_route:
            edge_id = f"{edge['from']}-{edge['to']}"
            if edge_id in new_traffic_data:
                edge['time'] = new_traffic_data[edge_id]['time']
                edge['cost'] = new_traffic_data[edge_id]['cost']
        
        # Re-optimize if needed
        if self._needs_reoptimization(current_route):
            return self._reoptimize(current_route)
        
        return current_route
    
    def _needs_reoptimization(self, route):
        """Check if route needs reoptimization"""
        # Check if any edge has high congestion
        for edge in route:
            if edge.get('congestion', 0) > 0.7:
                return True
        return False
    
    def _reoptimize(self, route):
        """Re-optimize route with current data"""
        start = route[0]['from']
        end = route[-1]['to']
        # Rebuild graph with current data
        # In production: use current graph
        return route