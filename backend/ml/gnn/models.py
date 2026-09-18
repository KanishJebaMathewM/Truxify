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

# Continuous node features are lat, lng, traffic, and speed_limit.
# The five road-type one-hot features remain categorical and are not scaled.
GNN_NODE_CONTINUOUS_FEATURE_INDICES = (0, 1, 2, 8)
GNN_EDGE_CONTINUOUS_FEATURE_INDICES = (0, 1, 2, 3, 4)


class GNNFeatureScaler:
    """Standardize continuous GNN features and persist exact training statistics."""

    def __init__(
        self,
        node_mean=None,
        node_scale=None,
        edge_mean=None,
        edge_scale=None,
        fitted=False,
    ):
        # Deterministic fallback is used only before training (for development
        # mode). Trained models replace these values with training statistics.
        self.node_mean = torch.tensor(
            node_mean if node_mean is not None else [0.0, 0.0, 50.0, 50.0],
            dtype=torch.float,
        )
        self.node_scale = torch.tensor(
            node_scale if node_scale is not None else [90.0, 180.0, 50.0, 50.0],
            dtype=torch.float,
        )
        self.edge_mean = torch.tensor(
            edge_mean if edge_mean is not None else [100.0, 100.0, 1000.0, 100.0, 0.5],
            dtype=torch.float,
        )
        self.edge_scale = torch.tensor(
            edge_scale if edge_scale is not None else [100.0, 100.0, 1000.0, 100.0, 0.5],
            dtype=torch.float,
        )
        self.fitted = fitted

    @classmethod
    def default(cls):
        """Return deterministic scaling for untrained development mode."""
        return cls()

    def fit(self, train_data):
        """Fit mean/std on training tensors while preserving categorical features."""
        node_values = []
        edge_values = []

        for data in train_data:
            x = getattr(data, "x", None)
            if x is None or x.dim() != 2 or x.size(1) < GNN_NODE_FEATURE_DIM:
                raise ValueError(
                    "Training samples must provide node features with 9 columns"
                )
            node_values.append(
                x.detach().float().cpu()[:, list(GNN_NODE_CONTINUOUS_FEATURE_INDICES)]
            )

            edge_attr = getattr(data, "edge_attr", None)
            if edge_attr is not None and edge_attr.numel():
                if edge_attr.dim() != 2 or edge_attr.size(1) < GNN_EDGE_FEATURE_DIM:
                    raise ValueError(
                        "Training samples must provide edge features with 5 columns"
                    )
                edge_values.append(
                    edge_attr.detach()
                    .float()
                    .cpu()[:, list(GNN_EDGE_CONTINUOUS_FEATURE_INDICES)]
                )

        if not node_values:
            raise ValueError("Training data must contain at least one node feature tensor")

        node_matrix = torch.cat(node_values, dim=0)
        node_mean = node_matrix.mean(dim=0)
        node_scale = node_matrix.std(dim=0, unbiased=False)
        node_scale = torch.where(node_scale > 1e-8, node_scale, torch.ones_like(node_scale))
        self.node_mean = node_mean
        self.node_scale = node_scale

        if edge_values:
            edge_matrix = torch.cat(edge_values, dim=0)
            edge_mean = edge_matrix.mean(dim=0)
            edge_scale = edge_matrix.std(dim=0, unbiased=False)
            edge_scale = torch.where(
                edge_scale > 1e-8, edge_scale, torch.ones_like(edge_scale)
            )
            self.edge_mean = edge_mean
            self.edge_scale = edge_scale

        self.fitted = True
        return self

    @staticmethod
    def _transform_columns(tensor, indices, mean, scale):
        """Standardize selected columns and return a float tensor."""
        result = tensor.clone().float()
        if result.numel() == 0:
            return result

        index_list = list(indices)
        device = result.device
        dtype = result.dtype
        mean = mean.to(device=device, dtype=dtype)
        scale = scale.to(device=device, dtype=dtype)
        result[:, index_list] = (result[:, index_list] - mean) / scale
        return result

    def transform_node_features(self, x):
        """Scale continuous node features while preserving road-type one-hot values."""
        return self._transform_columns(
            x,
            GNN_NODE_CONTINUOUS_FEATURE_INDICES,
            self.node_mean,
            self.node_scale,
        )

    def transform_edge_features(self, edge_attr):
        """Scale all continuous edge features."""
        return self._transform_columns(
            edge_attr,
            GNN_EDGE_CONTINUOUS_FEATURE_INDICES,
            self.edge_mean,
            self.edge_scale,
        )

    def transform_graph(self, data):
        """Apply the same fitted/default transform to a PyG Data object in-place."""
        data.x = self.transform_node_features(data.x)
        if getattr(data, "edge_attr", None) is not None:
            data.edge_attr = self.transform_edge_features(data.edge_attr)
        return data

    def state_dict(self):
        """Return persisted scaling parameters for a model checkpoint."""
        return {
            "node_mean": self.node_mean.tolist(),
            "node_scale": self.node_scale.tolist(),
            "edge_mean": self.edge_mean.tolist(),
            "edge_scale": self.edge_scale.tolist(),
            "fitted": self.fitted,
        }

    @classmethod
    def from_state_dict(cls, state):
        """Restore an exact scaler from a saved model checkpoint."""
        required = {"node_mean", "node_scale", "edge_mean", "edge_scale", "fitted"}
        missing = required.difference(state)
        if missing:
            raise ValueError(
                f"Saved GNN feature scaler is missing fields: {', '.join(sorted(missing))}"
            )
        return cls(
            node_mean=state["node_mean"],
            node_scale=state["node_scale"],
            edge_mean=state["edge_mean"],
            edge_scale=state["edge_scale"],
            fitted=bool(state["fitted"]),
        )



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
    """Build directed road network graphs for GNN route optimization."""
    
    def __init__(self):
        """Initialize a directed road network graph and feature mappings."""
        self.graph = nx.DiGraph()
        self.node_features = {}
        self.edge_features = {}
        
    def build_road_network(self, nodes, edges):
        """Build road network after validating every edge endpoint."""
        node_ids = {node['id'] for node in nodes}
        for edge in edges:
            source = edge['source']
            target = edge['target']
            missing_endpoints = [
                node_id for node_id in (source, target) if node_id not in node_ids
            ]
            if missing_endpoints:
                missing = ', '.join(dict.fromkeys(missing_endpoints))
                raise ValueError(f"Unknown edge endpoint(s): {missing}")

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
        """Extract raw node and edge features before centralized model scaling."""
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
                data.get('traffic', 0),
                *self._road_type_encoding(data.get('road_type', 'local')),
                data.get('speed_limit', 50)
            ]
            node_features.append(features)
        
        # Edge features
        for u, v, data in self.graph.edges(data=True):
            edge_indices.append([node_map[u], node_map[v]])
            edge_features.append([
                data.get('distance', 0),
                data.get('time', 0),
                data.get('cost', 0),
                data.get('fuel', 0),
                data.get('congestion', 0)
            ])

        self.node_map = node_map

        if edge_indices:
            edge_index = torch.tensor(
                edge_indices, dtype=torch.long
            ).t().contiguous()
            edge_attr = torch.tensor(edge_features, dtype=torch.float)
        else:
            edge_index = torch.empty((2, 0), dtype=torch.long)
            edge_attr = torch.empty((0, GNN_EDGE_FEATURE_DIM), dtype=torch.float)

        return {
            'node_features': torch.tensor(node_features, dtype=torch.float),
            'edge_indices': edge_index,
            'edge_features': edge_attr
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
    
    def __init__(self, model_path=None, allow_untrained=False):
        """Initialize RouteOptimizer with GNNRouteModel and hardware acceleration device."""
        self.model = None
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        self.is_trained = False
        self.allow_untrained = allow_untrained
        self.feature_scaler = GNNFeatureScaler.default()
        
        if model_path:
            self.load_model(model_path)
        else:
            self.model = GNNRouteModel().to(self.device)
            if self.allow_untrained:
                logger.info("Route Optimizer initialized with untrained weights (dev mode allowed)")
            else:
                logger.warning("Route Optimizer initialized without trained weights. Call train() or load_model() before serving.")
        
        logger.info(f"✅ Route Optimizer initialized on {self.device}")
    
    def optimize_route(self, start_node, end_node, graph_data, objectives=['time', 'cost', 'fuel'], constraints=None):
        """Optimize route using GNN and constrained Dijkstra pathfinding."""
        if not self.is_trained and not self.allow_untrained:
            logger.error("Attempted route optimization on untrained model")
            raise RuntimeError("GNN model is untrained. Load a trained checkpoint or enable dev mode.")

        try:
            # Check node presence in graph
            if not hasattr(graph_data, 'graph') or start_node not in graph_data.graph or end_node not in graph_data.graph:
                logger.warning(f"Start ({start_node}) or End ({end_node}) node not found in graph")
                return None

            # Convert to PyTorch Geometric
            data = graph_data.to(self.device).clone()

            # Validate the node-feature dimension matches the model before the
            # GCN conv layers run (otherwise Linear raises a cryptic size mismatch).
            if hasattr(self.model, 'input_dim') and data.x.shape[1] != self.model.input_dim:
                raise ValueError(
                    f"Node feature dim mismatch: model expects {self.model.input_dim}, got {data.x.shape[1]}"
                )

            # Apply the same scaler learned during training (or the deterministic
            # development-mode fallback when the optimizer is explicitly untrained).
            self.feature_scaler.transform_graph(data)

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

            return self._build_route_result(route)
            
        except RuntimeError:
            raise
        except Exception as e:
            logger.error(f"Route optimization failed: {e}")
            return None

    def _build_route_result(self, route):
        """Build the stable single-route response used by existing callers."""
        return {
            'success': True,
            'route': route,
            'total_distance': sum(r.get('distance', 0) for r in route),
            'total_time': sum(r.get('time', 0) for r in route),
            'total_cost': sum(r.get('cost', 0) for r in route),
            'total_fuel': sum(r.get('fuel', 0) for r in route),
            'nodes_visited': 1 if not route else len(route) + 1,
            'timestamp': datetime.now().isoformat()
        }
    
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

        max_time = constraints.get('max_time')
        if max_time is None:
            max_time = constraints.get('hos_limit')
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
        if not train_data:
            raise ValueError("Training dataset cannot be empty")

        # Fit once on the complete training set so every training batch and later
        # inference use exactly the same statistics.
        self.feature_scaler.fit(train_data)

        optimizer = torch.optim.Adam(self.model.parameters(), lr=0.001)
        criterion = nn.MSELoss()
        
        avg_loss = 0.0
        for epoch in range(epochs):
            self.model.train()
            total_loss = 0.0
            
            for data in train_data:
                data = data.to(self.device).clone()
                self.feature_scaler.transform_graph(data)
                optimizer.zero_grad()
                
                # Forward pass
                batch = getattr(data, 'batch', None)
                edge_attr = getattr(data, 'edge_attr', None)
                out = self.model(data.x, data.edge_index, edge_attr, batch)
                target = getattr(data, 'y', None)
                if target is None:
                    target = torch.zeros_like(out)
                loss = criterion(out, target)
                
                # Backward pass
                loss.backward()
                optimizer.step()
                
                total_loss += loss.item()
            
            avg_loss = total_loss / len(train_data)
            
            if epoch % 10 == 0:
                logger.info(f"Epoch {epoch}: Loss = {avg_loss:.4f}")
        
        self.is_trained = True
        self.model.eval()
        return avg_loss
    
    def save_model(self, path='models/gnn_route.pth'):
        """Save GNN weights together with the exact feature scaling parameters."""
        if not self.feature_scaler.fitted:
            raise ValueError(
                "Cannot save a GNN model before fitting feature scaler during training"
            )

        checkpoint = {
            "state_dict": self.model.state_dict(),
            "feature_scaler": self.feature_scaler.state_dict(),
        }
        torch.save(checkpoint, path)
        logger.info(f"✅ Model and feature scaler saved to {path}")

    def load_model(self, path='models/gnn_route.pth'):
        """Load GNN weights and the exact persisted feature scaling parameters."""
        checkpoint = torch.load(path, map_location=self.device)

        if not isinstance(checkpoint, dict) or "state_dict" not in checkpoint:
            raise ValueError(
                "GNN model checkpoint does not contain persisted feature scaling parameters; "
                "retrain and save the model before loading it"
            )

        scaler_state = checkpoint.get("feature_scaler")
        if scaler_state is None:
            raise ValueError(
                "GNN model checkpoint does not contain persisted feature scaling parameters; "
                "retrain and save the model before loading it"
            )

        self.model = GNNRouteModel().to(self.device)
        self.model.load_state_dict(checkpoint["state_dict"])
        self.feature_scaler = GNNFeatureScaler.from_state_dict(scaler_state)
        if not self.feature_scaler.fitted:
            raise ValueError("Saved GNN feature scaler was not fitted on training data")
        self.model.eval()
        self.is_trained = True
        logger.info(f"✅ Model and feature scaler loaded from {path}")

    def _edge_is_feasible(self, edge_data, constraints):
        """Return whether an edge satisfies the active hard route constraints."""
        if constraints.get('hazmat', False) and not edge_data.get('hazmat_allowed', True):
            return False
        
        truck_weight = constraints.get('truck_weight') or constraints.get('weight')
        max_weight = edge_data.get('max_weight') or edge_data.get('weight_limit')
        if truck_weight is not None and max_weight is not None and truck_weight > max_weight:
            return False
        
        truck_height = constraints.get('truck_height') or constraints.get('height')
        max_height = edge_data.get('max_height') or edge_data.get('height_limit')
        if truck_height is not None and max_height is not None and truck_height > max_height:
            return False
        
        return True

    def _route_result_for_path(self, path, graph_data):
        """Convert a node path into the same route result shape as optimize_route."""
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
        return self._build_route_result(route)

    def _pareto_dominates(self, left, right, objectives):
        """Return True when left is no worse in every objective and better in one."""
        left_values = tuple(left[f'total_{objective}'] for objective in objectives)
        right_values = tuple(right[f'total_{objective}'] for objective in objectives)
        return all(a <= b for a, b in zip(left_values, right_values)) and any(
            a < b for a, b in zip(left_values, right_values)
        )

    def _pareto_frontier(self, candidates, objectives):
        """Filter a set of route results down to its nondominated frontier."""
        frontier = []
        for candidate in candidates:
            dominated = False
            for existing in candidates:
                if existing is candidate:
                    continue
                if self._pareto_dominates(existing, candidate, objectives):
                    dominated = True
                    break
            if not dominated:
                frontier.append(candidate)
        return frontier

    def _find_pareto_routes(self, start, end, graph_data, objectives, constraints=None):
        """Find the exact nondominated set of additive objective routes."""
        constraints = constraints or {}
        if not hasattr(graph_data, 'graph'):
            return []
        if start not in graph_data.graph or end not in graph_data.graph:
            return []
        if start == end:
            return [self._build_route_result([])]

        # Each label stores cumulative objective values, elapsed time, and the simple path.
        labels = {start: [((0.0,) * len(objectives), 0.0, (start,))]}
        queue = [(tuple(0.0 for _ in objectives), 0.0, (start,))]

        while queue:
            current_values, current_time, current_path = heapq.heappop(queue)
            current_node = current_path[-1]
            
            if current_node != end:
                for neighbor in graph_data.graph.neighbors(current_node):
                    if neighbor in current_path:
                        continue

                    edge_data = graph_data.graph[current_node][neighbor]
                    if not self._edge_is_feasible(edge_data, constraints):
                        continue

                    edge_time = float(edge_data.get('time', 0))
                    new_time = current_time + edge_time
                    max_time = constraints.get('max_time')
                    if max_time is None:
                        max_time = constraints.get('hos_limit')
                    if max_time is not None and new_time > max_time:
                        continue

                    new_values = tuple(
                        current_values[index] + float(edge_data.get(objective, 0))
                        for index, objective in enumerate(objectives)
                    )
                    new_path = current_path + (neighbor,)
                    new_label = (new_values, new_time, new_path)

                    existing_labels = labels.setdefault(neighbor, [])
                    candidate_result = self._route_result_for_path(new_path, graph_data)

                    dominated = False
                    survivors = []
                    for existing_values, existing_time, existing_path in existing_labels:
                        existing_result = self._route_result_for_path(existing_path, graph_data)
                        if self._pareto_dominates(existing_result, candidate_result, objectives):
                            dominated = True
                            survivors.append((existing_values, existing_time, existing_path))
                            continue
                        if self._pareto_dominates(candidate_result, existing_result, objectives):
                            continue
                        survivors.append((existing_values, existing_time, existing_path))

                    if dominated:
                        labels[neighbor] = survivors
                        continue

                    survivors.append(new_label)
                    labels[neighbor] = survivors
                    heapq.heappush(queue, new_label)

        destination_labels = labels.get(end, [])
        candidates = [self._route_result_for_path(path, graph_data) for _, _, path in destination_labels]
        return self._pareto_frontier(candidates, objectives)
    
    def multi_objective_optimization(self, start, end, graph_data, constraints=None):
        """Return a representative route together with the exact Pareto frontier."""
        objectives = ['time', 'cost', 'fuel']
        frontier = self._find_pareto_routes(start, end, graph_data, objectives, constraints)
        if not frontier:
            return None
        weights = {'time': 0.5, 'cost': 0.3, 'fuel': 0.2}
        best_route = min(frontier, key=lambda candidate: sum(
            weights[objective] * candidate[f'total_{objective}'] for objective in objectives
        ))
        result = dict(best_route)
        result['pareto_routes'] = frontier
        result['pareto_count'] = len(frontier)
        return result
    
    def real_time_update(self, current_route, new_traffic_data, graph_data=None,
                         objectives=None, constraints=None):
        """Apply traffic updates and reroute through the current road network."""
        if not current_route:
            return current_route
        if graph_data is None or not hasattr(graph_data, 'graph'):
            logger.warning("Real-time rerouting requires graph_data; returning the updated current route")
            updated_route = [dict(edge) for edge in current_route]
            self._apply_traffic_to_route(updated_route, new_traffic_data)
            return updated_route
        graph = graph_data.graph.copy()
        edge_lookup = {}
        for u, v in graph.edges:
            edge_lookup[f"{u}-{v}"] = (u, v)
            edge_lookup[f"{v}-{u}"] = (u, v)
        changed = False
        updated_route = [dict(edge) for edge in current_route]
        for edge_id, update in new_traffic_data.items():
            if not isinstance(update, dict):
                continue
            endpoints = edge_lookup.get(edge_id)
            if endpoints is None:
                continue
            u, v = endpoints
            edge_attrs = graph[u][v]
            for field in ('time', 'cost', 'fuel', 'congestion'):
                if field in update and update[field] is not None:
                    value = float(update[field])
                    if edge_attrs.get(field) != value:
                        edge_attrs[field] = value
                        changed = True
        self._apply_traffic_to_route(updated_route, new_traffic_data)
        if not changed:
            return updated_route
        builder = GraphNetworkBuilder()
        nodes = [
            {
                'id': node_id,
                'lat': attrs.get('lat', 0),
                'lng': attrs.get('lng', 0),
                'traffic': attrs.get('traffic', 0),
                'road_type': attrs.get('road_type', 'local'),
                'speed_limit': attrs.get('speed_limit', 50),
            }
            for node_id, attrs in graph.nodes(data=True)
        ]
        edges = [
            {
                'source': u,
                'target': v,
                'distance': attrs.get('distance', 0),
                'time': attrs.get('time', 0),
                'cost': attrs.get('cost', 0),
                'fuel': attrs.get('fuel', 0),
                'congestion': attrs.get('congestion', 0),
                'hazmat_allowed': attrs.get('hazmat_allowed', True),
                'max_weight': attrs.get('max_weight'),
                'max_height': attrs.get('max_height'),
            }
            for u, v, attrs in graph.edges(data=True)
        ]
        builder.build_road_network(nodes, edges)
        updated_graph_data = builder.get_pytorch_data()
        start = current_route[0].get('from')
        end = current_route[-1].get('to')
        if start is None or end is None:
            return updated_route
        rerouted = self._reoptimize(
            start, end, updated_graph_data,
            objectives or ['time', 'cost', 'fuel'], constraints
        )
        return rerouted if rerouted is not None else updated_route

    def _apply_traffic_to_route(self, route, traffic_data):
        """Apply known traffic updates to a route copy."""
        for edge in route:
            edge_id = f"{edge['from']}-{edge['to']}"
            update = traffic_data.get(edge_id)
            if not isinstance(update, dict):
                continue
            for field in ('time', 'cost', 'fuel', 'congestion'):
                if field in update and update[field] is not None:
                    edge[field] = float(update[field])

    def _needs_reoptimization(self, route):
        """Check if any current route edge has high congestion."""
        return any(edge.get('congestion', 0) > 0.7 for edge in route)

    def _reoptimize(self, start, end, graph_data, objectives, constraints=None):
        """Recompute the route over the updated graph."""
        result = self.optimize_route(start, end, graph_data, objectives, constraints)
        if result and result.get('success'):
            return result['route']
        return None
