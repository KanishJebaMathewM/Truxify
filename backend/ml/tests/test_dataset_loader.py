"""Unit tests for backend/ml/gat/dataset_loader.py.

Run with: python3 -m pytest tests/test_dataset_loader.py -v --no-header
"""
import numpy as np
from gat.dataset_loader import HighwayGraphDatasetLoader


class TestLoadHighwayGraph:
    """Tests for the static highway graph loader."""

    def setup_method(self):
        self.loader = HighwayGraphDatasetLoader()

    def test_returns_expected_keys(self):
        """The graph dict must expose the documented keys."""
        graph = self.loader.load_highway_graph()
        assert set(graph.keys()) == {"node_features", "edge_index", "num_nodes"}

    def test_node_features_shape(self):
        """5 nodes, each with 3 features (avg_speed, density, toll wait)."""
        graph = self.loader.load_highway_graph()
        assert graph["node_features"].shape == (5, 3)

    def test_edge_index_shape(self):
        """Directed edge index with 2 rows (source, target) and 8 directed edges."""
        graph = self.loader.load_highway_graph()
        assert graph["edge_index"].shape == (2, 8)

    def test_num_nodes(self):
        """The graph must report exactly 5 nodes."""
        graph = self.loader.load_highway_graph()
        assert graph["num_nodes"] == 5

    def test_congested_node_has_lowest_speed_feature(self):
        """Node index 1 (congested toll plaza) has the lowest avg-speed feature."""
        graph = self.loader.load_highway_graph()
        speeds = graph["node_features"][:, 0]
        assert speeds[1] == speeds.min()

    def test_graph_is_deterministic(self):
        """Two calls must return identical arrays (no randomness)."""
        first = self.loader.load_highway_graph()
        second = self.loader.load_highway_graph()
        assert np.array_equal(first["node_features"], second["node_features"])
        assert np.array_equal(first["edge_index"], second["edge_index"])

    def test_edges_are_bidirectional(self):
        """Every edge in one direction must have a reverse edge."""
        graph = self.loader.load_highway_graph()
        edge_index = graph["edge_index"]
        edges = set(zip(edge_index[0].tolist(), edge_index[1].tolist()))
        for src, dst in list(edges):
            assert (dst, src) in edges
