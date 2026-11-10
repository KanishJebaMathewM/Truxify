"""Native failed publication, full dictionary ownership and dynamic-range derivatives."""

import copy
import math

import pytest
import torch
from self_supervised.moco_transition import normalize_features
from self_supervised.model import MoCo


def native(dtype=torch.float32, capacity=3, momentum=.5):
    torch.manual_seed(3)
    model = MoCo(2, 2, 2, queue_size=capacity, momentum=momentum).to(dtype=dtype)
    with torch.no_grad():
        for p in model.parameters():
            p.zero_()
        model.query_encoder[-1].bias.copy_(torch.tensor([4., 2.], dtype=dtype))
        model.key_encoder[-1].bias.copy_(torch.tensor([1., 3.], dtype=dtype))
    return model


def state(model):
    return copy.deepcopy(model.state_dict())


def unchanged(model, before):
    for name, tensor in model.state_dict().items():
        torch.testing.assert_close(tensor, before[name], rtol=0, atol=0, equal_nan=True)


@pytest.mark.parametrize('dtype,temp', [(torch.float32, 1e-45), (torch.float64, 1e-320)])
@pytest.mark.parametrize('training', [True, False])
def test_native_unrepresentable_logits_reject_without_publishing(dtype, temp, training):
    m = native(dtype).train(training)
    m.temperature = temp
    before = state(m)
    ids = [id(p) for p in m.parameters()]
    with pytest.raises(ValueError, match='logits'):
        m(torch.ones(1, 2, dtype=dtype), torch.ones(1, 2, dtype=dtype))
    unchanged(m, before)
    assert ids == [id(p) for p in m.parameters()]
    m.temperature = .5
    assert torch.isfinite(m(torch.ones(1, 2, dtype=dtype), torch.ones(1, 2, dtype=dtype)))


@pytest.mark.parametrize('dtype,scale', [(torch.float32, 1e38), (torch.float64, 1e200)])
def test_large_finite_features_keep_independent_normalized_dictionary_and_loss(dtype, scale):
    m = native(dtype, momentum=0)
    with torch.no_grad():
        m.query_encoder[-1].bias.copy_(torch.tensor([scale, scale / 2], dtype=dtype))
    old = m.queue.clone()
    # Closed-form ratio cancels amplitude before computing the independent norm.
    unit = torch.tensor([2 / math.sqrt(5), 1 / math.sqrt(5)], dtype=dtype)
    wanted_logits = torch.cat([torch.ones(1, 1, dtype=dtype), (unit @ old).reshape(1, -1)], dim=1) / .5
    expected = torch.logsumexp(wanted_logits, dim=1)[0] - wanted_logits[0, 0]
    actual = m(torch.ones(1, 2, dtype=dtype), torch.ones(1, 2, dtype=dtype))
    torch.testing.assert_close(actual, expected)
    torch.testing.assert_close(m.queue[:, 0], unit)
    torch.testing.assert_close(torch.linalg.vector_norm(m.queue[:, 0]), torch.tensor(1., dtype=dtype))
    actual.backward()
    assert torch.isfinite(m.query_encoder[-1].bias.grad).all()
    assert all(p.grad is None for p in m.key_encoder.parameters())


@pytest.mark.parametrize('dtype,scale', [(torch.float32, 1e-30), (torch.float32, 1e-13),
                                       (torch.float32, 1.), (torch.float32, 1e30),
                                       (torch.float64, 1e-200), (torch.float64, 1e200)])
def test_scale_aware_norm_and_autograd_match_independent_analytic_reference(dtype, scale):
    x = torch.tensor([[scale, -scale / 2]], dtype=dtype, requires_grad=True)
    result = normalize_features(x)
    gradient = torch.tensor([[.3, -.7]], dtype=dtype)
    (result * gradient).sum().backward()
    norm = scale * math.sqrt(1.25)
    if norm < 1e-12:
        target = torch.tensor([[scale / 1e-12, -scale / 2 / 1e-12]], dtype=dtype)
        derivative = gradient / 1e-12
    else:
        unit = torch.tensor([[1 / math.sqrt(1.25), -.5 / math.sqrt(1.25)]], dtype=dtype)
        target = unit
        derivative = (gradient - unit * (gradient * unit).sum(dim=1, keepdim=True)) / norm
    torch.testing.assert_close(result, target, rtol=3e-6, atol=0)
    torch.testing.assert_close(x.grad, derivative, rtol=3e-6, atol=0)


def test_zero_feature_preserves_epsilon_normalization_and_native_derivative():
    x = torch.zeros(2, 3, requires_grad=True)
    out = normalize_features(x)
    out.sum().backward()
    assert not out.any()
    torch.testing.assert_close(x.grad, torch.full_like(x, 1e12))


@pytest.mark.parametrize('dtype', [torch.float16, torch.bfloat16])
def test_half_native_model_promotes_objective_and_retains_dictionary_dtype(dtype):
    m = native(dtype)
    actual = m(torch.ones(2, 2, dtype=dtype), torch.ones(2, 2, dtype=dtype))
    assert actual.dtype == torch.float32 and torch.isfinite(actual)
    actual.backward()
    assert m.queue.dtype == dtype
    assert all(p.grad is None for p in m.key_encoder.parameters())
    assert all(p.grad is None or torch.isfinite(p.grad).all() for p in m.query_encoder.parameters())


