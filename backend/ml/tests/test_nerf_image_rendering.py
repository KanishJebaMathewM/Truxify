"""Native ordered image execution, allocation lifetime and mounted camera controls."""
import base64
import io
import weakref

import pytest
import torch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from nerf.camera import CameraPose
from nerf.image_rendering import ImageAdmissionError, scene_policy
from nerf.model import NeRFNetwork, NeRFRenderer
from PIL import Image


def native(dtype=torch.float32, samples=64):
    torch.manual_seed(9)
    model = NeRFNetwork(num_frequencies=2, num_dir_frequencies=1, hidden_dim=16,
                        num_layers=3, skip_layer=1).to(dtype)
    # A positive native density lets the RGB/depth reference exercise nonzero weights.
    with torch.no_grad():
        model.density_head.weight.zero_()
        model.density_head.bias.fill_(.3)
    return NeRFRenderer(model, num_samples=samples, device='cpu')


def rays(dtype=torch.float32, h=32, w=32):
    data = CameraPose([0, 0, 2], [0, 0, 0]).get_rays(60, (h, w))
    return {k: torch.tensor(data[k], dtype=dtype) for k in ('origins', 'directions')}


@pytest.mark.parametrize('dtype', [torch.float32, torch.float64])
@pytest.mark.parametrize('samples', [1, 3, 64])
def test_chunked_image_matches_independent_full_native_render(dtype, samples):
    renderer = native(dtype, samples)
    data = rays(dtype)
    expected = renderer.render_rays(data['origins'][None], data['directions'][None])
    actual = renderer.render_image(data, (32, 32))
    torch.testing.assert_close(actual['rgb'], expected['rgb'].reshape(32, 32, 3))
    torch.testing.assert_close(actual['depth'], expected['depth'].reshape(32, 32))
    for key in ('weights', 'alpha'):
        torch.testing.assert_close(actual[key], expected[key].reshape(32, 32, samples))
    assert not actual['rgb'].requires_grad and not actual['depth'].requires_grad


def test_actual_query_bound_and_intermediate_retirement():
    renderer = native()
    queries, previous = [], []
    def observe(model, args):
        assert all(reference() is None for reference in previous)
        previous[:] = [weakref.ref(value) for value in args]
        queries.append(args[0].shape[0])
    handle = renderer.model.register_forward_pre_hook(observe)
    try:
        result = renderer.render_image(rays(), (32, 32))
    finally:
        handle.remove()
    assert len(queries) == 4 and max(queries) <= 16_384
    assert sum(queries) == 32 * 32 * 64
    assert all(reference() is None for reference in previous)
    assert result['rgb'].shape == (32, 32, 3)


def test_complete_owned_image_survives_caller_mutation_during_first_native_query():
    renderer = native()
    data = rays()
    expected = renderer.render_image(data, (32, 32))
    entered = []
    def mutate(model, args):
        if not entered:
            entered.append(True)
            data['origins'].fill_(float('nan'))
            data['directions'].zero_()
    handle = renderer.model.register_forward_pre_hook(mutate)
    try:
        actual = renderer.render_image(data, (32, 32))
    finally:
        handle.remove()
    torch.testing.assert_close(actual['rgb'], expected['rgb'])
    torch.testing.assert_close(actual['depth'], expected['depth'])


@pytest.mark.parametrize('kind', ['late_nan', 'late_zero', 'wrong_count', 'wrong_batch', 'wrong_dtype'])
def test_complete_rejection_precedes_first_native_query(kind):
    renderer = native()
    data = rays()
    if kind == 'late_nan': data['origins'][-1, 0] = float('nan')
    if kind == 'late_zero': data['directions'][-1].zero_()
    if kind == 'wrong_count': data['origins'] = data['origins'][:-1]
    if kind == 'wrong_batch': data = {k: v[None].repeat(2, 1, 1) for k, v in data.items()}
    if kind == 'wrong_dtype': data['origins'] = data['origins'].double()
    queries = []
    handle = renderer.model.register_forward_pre_hook(lambda m, a: queries.append(True))
    try:
        with pytest.raises(ImageAdmissionError): renderer.render_image(data, (32, 32))
    finally:
        handle.remove()
    assert not queries


