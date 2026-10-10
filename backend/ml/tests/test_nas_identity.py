from copy import deepcopy
import random
import pytest
import torch
from nas.model import NASSearchSpace, NASSearcher, NASModel


def genotype(size=3):
    return {'layers': ['conv3x3'] * size, 'filters': [32] * size,
            'activations': ['relu'] * size}


def score(arch):
    return sum((i + 1) * width for i, width in enumerate(arch['filters'])) + sum(
        NASSearchSpace().operations.index(op) for op in arch['layers'])


def test_neighbor_identity_and_single_gene_distance():
    random.seed(7)
    space = NASSearchSpace()
    parent = genotype()
    before = deepcopy(parent)
    neighbors = space.generate_neighbor_architectures(parent)
    assert parent == before
    assert len({space.encode_architecture(a) for a in neighbors}) == len(neighbors)
    for neighbor in neighbors:
        assert sum(x != y for key in before for x, y in zip(before[key], neighbor[key])) == 1
    snapshot = deepcopy(neighbors)
    neighbors[0]['layers'][0] = 'changed'
    assert neighbors[1:] == snapshot[1:]
    assert parent == before


@pytest.mark.parametrize('change', [
    {'layers': []}, {'filters': [32]}, {'activations': ['relu']},
    {'layers': ['unknown'] * 3}, {'activations': ['unknown'] * 3},
    {'filters': [True] * 3}, {'filters': [33] * 3}, {'filters': [8] * 3},
])
def test_genotype_admission_before_random_mutation(change):
    space = NASSearchSpace()
    arch = genotype() | change
    before, rng = deepcopy(arch), random.getstate()
    with pytest.raises(ValueError):
        space.generate_neighbor_architectures(arch)
    assert arch == before and random.getstate() == rng


@pytest.mark.parametrize('size', [1, 3, 5])
def test_evolutionary_population_and_score_provenance(size):
    random.seed(19)
    searcher = NASSearcher(NASSearchSpace())
    retained = []

    def evaluator(arch):
        result = score(arch)
        retained.append(arch)
        arch['filters'][0] = 999  # deliberately corrupt only callback-owned data
        return result

    result = searcher.evolutionary_search(size, 4, evaluator)
    assert len(result['history']) == size * 4
    assert all(row['score'] == score(row['architecture']) for row in result['history'])
    assert [row['generation'] for row in result['history']] == [i for i in range(4) for _ in range(size)]
    assert result['best_score'] == max(row['score'] for row in result['history'])
    assert score(result['best_architecture']) == result['best_score']
    internal = deepcopy(searcher.search_history)
    winner = deepcopy(searcher.best_architecture)
    for arch in retained:
        arch['layers'].clear()
    result['best_architecture']['filters'][0] = -1
    result['history'][0]['architecture']['layers'].clear()
    assert searcher.search_history == internal and searcher.best_architecture == winner


def test_random_search_shared_sampler_and_fresh_history():
    space = NASSearchSpace()
    shared = genotype()
    space.sample_random_architecture = lambda: shared
    searcher = NASSearcher(space)
    result = searcher.random_search(4, score)
    shared['filters'][0] = 64
    assert all(row['architecture']['filters'][0] == 32 for row in result['history'])
    second = searcher.random_search(2, score)
    assert len(second['history']) == len(searcher.search_history) == 2
    assert all(row['architecture']['filters'][0] == 64 for row in second['history'])
    assert len(result['history']) == 4
    result['history'][0]['architecture']['filters'][0] = 123
    assert result['history'][1]['architecture']['filters'][0] == 32
    assert second['best_architecture']['filters'][0] == 64


@pytest.mark.parametrize('value', [0, -1, True, 1.5])
def test_budget_preflight_preserves_previous_state_and_rng(value):
    searcher = NASSearcher(NASSearchSpace())
    searcher.random_search(1, score)
    state = deepcopy(searcher.__dict__)
    rng = random.getstate()
    for call in [lambda: searcher.random_search(value),
                 lambda: searcher.evolutionary_search(value, 1),
                 lambda: searcher.evolutionary_search(1, value)]:
        with pytest.raises(ValueError):
            call()
        assert searcher.best_architecture == state['best_architecture']
        assert searcher.search_history == state['search_history']
        assert random.getstate() == rng


@pytest.mark.parametrize('value', [float('nan'), float('inf'), float('-inf'), None, True])
def test_bad_evaluator_does_not_publish_partial_search(value):
    searcher = NASSearcher(NASSearchSpace())
    searcher.random_search(1, score)
    prior = deepcopy(searcher.search_history), deepcopy(searcher.best_architecture), searcher.best_performance
    with pytest.raises(ValueError):
        searcher.evolutionary_search(3, 2, lambda _: value)
    assert (searcher.search_history, searcher.best_architecture, searcher.best_performance) == prior


def test_native_model_metadata_adam_backward_and_search_candidate():
    torch.manual_seed(17)
    arch = genotype()
    model = NASModel(arch, (1, 6, 8))
    metadata = deepcopy(model.architecture)
    arch['layers'][0] = 'identity'
    arch['filters'][0] = 248
    assert model.architecture == metadata
    inputs = torch.randn(2, 1, 6, 8)
    optimizer = torch.optim.Adam(model.parameters(), lr=0.001)
    before = [p.detach().clone() for p in model.parameters()]
    output = model(inputs)
    assert output.shape == (2, 10)
    output.square().mean().backward()
    optimizer.step()
    assert all(torch.isfinite(p).all() for p in model.parameters())
    assert any(not torch.equal(a, b) for a, b in zip(before, model.parameters()))


@pytest.mark.parametrize('length', [3, 10])
def test_mutation_bounds_and_parent_ownership(length):
    random.seed(47)
    space = NASSearchSpace()
    searcher = NASSearcher(space)
    parent = genotype(length)
    original = deepcopy(parent)
    for _ in range(300):
        child = searcher._mutate(parent)
        assert 3 <= len(child['layers']) <= 10
        assert len(child['layers']) == len(child['filters']) == len(child['activations'])
        child['filters'][0] = 999
        assert parent == original
    cross = searcher._crossover(parent, genotype())
    cross['layers'][0] = 'changed'
    assert parent == original


def test_actual_nas_route_reports_completed_evolutionary_history():
    from routes.nas_routes import router
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)
    response = client.post('/nas/search', json={'method': 'evolutionary', 'population_size': 1, 'generations': 3})
    assert response.status_code == 200
    data = response.json()['data']
    assert len(data['history']) == 3
    assert data['best_score'] == max(row['score'] for row in data['history'])
    assert client.get('/nas/history').json()['data']['total_trials'] == 3
