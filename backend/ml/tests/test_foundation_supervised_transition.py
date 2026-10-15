"""Genuine native supervised CE/AdamW/cosine transitions and recovery."""

import copy
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
import torch
from foundation.model import (
    FoundationModelConfig,
    FoundationModelTrainer,
    LogisticsFoundationModel,
)


def setup():
    torch.manual_seed(719)
    config = FoundationModelConfig(vocab_size=8, d_model=8, num_heads=2,
                                   num_layers=1, d_ff=16, max_len=8,
                                   dropout=0, epochs=3, learning_rate=1e-4)
    model = LogisticsFoundationModel(vocab_size=8, d_model=8, num_heads=2,
                                     num_layers=1, d_ff=16, max_len=8, dropout=0)
    return model, FoundationModelTrainer(model, config)


def batch():
    return {'input_ids': torch.tensor([[0, 1], [2, 3]]),
            'attention_mask': torch.tensor([[1, 1], [1, 0]]),
            'labels': torch.tensor([1, 0])}


def snapshot(model, trainer):
    return (copy.deepcopy(model.state_dict()), copy.deepcopy(trainer.optimizer.state_dict()),
            copy.deepcopy(trainer.scheduler.state_dict()),
            [None if p.grad is None else p.grad.clone() for p in model.parameters()],
            [m.training for m in model.modules()])


def equal(a, b):
    if isinstance(a, torch.Tensor):
        torch.testing.assert_close(a, b, rtol=0, atol=0, equal_nan=True)
    elif isinstance(a, dict):
        assert a.keys() == b.keys()
        for k in a:
            equal(a[k], b[k])
    elif isinstance(a, (list, tuple)):
        assert len(a) == len(b)
        for x, y in zip(a, b):
            equal(x, y)
    else:
        assert a == b


def prior_state(model):
    model.eval()
    model.layers[0].train()
    for p in model.parameters():
        p.grad = torch.full_like(p, 0.003)


def reference_step(model, optimizer, scheduler, data):
    model.train()
    optimizer.zero_grad()
    logits = model(data['input_ids'], data.get('attention_mask'), task='classification')['output']
    loss = torch.nn.functional.cross_entropy(logits, data['labels'])
    loss.backward()
    torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0, error_if_nonfinite=True)
    optimizer.step()
    scheduler.step()
    return loss.item()


def test_independent_native_updates_overflow_and_corrected_retry():
    model, trainer = setup()
    reference = copy.deepcopy(model)
    optimizer = torch.optim.AdamW(reference.parameters(), lr=1e-4, betas=(0.9, 0.999),
                                 eps=1e-8, weight_decay=0.01)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=3)
    for _ in range(2):
        expected = reference_step(reference, optimizer, scheduler, batch())
        result = trainer.train_step(batch())
        assert result == {'loss': expected, 'lr': optimizer.param_groups[0]['lr']}
        equal(model.state_dict(), reference.state_dict())
        equal(trainer.optimizer.state_dict(), optimizer.state_dict())
        equal(trainer.scheduler.state_dict(), scheduler.state_dict())
    prior_state(model)
    trainer.optimizer.param_groups[0].update(lr=1e20, weight_decay=1e20)
    before = snapshot(model, trainer)
    identities = [id(p) for p in model.parameters()]
    with pytest.raises(ValueError, match='nonfinite'):
        trainer.train_step(batch())
    equal(snapshot(model, trainer), before)
    assert identities == [id(p) for p in model.parameters()]
    trainer.optimizer.param_groups[0].update(lr=optimizer.param_groups[0]['lr'], weight_decay=0.01)
    expected = reference_step(reference, optimizer, scheduler, batch())
    assert trainer.train_step(batch())['loss'] == expected
    equal(model.state_dict(), reference.state_dict())
    equal(trainer.optimizer.state_dict(), optimizer.state_dict())
    equal(trainer.scheduler.state_dict(), scheduler.state_dict())


@pytest.mark.parametrize('kind', ['missing', 'float_ids', 'empty', 'vocabulary', 'length',
                                 'mask_shape', 'mask_nan', 'unobserved', 'float_labels',
                                 'labels_shape', 'label_range'])
def test_bad_owned_batch_preserves_prior_state_and_rng(kind):
    model, trainer = setup()
    prior_state(model)
    data = batch()
    if kind == 'missing':
        del data['labels']
    elif kind == 'float_ids':
        data['input_ids'] = data['input_ids'].float()
    elif kind == 'empty':
        data['input_ids'] = torch.empty((0, 2), dtype=torch.long)
    elif kind == 'vocabulary':
        data['input_ids'][0, 0] = 8
    elif kind == 'length':
        data['input_ids'] = torch.zeros((2, 9), dtype=torch.long)
    elif kind == 'mask_shape':
        data['attention_mask'] = torch.ones((2, 1))
    elif kind == 'mask_nan':
        data['attention_mask'] = torch.full((2, 2), float('nan'))
    elif kind == 'unobserved':
        data['attention_mask'][0] = 0
    elif kind == 'float_labels':
        data['labels'] = data['labels'].float()
    elif kind == 'labels_shape':
        data['labels'] = data['labels'][:, None]
    else:
        data['labels'][0] = model.classification_head.out_features
    before, rng = snapshot(model, trainer), torch.get_rng_state().clone()
    with pytest.raises(ValueError):
        trainer.train_step(data)
    equal(snapshot(model, trainer), before)
    equal(torch.get_rng_state(), rng)


