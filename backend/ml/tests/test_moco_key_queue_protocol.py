"""Native momentum/key ownership, circular dictionary and continuation controls."""
import copy

import pytest
import torch
from torch.nn import functional as F

from self_supervised.model import MoCo


def native(capacity=5, momentum=.75):
    torch.manual_seed(23)
    return MoCo(3, 6, 2, queue_size=capacity, momentum=momentum)


def test_constructor_exact_query_copy_and_frozen_key_identity():
    model = native()
    for q, k in zip(model.query_encoder.parameters(), model.key_encoder.parameters()):
        torch.testing.assert_close(q, k, rtol=0, atol=0)
        assert not k.requires_grad and q.requires_grad


@pytest.mark.parametrize('capacity', [1, 3, 5])
@pytest.mark.parametrize('counts', [[1, 1, 1], [2, 3, 2], [7, 1, 9], [3, 3, 4]])
def test_circular_queue_matches_sequential_row_reference(capacity, counts):
    model = native(capacity); expected = model.queue.clone(); pointer = 0
    serial = 1
    for count in counts:
        keys = torch.arange(serial, serial + 2 * count, dtype=torch.float32).reshape(count, 2)
        serial += 2 * count
        for row in keys:
            expected[:, pointer] = row
            pointer = (pointer + 1) % capacity
        model._dequeue_and_enqueue(keys)
        torch.testing.assert_close(model.queue, expected, rtol=0, atol=0)
        assert model.queue_ptr.item() == pointer


@pytest.mark.parametrize('momentum', [0., .75, 1.])
def test_closed_form_pre_encoding_ema_query_only_native_backward(momentum):
    model = native(momentum=momentum)
    with torch.no_grad():
        for q in model.query_encoder.parameters(): q.add_(.25)
    old_keys = [p.clone() for p in model.key_encoder.parameters()]
    expected_model = copy.deepcopy(model)
    with torch.no_grad():
        for old, q, k in zip(old_keys, model.query_encoder.parameters(), expected_model.key_encoder.parameters()):
            k.copy_(momentum * old + (1 - momentum) * q)
    xq = torch.randn(3, 3); xk = torch.randn(3, 3)
    old_queue = model.queue.clone()
    q = F.normalize(expected_model.query_encoder(xq), dim=1)
    with torch.no_grad(): k = F.normalize(expected_model.key_encoder(xk), dim=1)
    logits = torch.cat([(q * k).sum(-1, keepdim=True), q @ old_queue], dim=1) / model.temperature
    expected = F.cross_entropy(logits, torch.zeros(3, dtype=torch.long))
    actual = model(xq, xk)
    torch.testing.assert_close(actual, expected)
    for a, b in zip(model.key_encoder.parameters(), expected_model.key_encoder.parameters()):
        torch.testing.assert_close(a, b)
    torch.testing.assert_close(model.queue[:, :3], k.T)
    actual.backward(); expected.backward()
    assert all(p.grad is None for p in model.key_encoder.parameters())
    for a, b in zip(model.query_encoder.parameters(), expected_model.query_encoder.parameters()):
        torch.testing.assert_close(a.grad, b.grad)
    optimizer = torch.optim.Adam(model.parameters(), lr=.01)
    key_before = [p.clone() for p in model.key_encoder.parameters()]
    optimizer.step()
    for a, b in zip(model.key_encoder.parameters(), key_before): torch.testing.assert_close(a, b, rtol=0, atol=0)
    assert optimizer.state


def test_evaluation_objective_is_repeatable_without_any_dictionary_mutation():
    model = native(); model(torch.randn(3, 3), torch.randn(3, 3)); model.eval()
    before = copy.deepcopy(model.state_dict())
    q = torch.randn(2, 3); k = torch.randn(2, 3)
    first = model(q, k); second = model(q, k)
    torch.testing.assert_close(first, second, rtol=0, atol=0)
    for name, value in before.items(): torch.testing.assert_close(value, model.state_dict()[name], rtol=0, atol=0)


@pytest.mark.parametrize('bad', ['empty', 'rows', 'width', 'nan', 'dtype', 'ptr', 'temperature'])
def test_invalid_paired_batch_rejected_before_key_or_queue_mutation(bad):
    model = native(); q = torch.randn(3, 3); k = q.clone()
    if bad == 'empty': q = q[:0]; k = k[:0]
    elif bad == 'rows': k = k[:1]
    elif bad == 'width': q = q[:, :2]; k = k[:, :2]
    elif bad == 'nan': k[-1, 0] = float('nan')
    elif bad == 'dtype': k = k.double()
    elif bad == 'ptr': model.queue_ptr[0] = 5
    elif bad == 'temperature': model.temperature = 0
    before = copy.deepcopy(model.state_dict())
    with pytest.raises(ValueError): model(q, k)
    for name, value in before.items(): torch.testing.assert_close(value, model.state_dict()[name], rtol=0, atol=0)


@pytest.mark.parametrize('bad', ['empty', 'width', 'nan', 'dtype'])
def test_invalid_enqueue_preserves_queue_and_pointer(bad):
    model = native(); keys = torch.randn(3, 2)
    if bad == 'empty': keys = keys[:0]
    elif bad == 'width': keys = keys[:, :1]
    elif bad == 'nan': keys[-1, 0] = float('nan')
    elif bad == 'dtype': keys = keys.double()
    prior = copy.deepcopy(model.state_dict())
    with pytest.raises(ValueError): model._dequeue_and_enqueue(keys)
    for name, value in prior.items(): torch.testing.assert_close(value, model.state_dict()[name], rtol=0, atol=0)


@pytest.mark.parametrize('capacity,momentum', [(0, .5), (-1, .5), (True, .5), (2, -1.), (2, 1.1), (2, float('nan'))])
def test_invalid_dictionary_configuration(capacity, momentum):
    with pytest.raises(ValueError): native(capacity, momentum)


def test_native_checkpoint_continues_next_wrapped_batch_and_query_optimizer(tmp_path):
    model = native(); optimizer = torch.optim.Adam(model.parameters(), lr=.01)
    loss = model(torch.randn(3, 3), torch.randn(3, 3)); loss.backward(); optimizer.step(); optimizer.zero_grad()
    path = tmp_path / 'moco.pth'
    torch.save({'model': model.state_dict(), 'optimizer': optimizer.state_dict()}, path)
    restored = native(); other = torch.optim.Adam(restored.parameters(), lr=.01)
    saved = torch.load(path, weights_only=True); restored.load_state_dict(saved['model']); other.load_state_dict(saved['optimizer'])
    assert model.state_dict().keys() == restored.state_dict().keys()
    q = torch.randn(4, 3); k = torch.randn(4, 3)
    first = model(q, k); second = restored(q, k)
    torch.testing.assert_close(first, second, rtol=0, atol=0)
    first.backward(); second.backward(); optimizer.step(); other.step()
    for name, value in model.state_dict().items(): torch.testing.assert_close(value, restored.state_dict()[name], rtol=0, atol=0)
    assert all(not p.requires_grad and p.grad is None for p in restored.key_encoder.parameters())
