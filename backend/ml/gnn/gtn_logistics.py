import numpy as np

class GraphTransformerNetworkLogisticsEmbedder:
    """
    Graph Transformer Network (GTN) for heterogeneous logistics network embedding.
    Extracts candidate meta-paths through soft edge selection matrices.
    """
    def __init__(self, num_edge_types: int = 4, embedding_dim: int = 8):
        self.num_edge_types = num_edge_types
        self.embedding_dim = embedding_dim
        # Edge selection logits (learnable parameters)
        self.edge_selection_weights = np.ones((2, num_edge_types)) * 0.25

    def compute_metapath_adjacencies(self, edge_adjacencies: list) -> np.ndarray:
        """Combines heterogeneous edge types using soft-selection matrices."""
        if len(edge_adjacencies) != self.num_edge_types:
            raise ValueError("Edge adjacencies count must match defined edge types.")

        # Compute soft-selected meta-path adjacency matrices
        meta_path_1 = np.zeros_like(edge_adjacencies[0])
        meta_path_2 = np.zeros_like(edge_adjacencies[0])

        for i in range(self.num_edge_types):
            meta_path_1 += self.edge_selection_weights[0, i] * edge_adjacencies[i]
            meta_path_2 += self.edge_selection_weights[1, i] * edge_adjacencies[i]

        # Multi-layer relational matrix multiplication representing meta-path walks
        gtn_adjacency = np.dot(meta_path_1, meta_path_2)
        return gtn_adjacency

    def predict_link_probabilities(self, edge_adjacencies: list, driver_idx: int, load_idx: int) -> float:
        gtn_adj = self.compute_metapath_adjacencies(edge_adjacencies)
        # Probabilistic connection score estimation
        score = float(gtn_adj[driver_idx, load_idx])
        return round(1.0 / (1.0 + np.exp(-score)), 4)

gtn_embedder = GraphTransformerNetworkLogisticsEmbedder()
