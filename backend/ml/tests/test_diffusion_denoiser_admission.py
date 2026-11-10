"""Analytic Fourier and actual native denoiser admission/consumer evidence."""
import math

import pytest
import torch
from diffusion.model import DiffusionRouteModel, SinusoidalPositionEmbedding


def model(width=8, **kwargs):
    return DiffusionRouteModel(input_dim=2, hidden_dim=width, num_heads=1,
                               num_layers=1, num_timesteps=8, **kwargs)


@pytest.mark.parametrize("width", [2, 3, 4, 7, 8, 32])
@pytest.mark.parametrize("dtype", [torch.float32, torch.float64])
def test_analytic_fourier_values_and_derivatives(width, dtype):
    kernel = SinusoidalPositionEmbedding(width).to(dtype=dtype)
    times = torch.tensor([0., 1.25, 7.], dtype=dtype, requires_grad=True)
    half = width // 2
    frequencies = [1. if half == 1 else math.exp(-math.log(10000) * i / (half - 1))
                   for i in range(half)]
    reference = [[math.sin(t * f) for f in frequencies]
                 + [math.cos(t * f) for f in frequencies]
                 + ([0.] if width % 2 else []) for t in times.detach().tolist()]
    actual = kernel(times)
    torch.testing.assert_close(actual, torch.tensor(reference, dtype=dtype))
    derivative, = torch.autograd.grad(actual.sum(), times)
    expected = [sum(f * (math.cos(t * f) - math.sin(t * f)) for f in frequencies)
                for t in times.detach().tolist()]
    torch.testing.assert_close(derivative, torch.tensor(expected, dtype=dtype))


def test_default_float32_kernel_exact_legacy_compatibility():
    t = torch.tensor([0, 1, 997])
    scale = torch.log(torch.tensor(10000.0)) / 127
    phases = t.float()[:, None] * torch.exp(torch.arange(128).float() * -scale)[None, :]
    expected = torch.cat([phases.sin(), phases.cos()], dim=1)
    torch.testing.assert_close(SinusoidalPositionEmbedding(256)(t), expected, rtol=0, atol=0)


@pytest.mark.parametrize("width", [2, 3, 7, 8])
@pytest.mark.parametrize("dtype", [torch.float32, torch.float64])
def test_actual_small_width_conditional_noise_learning(width, dtype):
    torch.manual_seed(38)
    m = model(width).to(dtype=dtype)
    optimizer = torch.optim.AdamW(m.parameters(), lr=.01)
    ids = [id(p) for p in m.cond_proj.parameters()]
    x = torch.randn(2, 3, 2, dtype=dtype, requires_grad=True)
    context = torch.randn(2, 2, dtype=dtype, requires_grad=True)
    t = torch.tensor([1, 3])
    noise = torch.randn_like(x)
    loss = (m(m.add_noise(x, t, noise), t, context) - noise).square().mean()
    before = m.cond_proj.weight.detach().clone()
    loss.backward()
    assert torch.isfinite(x.grad).all() and torch.isfinite(context.grad).all()
    assert torch.isfinite(m.cond_proj.weight.grad).all()
    optimizer.step()
    assert ids == [id(p) for p in m.cond_proj.parameters()]
    assert not torch.equal(before, m.cond_proj.weight)
    assert optimizer.state[m.cond_proj.weight]["step"] == 1


@pytest.mark.parametrize("kind", ["nan-x", "inf-x", "nan-context", "bool-context",
                                 "wide-context", "wrong-context", "fractional-time",
                                 "nan-time", "negative-time", "late-time", "broadcast-time",
                                 "wrong-x-dtype", "attention-budget", "work-budget"])
