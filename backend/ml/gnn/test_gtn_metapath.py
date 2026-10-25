"""Independent ordered edge-pair walk oracle for the actual NumPy operator."""

import itertools
import math

import numpy as np
import pytest
from gtn_logistics import GraphTransformerNetworkLogisticsEmbedder


def oracle(graphs, logits):
    coefficients = []
    for row in logits:
        largest = max(row)
        terms = [math.exp(float(x) - float(largest)) for x in row]
        total = math.fsum(terms)
        coefficients.append([x / total for x in terms])
    nodes = len(graphs[0])
    result = np.zeros((nodes, nodes))
    for source, destination in itertools.product(range(nodes), repeat=2):
        result[source, destination] = math.fsum(
            coefficients[0][a]
            * coefficients[1][b]
            * float(graphs[a][source, middle])
            * float(graphs[b][middle, destination])
            for a, b, middle in itertools.product(
                range(len(graphs)), range(len(graphs)), range(nodes)
            )
        )
    return result


@pytest.mark.parametrize("relations", [1, 2, 4, 7])
def test_actual_path_operator_matches_explicit_walk_oracle(relations):
    rng = np.random.default_rng(140 + relations)
    for _ in range(20):
        graphs = [rng.integers(0, 4, size=(3, 3)) for _ in range(relations)]
        logits = rng.normal(0, 3, size=(2, relations))
        model = GraphTransformerNetworkLogisticsEmbedder(relations)
        model.edge_selection_weights = logits
        actual = model.compute_metapath_adjacencies(graphs)
        np.testing.assert_allclose(
            actual, oracle(graphs, logits), rtol=2e-14, atol=2e-14
        )


@pytest.mark.parametrize("relations", [1, 2, 4, 9])
def test_identical_relations_have_cardinality_independent_product(relations):
    graph = np.array([[0, 1], [2, 0]])
    model = GraphTransformerNetworkLogisticsEmbedder(relations)
    np.testing.assert_allclose(
        model.compute_metapath_adjacencies([graph] * relations), graph @ graph
    )


@pytest.mark.parametrize("dtype", [np.int32, np.int64, np.float32, bool])
def test_incidence_graph_dtypes_are_admitted(dtype):
    graph = np.array([[0, 1], [1, 0]], dtype=dtype)
    model = GraphTransformerNetworkLogisticsEmbedder(2)
    np.testing.assert_allclose(
        model.compute_metapath_adjacencies([graph] * 2), np.eye(2)
    )


def test_row_shift_relation_and_node_permutation_invariance():
    rng = np.random.default_rng(201)
    graphs = [rng.uniform(size=(4, 4)) for _ in range(3)]
    logits = rng.normal(size=(2, 3))
    model = GraphTransformerNetworkLogisticsEmbedder(3)
    model.edge_selection_weights = logits.copy()
    original = model.compute_metapath_adjacencies(graphs)
    model.edge_selection_weights = logits + np.array([[1000.0], [-1000.0]])
    np.testing.assert_allclose(
        model.compute_metapath_adjacencies(graphs), original, atol=2e-13
    )
    relation_order = [2, 0, 1]
    model.edge_selection_weights = logits[:, relation_order]
    np.testing.assert_allclose(
        model.compute_metapath_adjacencies([graphs[i] for i in relation_order]),
        original,
    )
    model.edge_selection_weights = logits
    node_order = [3, 1, 0, 2]
    permuted_graphs = [graph[np.ix_(node_order, node_order)] for graph in graphs]
    np.testing.assert_allclose(
        model.compute_metapath_adjacencies(permuted_graphs),
        original[np.ix_(node_order, node_order)],
    )


def test_directed_walk_order_is_preserved():
    a = np.array([[0.0, 1.0, 0.0], [0.0, 0.0, 0.0], [0.0, 0.0, 0.0]])
    b = np.array([[0.0, 0.0, 0.0], [0.0, 0.0, 1.0], [0.0, 0.0, 0.0]])
    model = GraphTransformerNetworkLogisticsEmbedder(2)
    model.edge_selection_weights = np.array([[1000.0, -1000.0], [-1000.0, 1000.0]])
    np.testing.assert_array_equal(model.compute_metapath_adjacencies([a, b]), a @ b)
    assert model.predict_link_probabilities([a, b], 0, 2) == round(
        1 / (1 + math.exp(-1)), 4
    )


def test_extreme_logits_and_unselected_huge_edges_do_not_erase_selected_graph():
    model = GraphTransformerNetworkLogisticsEmbedder(2)
    model.edge_selection_weights = np.array([[-1e308, 1e308], [-1e308, 1e308]])
    graphs = [np.array([[1e308]]), np.array([[1e-100]])]
    np.testing.assert_allclose(
        model.compute_metapath_adjacencies(graphs), [[1e-200]], atol=0, rtol=1e-14
    )


@pytest.mark.parametrize(
    "graphs",
    [
        [np.eye(2)],
        [np.eye(2), np.eye(3)],
        [np.ones((1, 2)), np.ones((1, 2))],
        [np.zeros((0, 0))] * 2,
        [np.eye(2), [[1.0, float("nan")], [0.0, 1.0]]],
        [np.eye(2), [[1.0, float("inf")], [0.0, 1.0]]],
        [np.eye(2), -np.eye(2)],
        [np.eye(2), [["1", "0"], ["0", "1"]]],
        [np.eye(2), np.eye(2, dtype=complex)],
    ],
)
def test_complete_invalid_graphs_reject(graphs):
    with pytest.raises(ValueError):
        GraphTransformerNetworkLogisticsEmbedder(2).compute_metapath_adjacencies(graphs)


@pytest.mark.parametrize(
    "logits",
    [
        np.ones((1, 2)),
        np.ones((2, 3)),
        [[0.0, float("nan")], [0.0, 0.0]],
        [[float("inf"), 0.0], [0.0, 0.0]],
    ],
)
def test_invalid_selection_model_reject(logits):
    model = GraphTransformerNetworkLogisticsEmbedder(2)
    model.edge_selection_weights = logits
    with pytest.raises(ValueError):
        model.compute_metapath_adjacencies([np.eye(2)] * 2)


@pytest.mark.parametrize("index", [-1, 2, True, 0.5, "0"])
def test_invalid_node_indices_reject(index):
    model = GraphTransformerNetworkLogisticsEmbedder(2)
    for source, destination in [(index, 0), (0, index)]:
        with pytest.raises(ValueError):
            model.predict_link_probabilities([np.eye(2)] * 2, source, destination)


def test_overflow_is_explicit_and_sources_remain_unchanged():
    model = GraphTransformerNetworkLogisticsEmbedder(2)
    graph = np.full((2, 2), 1e200)
    before_graph, before_logits = graph.copy(), model.edge_selection_weights.copy()
    with pytest.raises(OverflowError):
        model.compute_metapath_adjacencies([graph] * 2)
    np.testing.assert_array_equal(graph, before_graph)
    np.testing.assert_array_equal(model.edge_selection_weights, before_logits)


@pytest.mark.parametrize(
    "configuration",
    [{"num_edge_types": 0}, {"num_edge_types": True}, {"embedding_dim": -1}],
)
def test_invalid_configuration_reject(configuration):
    with pytest.raises(ValueError):
        GraphTransformerNetworkLogisticsEmbedder(**configuration)
