import os
import sys

import networkx as nx
import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from quantum_circuit import QUBOFormatter  # noqa: E402

from qiskit_optimization.algorithms import ScipyMilpOptimizer  # noqa: E402


def _selected_edges(formatter, result):
    """Map a solver result back to the set of selected graph edges."""
    selected = set()
    for var_name, value in zip(result["variables"], result["solution"]):
        if value is not None and abs(value - 1) < 1e-6:
            _, u, v = var_name.split('_')
            selected.add((u, v))
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


def test_formulation_adds_constraints():
    """The route QUBO must constrain the edges (degree == 2) so the trivial
    empty route (all x_i = 0) is no longer a feasible optimum."""
    formatter = QUBOFormatter()
    qubo = formatter.formulate_route_optimization(_square_graph())

    # Previously the program had no constraints and the empty route was optimal.
    assert len(qubo.linear_constraints) > 0


def test_route_optimization_non_empty_route():
    """The optimizer must return a non-empty, valid route (not all x_i = 0)."""
    formatter = QUBOFormatter()
    graph = nx.Graph()
    graph.add_edge('A', 'B', weight=1.0)
    graph.add_edge('B', 'C', weight=1.0)
    graph.add_edge('C', 'A', weight=1.0)

    qubo = formatter.formulate_route_optimization(graph)
    result = formatter.solve_qubo(qubo, eigensolver=NumPyMinimumEigensolver())

    assert result['success'] is True
    selected = _selected_edges(formatter, result)

    # A valid route must select at least one edge (not the empty route).
    assert len(selected) >= 1

    # Every node must have degree exactly 2 -> a single cycle.
    degrees = _node_degrees(selected, list(graph.nodes()))
    assert all(d == 2 for d in degrees.values())


def _nine_node_graph():
    graph = nx.Graph()
    cheap_cycle = ["n0", "n1", "n2"]
    for u, v in zip(cheap_cycle, cheap_cycle[1:] + cheap_cycle[:1]):
        graph.add_edge(u, v, weight=1.0)

    second_cycle = ["n3", "n4", "n5", "n6", "n7", "n8"]
    for u, v in zip(second_cycle, second_cycle[1:] + second_cycle[:1]):
        graph.add_edge(u, v, weight=1.0)

    graph.add_edge("n2", "n3", weight=100.0)
    graph.add_edge("n8", "n0", weight=100.0)
    return graph


def test_route_qubo_scales_connectivity_without_subset_cutoff():
    formatter = QUBOFormatter()
    graph = _nine_node_graph()

    qubo = formatter.formulate_route_optimization(graph)

    variable_names = {variable.name for variable in qubo.variables}
    assert any(name.startswith("flow_") for name in variable_names)
    assert len(variable_names) == len(graph.edges()) + (2 * len(graph.edges()))

    constraint_names = {constraint.name for constraint in qubo.linear_constraints}
    assert "flow_conservation_root" in constraint_names
    capacity_constraints = [
        name for name in constraint_names
        if name.startswith("flow_capacity_")
    ]
    assert len(capacity_constraints) == 2 * len(graph.edges())

    result = formatter.solve_qubo(
        qubo,
        eigensolver=ScipyMilpOptimizer(),
    )
    assert result["success"] is True

    selected = _selected_edges(formatter, result)
    assert len(selected) == len(graph.nodes())

    selected_graph = nx.Graph()
    selected_graph.add_nodes_from(graph.nodes())
    selected_graph.add_edges_from(selected)

    # A valid degree-2 route over all nodes must be one connected cycle,
    # not the two disconnected cycles that the old cutoff allowed.
    assert nx.is_connected(selected_graph)
    degrees = _node_degrees(selected, list(graph.nodes()))
    assert all(degree == 2 for degree in degrees.values())


def test_route_qubo_rejects_disconnected_graph():
    formatter = QUBOFormatter()
    graph = nx.Graph()
    graph.add_edges_from([
        ("a", "b"),
        ("b", "c"),
        ("c", "a"),
        ("d", "e"),
        ("e", "f"),
        ("f", "d"),
    ])

    with pytest.raises(ValueError, match="connected graph"):
        formatter.formulate_route_optimization(graph)
