import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from quantum_service import QuantumService


def test_extract_route_rejects_a_connected_subset_when_a_declared_node_is_unvisited():
    service = QuantumService.__new__(QuantumService)

    result = {
        "solution": [1, 1, 1],
        "variables": ["x_A_B", "x_B_C", "x_C_A"],
    }

    assert service._extract_route(result, ["A", "B", "C", "D"]) is None


def test_extract_route_accepts_a_connected_route_covering_all_declared_nodes():
    service = QuantumService.__new__(QuantumService)

    result = {
        "solution": [1, 1, 1, 1],
        "variables": ["x_A_B", "x_B_C", "x_C_D", "x_D_A"],
    }

    assert service._extract_route(result, ["A", "B", "C", "D"]) == ["A", "B", "C", "D", "A"]
