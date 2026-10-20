"""Standalone two-step heterogeneous meta-path operator, with convex selection.

The historical class name does not imply learned embeddings or calibrated
matching probabilities. This NumPy baseline has no training/serving pipeline.
"""

import math

import numpy as np


class GraphTransformerNetworkLogisticsEmbedder:
    """Compose two soft-selected directed relation graphs on one node basis."""

    def __init__(self, num_edge_types: int = 4, embedding_dim: int = 8):
        for name, value in [
            ("num_edge_types", num_edge_types),
            ("embedding_dim", embedding_dim),
        ]:
            if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
                raise ValueError(f"{name} must be a positive integer")
        self.num_edge_types = num_edge_types
        self.embedding_dim = embedding_dim
        # Logits, not raw mixture coefficients; default yields uniform selection.
        self.edge_selection_weights = np.ones((2, num_edge_types)) * 0.25

    @staticmethod
    def _finite_array(values, name):
        try:
            raw = np.asarray(values)
            if raw.dtype.kind not in "biuf":
                raise ValueError(f"{name} must contain real numeric data")
            result = np.array(raw, dtype=np.float64, copy=True)
        except (TypeError, OverflowError) as exc:
            raise ValueError(f"{name} must contain finite real data") from exc
        if not np.isfinite(result).all():
            raise ValueError(f"{name} must contain finite real data")
        return result

    def compute_metapath_adjacencies(self, edge_adjacencies: list) -> np.ndarray:
        """Return (sum alpha_i A_i) @ (sum beta_j A_j), from owned snapshots."""
        if len(edge_adjacencies) != self.num_edge_types:
            raise ValueError("edge count must match num_edge_types")
        graphs = [self._finite_array(graph, "adjacency") for graph in edge_adjacencies]
        shape = graphs[0].shape
        if len(shape) != 2 or shape[0] != shape[1] or shape[0] == 0:
            raise ValueError("adjacency matrices must be nonempty and square")
        if any(graph.shape != shape or np.any(graph < 0) for graph in graphs):
            raise ValueError(
                "all adjacencies must share a nonnegative square node basis"
            )
        logits = self._finite_array(self.edge_selection_weights, "selection logits")
        if logits.shape != (2, self.num_edge_types):
            raise ValueError("selection logits must have shape (2, num_edge_types)")
        # Extreme finite differences may become -inf, whose softmax mass is zero.
        with np.errstate(over="ignore", under="ignore"):
            shifted = logits - logits.max(axis=1, keepdims=True)
            mass = np.exp(shifted)
        probabilities = mass / mass.sum(axis=1, keepdims=True)
        stack = np.stack(graphs)
        try:
            with np.errstate(over="raise", invalid="raise", divide="raise"):
                # Weight each graph directly: a global scale could erase a
                # selected tiny relation next to an unselected huge relation.
                mixtures = np.einsum("re,eij->rij", probabilities, stack)
                result = mixtures[0] @ mixtures[1]
        except FloatingPointError as exc:
            raise OverflowError(
                "meta-path arithmetic exceeds finite numeric range"
            ) from exc
        if not np.isfinite(result).all():
            raise OverflowError("meta-path arithmetic exceeds finite numeric range")
        return result

    def predict_link_probabilities(
        self, edge_adjacencies: list, driver_idx: int, load_idx: int
    ) -> float:
        """Legacy sigmoid link score; not a calibrated matching probability."""
        for value in (driver_idx, load_idx):
            if (
                isinstance(value, (bool, np.bool_))
                or not isinstance(value, (int, np.integer))
                or value < 0
            ):
                raise ValueError("node indices must be nonnegative integers")
        adjacency = self.compute_metapath_adjacencies(edge_adjacencies)
        if driver_idx >= adjacency.shape[0] or load_idx >= adjacency.shape[1]:
            raise ValueError("node index is outside the graph")
        score = float(adjacency[driver_idx, load_idx])
        # Valid adjacency scores are nonnegative, so this exponential cannot overflow.
        return round(1.0 / (1.0 + math.exp(-score)), 4)


gtn_embedder = GraphTransformerNetworkLogisticsEmbedder()
