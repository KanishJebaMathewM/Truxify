import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from quantum_service import QuantumService


class RecordingFormatter:
    def __init__(self):
        self.formulate_called = False

    def formulate_route_optimization(self, graph):
        self.formulate_called = True
        return object()

    def solve_qubo(self, qubo):
        raise AssertionError("solve_qubo must not be called for invalid edge endpoints")


def test_solve_route_optimization_rejects_undeclared_edge_endpoints():
    service = QuantumService.__new__(QuantumService)
    formatter = RecordingFormatter()
    service.qubo_formatter = formatter

    result = service.solve_route_optimization(
        nodes=[{"id": "A"}, {"id": "B"}],
        edges=[{"source": "A", "target": "C", "distance": 10}],
    )

    assert result["success"] is False
    assert "declared node" in result["error"]
    assert formatter.formulate_called is False


def test_solve_route_optimization_rejects_missing_edge_endpoints():
    service = QuantumService.__new__(QuantumService)
    formatter = RecordingFormatter()
    service.qubo_formatter = formatter

    result = service.solve_route_optimization(
        nodes=[{"id": "A"}, {"id": "B"}],
        edges=[{"source": "A"}],
    )

    assert result["success"] is False
    assert "declared node" in result["error"]
    assert formatter.formulate_called is False
