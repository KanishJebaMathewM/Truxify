"""Actual native operator geometry, preallocation admission and router contracts."""
import importlib.util
import random
import sys
from pathlib import Path

import pytest
import torch
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from nas.construction_plan import NASPlanError
from nas.model import NASModel


def architecture(ops=('conv3x3',), filters=(3,), activations=('relu',)):
    return {'layers':list(ops), 'filters':list(filters), 'activations':list(activations)}


def profile_cost(model, batch=1):
    x = torch.ones((batch, *model.input_shape), dtype=next(model.parameters()).dtype)
    with torch.profiler.profile(activities=[torch.profiler.ProfilerActivity.CPU], with_flops=True) as profiler:
        output = model(x)
    assert output.shape == (batch, 10)
    return sum(event.flops for event in profiler.key_averages()
               if event.key in {'aten::conv2d','aten::addmm','aten::mm','aten::bmm'})


@pytest.mark.parametrize('shape,expected', [((1,5,7),1950),((1,50,70),189060),((1,7,5),1950)])
def test_rectangular_cost_matches_actual_native_profiler(shape, expected):
    model = NASModel(architecture(), shape)
    assert model.get_flops() == expected == profile_cost(model)
    assert model.get_params() == 70
    assert profile_cost(model, 3) == expected * 3


@pytest.mark.parametrize('operation', ['conv3x3','conv5x5','conv7x7','maxpool3x3','avgpool3x3','identity','zero'])
@pytest.mark.parametrize('activation', ['relu','tanh','sigmoid','swish'])
def test_every_existing_operation_activation_preserves_native_cost_and_registered_parameter_count(operation, activation):
    model = NASModel(architecture([operation], [4], [activation]), (2,5,7))
    assert profile_cost(model) == model.get_flops()
    if operation.startswith('conv'):
        kernel = int(operation[4])
        expected_params = (2 * 4 * kernel ** 2 + 4) + 4 * 10 + 10
    else:
        expected_params = 2 * 10 + 10
    assert model.get_params() == expected_params


def test_seeded_mixed_genotypes_match_actual_native_operator_shape_costs():
    generator = random.Random(17781)
    operations = ['conv3x3','conv5x5','conv7x7','maxpool3x3','avgpool3x3','identity','zero']
    for _ in range(20):
        count = generator.randint(1, 4)
        arch = architecture([generator.choice(operations) for _ in range(count)],
                            [generator.randint(1, 6) for _ in range(count)],
                            [generator.choice(['relu','tanh','sigmoid','swish']) for _ in range(count)])
        shape = (generator.randint(1,3), generator.randint(2,8), generator.randint(2,9))
        model = NASModel(arch, shape)
        assert profile_cost(model) == model.get_flops()


@pytest.mark.parametrize('policy', [{'max_parameters':69},{'max_flops':1949},{'max_activation_values':104},
    {'max_parameters':0},{'max_flops':True},{'max_batch_size':0},{'max_activation_values':None}])
def test_complete_plan_rejects_before_native_rng_or_weight_allocation(policy):
    rng = torch.random.get_rng_state().clone()
    with pytest.raises(NASPlanError):
        NASModel(architecture(), (1,5,7), **policy)
    assert torch.equal(rng, torch.random.get_rng_state())


@pytest.mark.parametrize('shape', [(), (1,2), (1,2,3,4), (True,5,7), (0,5,7), (-1,5,7),
    (1,1.5,7), (1,float('inf'),7), (1,8193,7), (4097,5,7)])
def test_invalid_shape_rejects_before_native_parameter_allocation(shape):
    rng = torch.random.get_rng_state().clone()
    with pytest.raises(NASPlanError):
        NASModel(architecture(), shape)
    assert torch.equal(rng, torch.random.get_rng_state())


def test_unbounded_genotype_width_and_depth_reject_before_native_allocation():
    for arch in [architecture(filters=[4097]), architecture(['identity']*129,[1]*129,['relu']*129),
                 architecture(['conv7x7','conv7x7'],[4096,4096],['relu','relu'])]:
        rng = torch.random.get_rng_state().clone()
        with pytest.raises(NASPlanError):
            NASModel(arch)
        assert torch.equal(rng, torch.random.get_rng_state())