def test_existing_batched_single_image_and_camera_flat_have_same_outputs():
    renderer = native(samples=3)
    data = rays(h=3, w=5)
    flat = renderer.render_image(data, (3, 5))
    batched = renderer.render_image({k: v[None] for k, v in data.items()}, (3, 5))
    for key in flat: torch.testing.assert_close(flat[key], batched[key])


def test_default_scene_admitted_and_combined_work_rejected():
    assert scene_policy(30, [256, 256], 64) == (256, 256)
    with pytest.raises(ImageAdmissionError): scene_policy(31, [256, 256], 64)


@pytest.fixture(scope='module')
def mounted():
    from routes import nerf_routes as route
    app = FastAPI()
    app.include_router(route.router)
    with TestClient(app) as client:
        yield client, route


@pytest.mark.parametrize('path', ['spiral', 'orbital'])
def test_actual_camera_to_jpeg_and_depth_endpoint(mounted, path):
    client, route = mounted
    response = client.post('/nerf/render/' + path, json={'num_poses': 1, 'image_size': [8, 8]})
    assert response.status_code == 200, response.text
    frame = response.json()['data']['frames'][0]
    image = Image.open(io.BytesIO(base64.b64decode(frame['image'])))
    assert image.size == (8, 8) and image.format == 'JPEG'
    assert torch.tensor(frame['depth']).shape == (8, 8)
    assert route._operation_lock.acquire(blocking=False)
    route._operation_lock.release()


@pytest.mark.parametrize('payload', [
    {'num_poses': 121}, {'num_poses': True}, {'image_size': [1025, 1]},
    {'image_size': [256]}, {'image_size': [True, 8]},
    {'num_poses': 31, 'image_size': [256, 256]}, {'radius': -1},
])
@pytest.mark.parametrize('path', ['spiral', 'orbital'])
def test_scene_rejected_before_pose_or_ray_allocation(mounted, monkeypatch, payload, path):
    client, route = mounted
    def forbidden(*args, **kwargs):
        pytest.fail('rejected scene allocated camera poses')
    monkeypatch.setattr(route, 'create_' + path + '_poses', forbidden)
    response = client.post('/nerf/render/' + path, json=payload)
    assert response.status_code == 422, response.text


def test_video_contract_and_optional_sample_storage():
    renderer = native(samples=3)
    data = rays(h=3, w=5)
    frames = renderer.render_video([data, data], (3, 5))
    assert len(frames) == 2 and set(frames[0]) == {'rgb', 'depth', 'weights', 'alpha'}
    assert renderer.render_video([], (3, 5)) == []
    lean = renderer.render_image(data, (3, 5), include_samples=False)
    assert set(lean) == {'rgb', 'depth'}
    for key in lean: torch.testing.assert_close(lean[key], frames[0][key])


def test_retained_sample_budget_rejects_before_camera_storage():
    renderer = native()
    with pytest.raises(ImageAdmissionError, match='retained'):
        renderer.render_image({}, (1024, 1024))


def test_nonfinite_native_model_output_is_generic_internal_failure(mounted):
    client, route = mounted
    original = route.model.density_head.bias.detach().clone()
    try:
        with torch.no_grad(): route.model.density_head.bias.fill_(float('nan'))
        response = client.post('/nerf/render/spiral', json={'num_poses': 1, 'image_size': [2, 2]})
        assert response.status_code == 500
        assert response.json() == {'detail': 'Internal server error'}
    finally:
        with torch.no_grad(): route.model.density_head.bias.copy_(original)


@pytest.mark.parametrize('path', ['spiral', 'orbital'])
def test_camera_handoff_matches_native_model_precision(mounted, path):
    client, route = mounted
    previous = next(route.model.parameters()).dtype
    try:
        route.model.to(torch.float64)
        response = client.post('/nerf/render/' + path, json={'num_poses': 1, 'image_size': [2, 2]})
        assert response.status_code == 200, response.text
        assert len(response.json()['data']['frames']) == 1
    finally:
        route.model.to(previous)
