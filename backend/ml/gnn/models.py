import heapq
from datetime import datetime
import logging
import networkx as nx
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch_geometric.data import Data, DataLoader
from torch_geometric.nn import GATConv, GCNConv, SAGEConv, global_mean_pool

logger = logging.getLogger(__name__)

# Per-node feature dimension produced by `extract_features` (lat, lng,
# traffic, 5-element road-type one-hot, speed_limit -> 9 features).
GNN_NODE_FEATURE_DIM = 9
GNN_EDGE_FEATURE_DIM = 5

class GNNRouteModel(nn.Module):
    """Graph Neural Network for Route Optimization."""
    
    def __init__(self, input_dim=GNN_NODE_FEATURE_DIM, hidden_dim=128, output_dim=32, edge_dim=GNN_EDGE_FEATURE_DIM,
                 in_channels=None, hidden_channels=None, out_channels=None):
        """Initialize GNN route model layers, dimensions, and attention."""
        super(GNNRouteModel, self).__init__()
        if in_channels is not None:
            input_dim = in_channels
        if hidden_channels is not None:
            hidden_dim = hidden_channels
        if out_channels is not None:
            output_dim = out_channels

        self.input_dim = input_dim
        self.hidden_dim = hidden_dim
        self.output_dim = output_dim
        self.edge_dim = edge_dim
        
        # Graph convolution layers
        self.conv1 = GCNConv(input_dim, hidden_dim)
        if edge_dim:
            self.conv2 = GATConv(hidden_dim, hidden_dim, heads=4, concat=True, edge_dim=edge_dim)
        else:
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
        """Execute forward pass through GNN convolution, attention, and pooling layers."""
        # First GCN layer
        x = self.conv1(x, edge_index)
        x = F.relu(x)
        x = self.bn1(x)
        x = self.dropout(x)
        
        # Second GAT layer with edge attributes
        if getattr(self, 'edge_dim', None) is not None:
            if edge_attr is None:
                edge_attr = torch.zeros((edge_index.size(1), self.edge_dim), dtype=torch.float, device=x.device)
            x = self.conv2(x, edge_index, edge_attr=edge_attr)
        else:
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

# Backward-compatibility alias
RouteGNN = GNNRouteModel

class GraphNetworkBuilder:
    """Build road network graphs for GNN."""
    
    def __init__(self):
        """Initialize empty road network graph and feature mappings."""
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
                congestion=edge.get('congestion', 0),
                hazmat_allowed=edge.get('hazmat_allowed', True),
                max_weight=edge.get('max_weight'),
                max_height=edge.get('max_height')
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
                *self._road_type_encoding(data.get('road_type', 'local')),
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

        self.node_map = node_map

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
        data = Data(
            x=features['node_features'],
            edge_index=features['edge_indices'],
            edge_attr=features['edge_features']
        )
        data.graph = self.graph
        data.node_map = self.node_map
        return data