def test_complete_rejection_before_lazy_initialization_or_rng(kind):
    m = model().train()
    x, t, c = torch.ones(2, 3, 2), torch.tensor([1, 3]), torch.ones(2, 2)
    if kind == "nan-x": x[-1, -1, -1] = float("nan")
    elif kind == "inf-x": x[-1, -1, -1] = float("inf")
    elif kind == "nan-context": c[-1, -1] = float("nan")
    elif kind == "bool-context": c = c.bool()
    elif kind == "wide-context": c = torch.ones(2, 4097)
    elif kind == "wrong-context": c = torch.ones(3, 2)
    elif kind == "fractional-time": t = torch.tensor([1., 3.5])
    elif kind == "nan-time": t = torch.tensor([1., float("nan")])
    elif kind == "negative-time": t = torch.tensor([1, -1])
    elif kind == "late-time": t = torch.tensor([1, 8])
    elif kind == "broadcast-time": t = torch.tensor([1])
    elif kind == "wrong-x-dtype": x = x.double()
    elif kind == "attention-budget": x, t = torch.ones(64, 1024, 2), torch.ones(64, dtype=torch.long)
    elif kind == "work-budget":
        m = model(256)
        x, t = torch.ones(16, 64, 2), torch.ones(16, dtype=torch.long)
    ids = [id(p) for p in m.parameters()]
    state = {k: v.clone() for k, v in m.state_dict().items()
             if not isinstance(v, torch.nn.parameter.UninitializedParameter)}
    rng = torch.get_rng_state().clone()
    modes = [module.training for module in m.modules()]
    with pytest.raises(ValueError): m(x, t, c)
    assert isinstance(m.cond_proj.weight, torch.nn.parameter.UninitializedParameter)
    assert ids == [id(p) for p in m.parameters()]
    assert torch.equal(rng, torch.get_rng_state())
    assert modes == [module.training for module in m.modules()]
    for key, value in state.items():
        torch.testing.assert_close(m.state_dict()[key], value, rtol=0, atol=0)


@pytest.mark.parametrize("kwargs", [{"hidden_dim": 1}, {"hidden_dim": True},
                                   {"hidden_dim": 3, "num_heads": 2},
                                   {"num_layers": -1}, {"num_timesteps": 0},
                                   {"num_heads": 0}, {"cond_dim": 0},
                                   {"hidden_dim": 4096}, {"input_dim": 0}])
def test_invalid_construction_precedes_random_parameter_allocation(kwargs):
    rng = torch.get_rng_state().clone()
    with pytest.raises(ValueError): DiffusionRouteModel(**kwargs)
    assert torch.equal(rng, torch.get_rng_state())


@pytest.mark.parametrize("appended", [False, True])
def test_owned_tuple_resists_caller_mutation_during_native_projection(appended):
    torch.manual_seed(16)
    m = model(cond_dim=2).eval()
    original_x, original_t, original_c = torch.randn(2, 3, 2), torch.tensor([1, 3]), torch.randn(2, 3, 2)
    x, t, c = original_x.clone(), original_t.clone(), original_c.clone()
    if appended: x = torch.cat([x, c], dim=-1)
    expected = m(original_x, original_t, original_c)
    def mutate(_module, _inputs):
        x.fill_(float("nan"))
        t.fill_(7)
        c.fill_(float("nan"))
    hook = m.time_mlp.register_forward_pre_hook(mutate)
    try:
        actual = m(x, t, None if appended else c)
    finally:
        hook.remove()
    torch.testing.assert_close(actual, expected, rtol=0, atol=0)


def test_actual_native_nonfinite_prediction_is_not_published():
    m = model(cond_dim=2).eval()
    with torch.no_grad(): m.output_proj[-1].bias.fill_(float("inf"))
    with pytest.raises(RuntimeError, match="nonfinite predictions"):
        m(torch.ones(2, 3, 2), torch.tensor([1, 3]), torch.ones(2, 2))


def test_nonpersistent_dtype_anchor_preserves_strict_checkpoint_and_parameter_plan():
    m = model(3, cond_dim=2).double().eval()
    assert sum(p.numel() for p in m.parameters()) == m._base_parameters + 3 * 2 + 3
    assert not any("dtype_anchor" in key for key in m.state_dict())
    restored = model(3, cond_dim=2).double().eval()
    restored.load_state_dict(m.state_dict(), strict=True)
    x, t, c = torch.randn(2, 3, 2, dtype=torch.float64), torch.tensor([0, 7]), torch.randn(2, 2)
    torch.testing.assert_close(m(x, t, c), restored(x, t, c.float()), rtol=1e-6, atol=1e-6)


@pytest.mark.parametrize("bad", [torch.tensor([float("nan")]), torch.ones(1, dtype=torch.bool),
                                torch.ones(1, dtype=torch.complex64), torch.ones(1, 1)])
def test_standalone_fourier_rejects_unsupported_observations(bad):
    with pytest.raises(ValueError): SinusoidalPositionEmbedding(3)(bad)


def test_float64_fourier_retains_large_continuous_time_precision():
    t = torch.tensor([16777217.25], dtype=torch.float64, requires_grad=True)
    actual = SinusoidalPositionEmbedding(3).double()(t)
    expected = torch.tensor([[math.sin(t.item()), math.cos(t.item()), 0.]], dtype=torch.float64)
    torch.testing.assert_close(actual, expected, rtol=1e-14, atol=1e-14)
    assert not torch.allclose(actual, SinusoidalPositionEmbedding(3)(t).double())