@pytest.mark.parametrize('defect', ['momentum_nan', 'momentum_bool', 'temperature_bool', 'key_nan',
                                   'query_inf', 'queue_nan', 'queue_geometry', 'pointer_shape',
                                   'pointer_dtype', 'key_grad', 'key_geometry'])
def test_complete_state_admission_precedes_registered_mutation(defect):
    m = native()
    with torch.no_grad():
        if defect == 'momentum_nan':
            m.momentum = float('nan')
        elif defect == 'momentum_bool':
            m.momentum = True
        elif defect == 'temperature_bool':
            m.temperature = True
        elif defect == 'key_nan':
            m.key_encoder[-1].bias[0] = float('nan')
        elif defect == 'query_inf':
            m.query_encoder[-1].bias[0] = float('inf')
        elif defect == 'queue_nan':
            m.queue[0, -1] = float('nan')
        elif defect == 'queue_geometry':
            m.queue = torch.zeros(2, 2)
        elif defect == 'pointer_shape':
            m.queue_ptr = torch.zeros(2, dtype=torch.long)
        elif defect == 'pointer_dtype':
            m.queue_ptr = torch.zeros(1)
        elif defect == 'key_grad':
            m.key_encoder[-1].bias.requires_grad_(True)
        else:
            m.key_encoder[-1].bias = torch.nn.Parameter(torch.ones(3), requires_grad=False)
    before = state(m)
    with pytest.raises(ValueError):
        m(torch.ones(2, 2), torch.ones(2, 2))
    unchanged(m, before)


@pytest.mark.parametrize('encoder', ['query', 'key'])
def test_real_native_linear_overflow_does_not_publish_candidate(encoder):
    m = native()
    with torch.no_grad():
        target = m.query_encoder if encoder == 'query' else m.key_encoder
        target[0].weight.fill_(1e38)
    before = state(m)
    with pytest.raises(ValueError, match='features'):
        m(torch.full((1, 2), 1e38), torch.full((1, 2), 1e38))
    unchanged(m, before)


@pytest.mark.parametrize('encoder', ['query', 'key'])
def test_native_callback_failure_preserves_registered_dictionary(encoder):
    m = native()
    before = state(m)

    def failure(module, args):
        raise RuntimeError('controlled native encoder callback')

    hook = getattr(m, f'{encoder}_encoder').register_forward_pre_hook(failure)
    try:
        with pytest.raises(RuntimeError, match='controlled'):
            m(torch.ones(2, 2), torch.ones(2, 2))
    finally:
        hook.remove()
    unchanged(m, before)


@pytest.mark.parametrize('momentum', [0, .25, 1])
@pytest.mark.parametrize('count', [1, 2, 7])
def test_independent_ema_and_serial_queue_reference(momentum, count):
    m = native(momentum=momentum)
    old = state(m)
    expected = torch.tensor([momentum * 1 + (1 - momentum) * 4,
                             momentum * 3 + (1 - momentum) * 2], dtype=torch.float32)
    unit = expected / torch.linalg.vector_norm(expected)
    queue = old['queue'].clone()
    pointer = 0
    for _ in range(count):
        queue[:, pointer] = unit
        pointer = (pointer + 1) % 3
    loss = m(torch.ones(count, 2), torch.ones(count, 2))
    assert torch.isfinite(loss)
    torch.testing.assert_close(m.key_encoder[-1].bias, expected)
    torch.testing.assert_close(m.queue, queue)
    assert m.queue_ptr.item() == pointer


def test_query_input_gradient_link_is_preserved_key_link_is_absent():
    torch.manual_seed(5)
    m = MoCo(2, 4, 2, queue_size=3)
    xq = torch.randn(3, 2, requires_grad=True)
    xk = torch.randn(3, 2, requires_grad=True)
    m(xq, xk).backward()
    assert xq.grad is not None and torch.isfinite(xq.grad).all()
    assert xk.grad is None


def test_views_owned_before_native_encoder_callback():
    m, ref = native(), native()
    q, k = torch.ones(2, 2), torch.ones(2, 2)
    expected = ref(q.clone(), k.clone())

    def mutation(module, args):
        q.fill_(float('nan'))
        k.fill_(float('nan'))

    hook = m.key_encoder.register_forward_pre_hook(mutation)
    try:
        actual = m(q, k)
    finally:
        hook.remove()
    torch.testing.assert_close(actual, expected, rtol=0, atol=0)
    unchanged(m, state(ref))


@pytest.mark.parametrize('budget', ['MAX_VALUES', 'MAX_LOGITS'])
def test_bounded_work_rejected_before_native_encoding(monkeypatch, budget):
    import self_supervised.moco_transition as transition

    monkeypatch.setattr(transition, budget, 1)
    m = native()
    before = state(m)
    with pytest.raises(ValueError):
        m(torch.ones(2, 2), torch.ones(2, 2))
    unchanged(m, before)


def test_finite_logits_with_nonfinite_native_cross_entropy_do_not_publish():
    m = native(momentum=1)
    with torch.no_grad():
        m.key_encoder[-1].bias.copy_(torch.tensor([-4., -2.]))
        m.queue.fill_(2)
    m.temperature = 1e-38
    before = state(m)
    with pytest.raises(ValueError, match='objective'):
        m(torch.ones(1, 2), torch.ones(1, 2))
    unchanged(m, before)
