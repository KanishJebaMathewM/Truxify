"""Native configured NeRF and independent front-to-back integration oracles."""
import copy
import math

import pytest
import torch
from torch import nn
from torch.nn import functional as F

from nerf.model import NeRFNetwork, NeRFRenderer, NeRFTrainer


def native(skip=4, dtype=torch.float32):
    torch.manual_seed(18)
    return NeRFNetwork(1, 1, hidden_dim=8, num_layers=6, skip_layer=skip).to(dtype)


@pytest.mark.parametrize('skip', [0, 1, 2, 4, 9])
@pytest.mark.parametrize('dtype', [torch.float32, torch.float64])
def test_native_configured_skip_forward_backward_and_optimizer(skip, dtype):
    model = native(skip, dtype)
    points = torch.randn(5, 3, dtype=dtype); dirs = torch.randn(5, 3, dtype=dtype)
    encoded = model.pos_encoder(points); x = encoded
    for index in range(6):
        if index == skip and index > 0: x = torch.cat([x, encoded], -1)
        linear = model.density_layers[2 * index]
        x = F.relu(F.linear(x, linear.weight, linear.bias))
    expected_density = F.linear(x, model.density_head.weight, model.density_head.bias)
    expected_color = model.color_layers(torch.cat([x, model.dir_encoder(dirs)], -1))
    density, color = model(points, dirs)
    torch.testing.assert_close(density, expected_density); torch.testing.assert_close(color, expected_color)
    optimizer = torch.optim.Adam(model.parameters(), lr=.01)
    (density.square().mean() + color.square().mean()).backward()
    assert all(p.grad is not None and torch.isfinite(p.grad).all() for p in model.parameters())
    optimizer.step(); assert optimizer.state


class AnalyticField(nn.Module):
    """Tiny actual differentiable field with a known density/color function."""
    def __init__(self, density, dtype=torch.float64):
        super().__init__(); self.sigma = nn.Parameter(torch.tensor(density, dtype=dtype))

    def forward(self, points, directions):
        density = self.sigma.expand(len(points), 1)
        color = torch.sigmoid(points)
        return density, color


def scalar_integral(sigma, origins, directions, near, far, samples):
    t = torch.linspace(near, far, samples, dtype=origins.dtype)
    rgbs = []; depths = []; all_weights = []; all_alpha = []
    for origin_batch, direction_batch in zip(origins, directions):
        rgb_rows = []; depth_rows = []; weight_rows = []; alpha_rows = []
        for origin, direction in zip(origin_batch, direction_batch):
            transmittance = 1.; rgb = torch.zeros(3, dtype=origins.dtype); depth = 0.
            weights = []; alphas = []
            for index in range(samples):
                length = ((t[index + 1] - t[index]).item() if index + 1 < samples else 1e10)
                attenuation = max(sigma, 0) * length * direction.norm().item()
                alpha = -math.expm1(-attenuation); weight = transmittance * alpha
                weights.append(weight); alphas.append(alpha)
                rgb += weight * torch.sigmoid(origin + direction * t[index])
                depth += weight * t[index].item(); transmittance *= math.exp(-attenuation)
            rgb_rows.append(rgb); depth_rows.append(depth); weight_rows.append(weights); alpha_rows.append(alphas)
        rgbs.append(torch.stack(rgb_rows)); depths.append(depth_rows); all_weights.append(weight_rows); all_alpha.append(alpha_rows)
    return {'rgb': torch.stack(rgbs), 'depth': torch.tensor(depths, dtype=origins.dtype),
            'weights': torch.tensor(all_weights, dtype=origins.dtype),
            'alpha': torch.tensor(all_alpha, dtype=origins.dtype)}


