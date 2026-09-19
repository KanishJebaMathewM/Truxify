import ast
import os
import sys

import networkx as nx
import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from quantum_circuit import QUBOFormatter  # noqa: E402

from qiskit_algorithms.minimum_eigensolvers import NumPyMinimumEigensolver  # noqa: E402

QUANTUM_CIRCUIT_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "quantum_circuit.py")
)

CONFLICT_MARKERS = ("<<<<<<<", "=======", ">>>>>>>")


def _selected_edges(formatter, result):
    """Map a solver result back to the set of selected graph edges."""
    selected = set()
    for edge, value in zip(result["edge_mapping"], result["solution"]):
        if value is not None and abs(value - 1) < 1e-6:
            selected.add(tuple(edge[:2]))
    return selected


def _node_degrees(edges, nodes):
    deg = {n: 0 for n in nodes}
    for u, v in edges:
        deg[u] += 1
        deg[v] += 1
    return deg


def _square_graph():
    g = nx.Graph()
    g.add_edge('A', 'B', weight=1.0)
    g.add_edge('B', 'C', weight=2.0)
    g.add_edge('C', 'D', weight=1.0)
    g.add_edge('D', 'A', weight=2.0)
    return g


def test_route_optimization_non_empty_cycle():
    formatter = QUBOFormatter()
    graph = _square_graph()

    qubo = formatter.formulate_route_optimization(graph)
    result = formatter.solve_qubo(qubo, eigensolver=NumPyMinimumEigensolver())

    assert result['success'] is True
    selected = _selected_edges(formatter, result)

    # A valid route must select at least one edge (not the empty route).
    assert len(selected) >= 1

    # Every node must have degree exactly 2 -> a single cycle.
    degrees = _node_degrees(selected, list(graph.nodes()))
    assert all(d == 2 for d in degrees.values())


def test_module_has_no_merge_conflict_markers():
    with open(QUANTUM_CIRCUIT_PATH, "r", encoding="utf-8") as fh:
        source = fh.read()

    for marker in CONFLICT_MARKERS:
        assert marker not in source, (
            f"merge conflict marker {marker!r} found in quantum_circuit.py"
        )


def test_module_parses_and_has_single_solve_qubo():
    with open(QUANTUM_CIRCUIT_PATH, "r", encoding="utf-8") as fh:
        source = fh.read()

    module = ast.parse(source)

    # A single QUBOFormatter class should contain exactly one solve_qubo
    # method and expose formulate_route_optimization.
    formatters = [
        n
        for n in module.body
        if isinstance(n, ast.ClassDef) and n.name == "QUBOFormatter"
    ]
    assert len(formatters) == 1, (
        f"expected exactly one QUBOFormatter class, found {len(formatters)}"
    )

    formatter_methods = [
        item
        for item in formatters[0].body
        if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef))
    ]
    solve_defs = [
        item for item in formatter_methods if item.name == "solve_qubo"
    ]
    assert len(solve_defs) == 1, (
        f"expected exactly one QUBOFormatter.solve_qubo method, found {len(solve_defs)}"
    )

    assert any(
        isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef))
        and item.name == "formulate_route_optimization"
        for item in formatters[0].body
    )


def test_route_optimization_triangle():
    formatter = QUBOFormatter()
    graph = nx.Graph()
    graph.add_edge('A', 'B', weight=1.0)
    graph.add_edge('B', 'C', weight=1.0)
    graph.add_edge('C', 'A', weight=1.0)

    qubo = formatter.formulate_route_optimization(graph)
    result = formatter.solve_qubo(qubo, eigensolver=NumPyMinimumEigensolver())

    assert result['success'] is True
    selected = _selected_edges(formatter, result)
    assert len(selected) >= 1
    degrees = _node_degrees(selected, list(graph.nodes()))
    assert all(d == 2 for d in degrees.values())


def test_multigraph_keeps_parallel_edges_distinct():
    formatter = QUBOFormatter()
    graph = nx.MultiGraph()
    graph.add_edge("A", "B", key="slow", weight=100.0)
    graph.add_edge("A", "B", key="fast", weight=1.0)
    graph.add_edge("B", "C", key="bc", weight=1.0)
    graph.add_edge("C", "D", key="cd", weight=1.0)
    graph.add_edge("D", "A", key="da", weight=1.0)
    graph.add_edge("B", "D", key="bd", weight=5.0)
    graph.add_edge("A", "C", key="ac", weight=5.0)

    qubo = formatter.formulate_route_optimization(graph)
    assert len(formatter.variables) == graph.number_of_edges()
    assert len(set(formatter.variables)) == graph.number_of_edges()
    assert len(set(formatter.edge_mapping)) == graph.number_of_edges()

    result = formatter.solve_qubo(
        qubo,
        eigensolver=NumPyMinimumEigensolver(),
    )

    assert result["success"] is True
    selected = {
        tuple(edge)
        for edge, value in zip(result["edge_mapping"], result["solution"])
        if value is not None and abs(value - 1) < 1e-6
    }
    assert ("A", "B", "fast") in selected
    assert ("A", "B", "slow") not in selected
