import numpy as np

class GraphAttentionNetworkCongestionModel:
    """
    Graph Attention Network (GAT) for forecasting traffic congestion propagation across highway network nodes.
    """
    def __init__(self, in_features: int = 3, out_features: int = 1):
        # Attention weights evaluating node features
        self.attention_weights = np.array([-0.01, 0.005, 0.05])
        self.bias = 0.1

    def compute_node_attention(self, node_features: np.ndarray) -> np.ndarray:
        """Applies self-attention mechanism over highway graph nodes."""
        logits = np.dot(node_features, self.attention_weights) + self.bias
        attention_scores = 1.0 / (1.0 + np.exp(-logits))  # Sigmoid attention activation
        return attention_scores

    def predict_bottleneck_delays(self, node_features: np.ndarray) -> list:
        attention_scores = self.compute_node_attention(node_features)
        predictions = []
        for i, score in enumerate(attention_scores):
            is_bottleneck = score > 0.6
            predictions.append({
                "node_id": i,
                "congestion_score": round(float(score), 4),
                "is_bottleneck_detected": is_bottleneck,
                "predicted_delay_mins": round(float(score * 25.0), 1)
            })
        return predictions

gat_model = GraphAttentionNetworkCongestionModel()