@pytest.mark.parametrize('batch,rays,samples', [(1, 1, 1), (1, 2, 3), (2, 3, 4)])
@pytest.mark.parametrize('sigma', [-1., 0., .3, 1000.])
def test_native_renderer_matches_independent_scalar_volume_integral(batch, rays, samples, sigma):
    model = AnalyticField(sigma)
    renderer = NeRFRenderer(model, near=.1, far=2., num_samples=samples, device='cpu')
    torch.manual_seed(22)
    origins = torch.randn(batch, rays, 3, dtype=torch.float64)
    directions = torch.randn(batch, rays, 3, dtype=torch.float64)
    actual = renderer.render_rays(origins, directions)
    expected = scalar_integral(sigma, origins, directions, .1, 2., samples)
    for key in expected: torch.testing.assert_close(actual[key], expected[key], rtol=1e-10, atol=1e-10)
    assert actual['rgb'].shape == (batch, rays, 3)
    assert actual['depth'].shape == (batch, rays)
    assert actual['weights'].shape == actual['alpha'].shape == (batch, rays, samples)
    assert all(torch.isfinite(value).all() for value in actual.values())
    assert (actual['weights'] >= 0).all() and (actual['weights'].sum(-1) <= 1 + 1e-12).all()
    if sigma <= 0: assert torch.equal(actual['rgb'], torch.zeros_like(actual['rgb']))
    if sigma == 1000. and samples > 1: torch.testing.assert_close(actual['weights'][..., 0], torch.ones(batch, rays, dtype=torch.float64))


@pytest.mark.parametrize('bad', ['shape', 'rows', 'empty', 'nan', 'zero', 'dtype', 'samples_zero', 'samples_bool'])
def test_invalid_ray_admission_rejected_before_network_query(bad):
    model = native(); calls = []; hook = model.register_forward_hook(lambda *_: calls.append(1))
    renderer = NeRFRenderer(model, num_samples=3, device='cpu')
    origin = torch.ones(1, 2, 3); direction = origin.clone(); kwargs = {}
    if bad == 'shape': origin = origin[0]; direction = direction[0]
    elif bad == 'rows': direction = direction[:, :1]
    elif bad == 'empty': origin = origin[:, :0]; direction = direction[:, :0]
    elif bad == 'nan': origin[0, -1, 0] = float('nan')
    elif bad == 'zero': direction.zero_()
    elif bad == 'dtype': direction = direction.double()
    elif bad == 'samples_zero': kwargs['num_samples'] = 0
    elif bad == 'samples_bool': kwargs['num_samples'] = True
    try:
        with pytest.raises(ValueError): renderer.render_rays(origin, direction, **kwargs)
    finally: hook.remove()
    assert not calls


@pytest.mark.parametrize('near,far,samples', [(-1., 2., 3), (1., 1., 3), (2., 1., 3), (float('nan'), 2., 3), (.1, 2., 0)])
def test_invalid_renderer_configuration(near, far, samples):
    with pytest.raises(ValueError): NeRFRenderer(native(), near, far, samples, device='cpu')


def test_actual_network_image_and_native_trainer_checkpoint_compatibility(tmp_path):
    model = native(); before_keys = list(model.state_dict())
    trainer = NeRFTrainer(model, device='cpu')
    points = torch.randn(4, 3); directions = torch.randn(4, 3)
    loss = trainer.train_step(points, directions, torch.rand(4, 3))
    assert math.isfinite(loss) and trainer.optimizer.state
    path = tmp_path / 'nerf.pth'; trainer.save(path)
    restored = native(); other = NeRFTrainer(restored, device='cpu'); other.load(path)
    assert list(restored.state_dict()) == before_keys
    for a, b in zip(model(points, directions), restored(points, directions)): torch.testing.assert_close(a, b)
    renderer = NeRFRenderer(restored, num_samples=3, device='cpu')
    image = renderer.render_image({'origins': torch.zeros(1, 4, 3), 'directions': torch.ones(1, 4, 3)}, image_size=(2, 2))
    assert image['rgb'].shape == (2, 2, 3) and image['depth'].shape == (2, 2)
    assert image['weights'].shape == image['alpha'].shape == (2, 2, 3)
    assert all(torch.isfinite(value).all() for value in image.values())


@pytest.mark.parametrize('dtype', [torch.float16, torch.bfloat16])
def test_native_lower_precision_terminal_attenuation_is_finite(dtype):
    renderer = NeRFRenderer(AnalyticField(.3, dtype=dtype), near=.1, far=2., num_samples=3, device='cpu')
    origins = torch.zeros(1, 2, 3, dtype=dtype); dirs = torch.ones(1, 2, 3, dtype=dtype)
    result = renderer.render_rays(origins, dirs)
    assert all(torch.isfinite(value).all() for value in result.values())
    torch.testing.assert_close(result['weights'].sum(-1), torch.ones(1, 2))