def test_complete_late_stage_budget_is_admitted_before_first_conv_allocates():
    # First stage fits, but the complete second stage is beyond the declared budget.
    arch = architecture(['conv3x3','conv7x7'], [3,4], ['relu','relu'])
    rng = torch.random.get_rng_state().clone()
    with pytest.raises(NASPlanError):
        NASModel(arch, (1,5,7), max_parameters=100)
    assert torch.equal(rng, torch.random.get_rng_state())


def test_exact_parameter_flop_and_activation_boundaries_accept():
    model = NASModel(architecture(), (1,5,7), max_parameters=70,max_flops=1950,max_activation_values=105)
    assert profile_cost(model) == 1950
    with pytest.raises(NASPlanError):
        model(torch.ones((2,1,5,7)))


@pytest.mark.parametrize('value', [torch.ones((1,1,50,70)),torch.ones((0,1,5,7)),
    torch.ones((1,2,5,7)),torch.ones((1,1,5,7),dtype=torch.float64),torch.ones((1,1,5,7),dtype=torch.bool),
    torch.full((1,1,5,7),float('nan')),torch.ones((1,5,7))])
def test_native_forward_rejects_unadmitted_geometry_dtype_or_data_before_execution(value):
    model = NASModel(architecture(), (1,5,7))
    rng = torch.random.get_rng_state().clone()
    with pytest.raises(NASPlanError):
        model(value)
    assert torch.equal(rng, torch.random.get_rng_state())


def test_batch_work_activation_and_count_are_independently_bounded():
    for policy in [{'max_flops':3900},{'max_activation_values':210},{'max_batch_size':2}]:
        model = NASModel(architecture(),(1,5,7),**policy)
        assert model(torch.ones((2,1,5,7))).shape == (2,10)
        with pytest.raises(NASPlanError):
            model(torch.ones((3,1,5,7)))


def test_rebuild_replaces_registered_network_instead_of_appending_and_preserves_state_keys():
    model = NASModel(architecture(),(1,5,7))
    keys = set(model.state_dict())
    before = len(model.layers)
    model.build_model()
    assert len(model.layers) == before
    assert set(model.state_dict()) == keys
    assert model.get_params() == 70
    assert profile_cost(model) == model.get_flops()


def test_owned_declared_metadata_cannot_be_changed_through_caller_or_outward_views():
    arch = architecture()
    shape = [1,5,7]
    model = NASModel(arch,shape)
    arch['filters'][0] = 3000
    shape[1] = 50
    view = model.architecture
    view['layers'][0] = 'zero'
    view['filters'][0] = 100
    assert model.input_shape == (1,5,7)
    assert model.architecture == architecture()
    assert profile_cost(model) == 1950


def test_checkpoint_parameter_keys_and_valid_native_predictions_remain_compatible():
    model = NASModel(architecture(),(1,5,7))
    clone = NASModel(architecture(),(1,5,7))
    assert set(model.state_dict()) == {'layers.0.weight','layers.0.bias','layers.4.weight','layers.4.bias'}
    clone.load_state_dict(model.state_dict())
    x = torch.rand((2,1,5,7))
    assert torch.equal(model(x),clone(x))


def test_actual_build_router_reports_geometry_cost_and_client_rejection():
    spec = importlib.util.spec_from_file_location('native_nas_plan_routes',ROOT/'routes/nas_routes.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    app = FastAPI();app.include_router(module.router)
    with TestClient(app) as client:
        response = client.post('/nas/build-model',json=architecture())
        assert response.status_code == 200
        # Existing route builds one-channel 28x28 models.
        assert response.json()['data']['flops'] == 2*28*28*3*9 + 2*3*10
        assert response.json()['data']['parameters'] == 70
        assert client.post('/nas/build-model',json=architecture(filters=[4097])).status_code == 422