@pytest.mark.parametrize('target,value', [('lr', float('inf')), ('weight_decay', -1),
                                         ('T_max', 0), ('T_max', True),
                                         ('eta_min', float('nan')), ('last_epoch', -1),
                                         ('base_lrs', [float('inf')])])
def test_prior_policy_admission_before_any_native_work(target, value):
    model, trainer = setup()
    prior_state(model)
    if target in ('lr', 'weight_decay'):
        trainer.optimizer.param_groups[0][target] = value
    else:
        setattr(trainer.scheduler, target, value)
    before, rng = snapshot(model, trainer), torch.get_rng_state().clone()
    with pytest.raises(ValueError):
        trainer.train_step(batch())
    after = snapshot(model, trainer)
    equal(after[0], before[0])
    equal(after[3:], before[3:])
    equal(torch.get_rng_state(), rng)


@pytest.mark.parametrize('fault', ['scheduler_raise', 'scheduler_nan', 'moment_inf',
                                  'parameter_nan', 'gradient_nan', 'objective_nan'])
def test_native_fault_restores_composite_state_and_parameter_identity(fault, monkeypatch):
    model, trainer = setup()
    trainer.train_step(batch())  # accepted work must survive the next failed batch
    prior_state(model)
    before = snapshot(model, trainer)
    identities = [id(p) for p in model.parameters()]
    if fault.startswith('scheduler'):
        native = trainer.scheduler.step

        def broken():
            native()
            if fault == 'scheduler_raise':
                raise RuntimeError('after actual native optimizer and cosine update')
            trainer.scheduler._last_lr[0] = float('nan')

        monkeypatch.setattr(trainer.scheduler, 'step', broken)
        # Scheduler state_dict intentionally includes patched instance methods;
        # remove that instrumentation field from reference comparison below.
    elif fault in ('moment_inf', 'parameter_nan'):
        native = trainer.optimizer.step

        def broken(*args, **kwargs):
            result = native(*args, **kwargs)
            if fault == 'moment_inf':
                next(iter(trainer.optimizer.state.values()))['exp_avg'].fill_(float('inf'))
            else:
                with torch.no_grad():
                    next(model.parameters()).fill_(float('nan'))
            return result

        monkeypatch.setattr(trainer.optimizer, 'step', broken)
    elif fault == 'gradient_nan':
        next(model.parameters()).register_hook(lambda grad: torch.full_like(grad, float('nan')))
    else:
        with torch.no_grad():
            model.classification_head.weight.zero_()
            model.classification_head.bias.copy_(torch.tensor([3e38, -3e38]))
        # finite prior weights, actual native logits overflow
        before = snapshot(model, trainer)
    with pytest.raises((ValueError, RuntimeError)):
        trainer.train_step(batch())
    after = snapshot(model, trainer)
    after[2].pop('step', None)
    equal(after, before)
    assert identities == [id(p) for p in model.parameters()]


def test_caller_batch_mutation_after_admission_does_not_change_native_update(monkeypatch):
    model, trainer = setup()
    reference = copy.deepcopy(model)
    data, original = batch(), batch()
    native = model.forward

    def mutate(*args, **kwargs):
        data['input_ids'].fill_(7)
        data['labels'].fill_(0)
        data['attention_mask'].fill_(0)
        return native(*args, **kwargs)

    monkeypatch.setattr(model, 'forward', mutate)
    optimizer = torch.optim.AdamW(reference.parameters(), lr=1e-4, weight_decay=0.01)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=3)
    expected = reference_step(reference, optimizer, scheduler, original)
    assert trainer.train_step(data)['loss'] == expected
    equal(model.state_dict(), reference.state_dict())


def test_native_validation_waits_until_optimizer_and_scheduler_complete(monkeypatch):
    _model, trainer = setup()
    entered, release, called = Event(), Event(), Event()
    native = trainer.scheduler.step

    def held():
        entered.set()
        assert release.wait(10)
        native()

    monkeypatch.setattr(trainer.scheduler, 'step', held)

    def validate():
        called.set()
        return trainer.validate([{'tokens': [0, 1], 'label': 1}])

    with ThreadPoolExecutor(max_workers=2) as pool:
        update = pool.submit(trainer.train_step, batch())
        assert entered.wait(10)
        validation = pool.submit(validate)
        assert called.wait(10)
        assert not validation.done()
        release.set()
        assert update.result(timeout=15)['loss'] > 0
        assert validation.result(timeout=15) > 0


def test_no_mask_direct_batch_preserves_native_classification_math():
    model, trainer = setup()
    reference = copy.deepcopy(model)
    data = batch()
    del data['attention_mask']
    optimizer = torch.optim.AdamW(reference.parameters(), lr=1e-4, weight_decay=0.01)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=3)
    expected = reference_step(reference, optimizer, scheduler, data)
    assert trainer.train_step(data)['loss'] == expected
    equal(model.state_dict(), reference.state_dict())


@pytest.mark.parametrize('fault', ['no_advance', 'finite_lr_mismatch'])
def test_partial_scheduler_publication_is_not_success(fault, monkeypatch):
    model, trainer = setup()
    before = snapshot(model, trainer)
    native = trainer.scheduler.step

    def broken():
        if fault == 'finite_lr_mismatch':
            native()
            trainer.scheduler._last_lr[0] += 0.001

    monkeypatch.setattr(trainer.scheduler, 'step', broken)
    with pytest.raises(ValueError, match='coherent'):
        trainer.train_step(batch())
    after = snapshot(model, trainer)
    after[2].pop('step', None)
    equal(after, before)
