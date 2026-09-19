import os
import sys

import networkx as nx

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


class _FakeFormatter:
    def __init__(self):
        self.graph = None

    def formulate_route_optimization(self, graph):
        self.graph = graph
        return object()

    def solve_qubo(self, qubo):
        return {
            "success": True,
            "solution": [],
            "variables": [],
            "edge_mapping": [],
            "objective": 1.0,
        }


def test_route_service_preserves_parallel_edges():
    from quantum_service import QuantumService

    service = QuantumService.__new__(QuantumService)
    formatter = _FakeFormatter()
    service.qubo_formatter = formatter
    service._extract_route = lambda result, node_ids: ["A", "B", "C", "A"]

    result = service.solve_route_optimization(
        nodes=[
            {"id": "A"},
            {"id": "B"},
            {"id": "C"},
        ],
        edges=[
            {"id": "road-slow", "source": "A", "target": "B", "distance": 100.0},
            {"id": "road-fast", "source": "A", "target": "B", "distance": 1.0},
            {"id": "road-bc", "source": "B", "target": "C", "distance": 1.0},
            {"id": "road-ca", "source": "C", "target": "A", "distance": 1.0},
        ],
    )

    graph = formatter.graph
    assert result["success"] is True
    assert isinstance(graph, nx.MultiGraph)
    assert graph.number_of_edges() == 4
    assert graph.number_of_edges("A", "B") == 2

    ab_edges = graph.get_edge_data("A", "B")
    assert {data["edge_id"] for data in ab_edges.values()} == {
        "road-slow",
        "road-fast",
    }