class RouteOptimizer:
    """GNN-based Route Optimizer"""
    
    def __init__(self, model_path=None):
        """Initialize RouteOptimizer with GNNRouteModel and hardware acceleration device."""
        self.model = None
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        
        if model_path:
            self.load_model(model_path)
        else:
            self.model = GNNRouteModel().to(self.device)
        
        logger.info(f"✅ Route Optimizer initialized on {self.device}")
    
    def optimize_route(self, start_node, end_node, graph_data, objectives=['time', 'cost', 'fuel'], constraints=None):
        """Optimize route using GNN and constrained Dijkstra pathfinding."""
        try:
            # Convert to PyTorch Geometric
            data = graph_data.to(self.device)

            # Validate the node-feature dimension matches the model before the
            # GCN conv layers run (otherwise Linear raises a cryptic size mismatch).
            if hasattr(self.model, 'input_dim') and data.x.shape[1] != self.model.input_dim:
                raise ValueError(
                    f"Node feature dim mismatch: model expects {self.model.input_dim}, got {data.x.shape[1]}"
                )

            # Get node embeddings
            with torch.no_grad():
                embeddings = self.model(data.x, data.edge_index, data.edge_attr)
            
            # Find optimal route using embeddings and constraints
            route = self._find_optimal_route(
                start_node, end_node, 
                embeddings.cpu().numpy() if hasattr(embeddings, 'cpu') else np.array(embeddings),
                graph_data,
                objectives,
                constraints
            )
            
            # Strict reachability verification: accept empty route for zero-hop (start == end)
            if route is None or (start_node != end_node and (not route or route[-1]['to'] != end_node)):
                logger.warning(f"No complete route found from {start_node} to {end_node}")
                return None

            return {
                'success': True,
                'route': route,
                'total_distance': sum(r.get('distance', 0) for r in route),
                'total_time': sum(r.get('time', 0) for r in route),
                'total_cost': sum(r.get('cost', 0) for r in route),
                'total_fuel': sum(r.get('fuel', 0) for r in route),
                'nodes_visited': 1 if start_node == end_node else len(route) + 1,
                'timestamp': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Route optimization failed: {e}")
            return None
    
    def _find_optimal_route(self, start, end, embeddings, graph_data, objectives, constraints=None):
        """Find optimal route using constrained shortest path with GNN heuristics and HOS limits."""
        if not hasattr(graph_data, 'graph'):
            logger.warning("graph_data has no graph attribute")
            return None

        if start not in graph_data.graph or end not in graph_data.graph:
            logger.warning(f"Start ({start}) or End ({end}) node not found in graph")
            return None

        if start == end:
            return []

        node_map = getattr(graph_data, 'node_map', None)
        constraints = constraints or {}

        def weight_func(u, v, edge_attrs):
            # Hard constraints validation
            # 1. Hazmat restriction: if route has hazmat cargo, road must permit hazmat
            if constraints.get('hazmat', False) and not edge_attrs.get('hazmat_allowed', True):
                return None

            # 2. Weight / Capacity constraint: truck weight exceeds road capacity / bridge rating
            truck_weight = constraints.get('truck_weight') or constraints.get('weight')
            max_weight = edge_attrs.get('max_weight') or edge_attrs.get('weight_limit')
            if truck_weight is not None and max_weight is not None and truck_weight > max_weight:
                return None

            # 3. Height / Clearance constraint
            truck_height = constraints.get('truck_height') or constraints.get('height')
            max_height = edge_attrs.get('max_height') or edge_attrs.get('height_limit')
            if truck_height is not None and max_height is not None and truck_height > max_height:
                return None

            return self._calculate_score(embeddings, u, v, objectives, graph_data, node_map)

        max_time = constraints.get('max_time') or constraints.get('hos_limit')
        path = None

        if max_time is not None:
            # Constrained shortest path: track cumulative elapsed time in priority queue
            # to prune paths exceeding max_time and explore feasible alternate routes
            pq = [(0.0, 0.0, start, [start])]
            best_state = {}

            while pq:
                curr_score, curr_time, u, u_path = heapq.heappop(pq)

                if u == end:
                    path = u_path
                    break

                if u in best_state:
                    prev_score, prev_time = best_state[u]
                    if curr_score >= prev_score and curr_time >= prev_time:
                        continue
                best_state[u] = (curr_score, curr_time)

                for v in graph_data.graph.neighbors(u):
                    if v in u_path:
                        continue
                    edge_attrs = graph_data.graph[u][v]
                    edge_weight = weight_func(u, v, edge_attrs)
                    if edge_weight is None:
                        continue

                    edge_time = float(edge_attrs.get('time', 0))
                    new_time = curr_time + edge_time
                    if new_time > max_time:
                        continue

                    new_score = curr_score + edge_weight
                    heapq.heappush(pq, (new_score, new_time, v, u_path + [v]))
        else:
            try:
                path = nx.dijkstra_path(graph_data.graph, start, end, weight=weight_func)
            except (nx.NetworkXNoPath, nx.NodeNotFound):
                logger.warning(f"No feasible path found from {start} to {end}")
                return None

        if not path or len(path) < 2:
            return None

        route = []
        for i in range(len(path) - 1):
            u, v = path[i], path[i + 1]
            edge_data = graph_data.graph[u][v]
            route.append({
                'from': u,
                'to': v,
                'distance': edge_data.get('distance', 0),
                'time': edge_data.get('time', 0),
                'cost': edge_data.get('cost', 0),
                'fuel': edge_data.get('fuel', 0),
                'congestion': edge_data.get('congestion', 0)
            })

        return route
    
    def _calculate_score(self, embeddings, current, neighbor, objectives, graph_data, node_map=None):
        """Calculate route score using GNN embeddings and selected edge objectives."""
        score = 0.0
        edge_data = graph_data.graph[current][neighbor]
        
        weights = {
            'time': 1.0,
            'cost': 0.5,
            'fuel': 0.3,
            'distance': 0.2,
            'congestion': 2.0
        }
        
        for obj in objectives:
            if obj in edge_data:
                score += weights.get(obj, 1.0) * float(edge_data[obj])

        # Add embedding distance heuristic
        if node_map is None:
            node_map = getattr(graph_data, 'node_map', None)
            
        if embeddings is not None and node_map and current in node_map and neighbor in node_map:
            try:
                emb_c = embeddings[node_map[current]]
                emb_n = embeddings[node_map[neighbor]]
                emb_dist = float(np.linalg.norm(emb_c - emb_n))
                score += 0.1 * emb_dist
            except Exception:
                pass
        
        # Non-negative weight guard for Dijkstra
        return max(score, 1e-6)
    
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
    
    def multi_objective_optimization(self, start, end, graph_data, constraints=None):
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
                objectives=[obj['name']],
                constraints=constraints
            )
            if route:
                routes.append(route)
        
        if not routes:
            return None

        # Select best route
        best_route = min(routes, key=lambda x: 
            sum([obj['weight'] * x.get(f'total_{obj["name"]}', 0) for obj in objectives])
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