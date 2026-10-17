"""Real native heads, objectives, AdamW, token masks and mounted task routing."""

import copy
import importlib
import json
import sys

import pytest
import torch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from foundation.model import (
    FoundationModelConfig,
    FoundationModelTrainer,
    LogisticsFoundationModel,
)


def trainer(batch_size=2, epochs=2):
    torch.manual_seed(29)
    config = FoundationModelConfig(vocab_size=16, d_model=8, num_heads=2, num_layers=1,
                                   d_ff=16, max_len=8, dropout=0, batch_size=batch_size, epochs=epochs)
    model = LogisticsFoundationModel(vocab_size=16, d_model=8, num_heads=2, num_layers=1,
                                    d_ff=16, max_len=8, dropout=0)
    return FoundationModelTrainer(model, config)


def records(task='classification'):
    return [{'tokens': [0, 2], 'label': 1 if task == 'classification' else 1.75},
            {'tokens': [3], 'label': 0 if task == 'classification' else -0.375}]


def snapshot(t):
    return (copy.deepcopy(t.model.state_dict()), copy.deepcopy(t.optimizer.state_dict()),
            copy.deepcopy(t.scheduler.state_dict()), [m.training for m in t.model.modules()],
            [None if p.grad is None else p.grad.clone() for p in t.model.parameters()])


def same(a, b):
    if isinstance(a, torch.Tensor):
        assert torch.equal(a, b)
    elif isinstance(a, dict):
        assert a.keys() == b.keys()
        for key in a:
            same(a[key], b[key])
    elif isinstance(a, (list, tuple)):
        assert len(a) == len(b)
        for left, right in zip(a, b):
            same(left, right)
    else:
        assert a == b


@pytest.mark.parametrize('task', ['classification', 'regression'])
def test_actual_native_step_matches_independent_loss_gradient_adamw(task):
    t = trainer()
    reference = copy.deepcopy(t.model)
    optimizer = torch.optim.AdamW(reference.parameters(), lr=t.config.learning_rate,
                                  betas=(.9, .999), eps=1e-8, weight_decay=.01)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=t.config.epochs)
    batch = t._prepare_batch(records(task), task)
    expected = reference(torch.tensor([[0, 2], [3, 0]]), torch.tensor([[1, 1], [1, 0]]), task=task)['output']
    target = torch.tensor([1, 0]) if task == 'classification' else torch.tensor([[1.75], [-.375]])
    loss = (torch.nn.functional.cross_entropy(expected, target) if task == 'classification'
            else torch.nn.functional.mse_loss(expected, target))
    loss.backward()
    torch.nn.utils.clip_grad_norm_(reference.parameters(), 1.0)
    optimizer.step()
    scheduler.step()
    result = t.train_step(batch, task)
    assert result['loss'] == pytest.approx(loss.item())
    for actual, wanted in zip(t.model.parameters(), reference.parameters()):
        torch.testing.assert_close(actual, wanted, rtol=0, atol=0)
    same(t.optimizer.state_dict(), optimizer.state_dict())
    inactive = t.model.regression_head if task == 'classification' else t.model.classification_head
    active = t.model.classification_head if task == 'classification' else t.model.regression_head
    assert all(p.grad is None for p in inactive.parameters())
    assert all(p.grad is not None for p in active.parameters())


@pytest.mark.parametrize('task', ['classification', 'regression'])
def test_padding_and_cobatching_do_not_change_observed_prediction(task):
    t = trainer()
    t.model.eval()
    one = records(task)[:1]
    short = t._prepare_batch(one, task)
    together = t._prepare_batch(one + [{'tokens': [4, 5, 6, 7, 8, 9, 10], 'label': one[0]['label']}], task)
    with torch.no_grad():
        a = t.model(short['input_ids'], short['attention_mask'], task)['output'][0]
        b = t.model(together['input_ids'], together['attention_mask'], task)['output'][0]
        padded = torch.cat([short['input_ids'], torch.zeros((1, 6), dtype=torch.long)], dim=1)
        mask = torch.tensor([[1, 1, 0, 0, 0, 0, 0, 0]])
        c = t.model(padded, mask, task)['output'][0]
    torch.testing.assert_close(a, b, rtol=1e-5, atol=1e-6)
    torch.testing.assert_close(a, c, rtol=1e-5, atol=1e-6)
    assert short['attention_mask'][0, 0]  # genuine ID zero is observed


def test_fractional_labels_owned_and_dynamic_width():
    t = trainer()
    data = records('regression')
    batch = t._prepare_batch(data, 'regression')
    assert batch['input_ids'].shape == (2, 2)
    assert batch['labels'].shape == (2, 1)
    assert batch['labels'].tolist() == [[1.75], [-.375]]
    data[0]['tokens'][0] = 12
    data[0]['label'] = 99
    assert batch['input_ids'][0, 0] == 0
    assert batch['labels'][0, 0] == 1.75


BAD = [None, {}, {'tokens': [], 'label': 0}, {'tokens': [1]},
       {'tokens': [999], 'label': 0}, {'tokens': [-1], 'label': 0},
       {'tokens': [True], 'label': 0}, {'tokens': [1.5], 'label': 0},
       {'tokens': [1], 'label': True}, {'tokens': [1], 'label': 2},
       {'tokens': [1], 'label': .5}, {'tokens': [1], 'label': float('nan')}]


@pytest.mark.parametrize('bad', BAD)
@pytest.mark.parametrize('collection', ['train', 'validation'])
def test_entire_collection_rejected_before_native_update(bad, collection):
    t = trainer(batch_size=1)
    t.model.eval()
    for p in t.model.parameters():
        p.grad = torch.ones_like(p)
    before = snapshot(t)
    good = records()
    data = good + [bad]
    with pytest.raises(ValueError):
        t.train(data if collection == 'train' else good,
                data if collection == 'validation' else None)
    same(snapshot(t), before)


@pytest.mark.parametrize('label', [float('inf'), float('nan'), True, '1.25', 1e100])
def test_regression_label_rejected_before_update(label):
    t = trainer()
    before = snapshot(t)
    with pytest.raises(ValueError):
        t.train([{'tokens': [1], 'label': label}], task='regression')
    same(snapshot(t), before)


@pytest.mark.parametrize('field,value', [('epochs', 0), ('epochs', True), ('epochs', 101),
                                        ('batch_size', 0), ('batch_size', 1.5),
                                        ('max_len', 0), ('max_len', 9)])
def test_invalid_policy_rejected_before_state_change(field, value):
    t = trainer()
    setattr(t.config, field, value)
    before = snapshot(t)
    with pytest.raises(ValueError):
        t.train(records())
    same(snapshot(t), before)


def test_complete_tail_validated_before_truncation():
    t = trainer()
    with pytest.raises(ValueError):
        t._prepare_batch([{'tokens': [1] * 8 + [999], 'label': 1}])
    batch = t._prepare_batch([{'tokens': [1] * 10, 'label': 1}])
    assert batch['input_ids'].shape == (1, 8)
    assert batch['attention_mask'].all()


@pytest.mark.parametrize('task', ['classification', 'regression'])
def test_training_owns_caller_records_and_epoch_override(task):
    t = trainer(batch_size=1, epochs=2)
    data = records(task)
    before = copy.deepcopy(data)
    result = t.train(data, data, task=task, epochs=1)
    assert data == before
    assert t.config.epochs == 2
    assert len(result['train_losses']) == len(result['val_losses']) == 1


@pytest.mark.parametrize('task', ['classification', 'regression'])
def test_validation_weighted_by_samples_preserves_modes_gradients_and_optimizer(task):
    t = trainer(batch_size=2)
    data = records(task) + records(task)[:1]
    t.model.train()
    t.model.layers[0].eval()
    before = snapshot(t)
    reference = copy.deepcopy(t.model).eval()
    expected = []
    with torch.no_grad():
        for item in data:
            out = reference(torch.tensor([item['tokens']]), task=task)['output']
            loss = (torch.nn.functional.cross_entropy(out, torch.tensor([item['label']]))
                    if task == 'classification' else
                    torch.nn.functional.mse_loss(out, torch.tensor([[item['label']]])))
            expected.append(loss.item())
    assert t.validate(data, task) == pytest.approx(sum(expected) / len(expected), rel=1e-6)
    same(snapshot(t), before)


@pytest.mark.parametrize('defect', ['empty', 'label_shape', 'label_dtype', 'mask_shape', 'mask_empty', 'mask_nan', 'token_range'])
def test_direct_batch_admission_before_mode_or_gradient_change(defect):
    t = trainer()
    batch = t._prepare_batch(records())
    if defect == 'empty':
        batch['input_ids'] = torch.empty((0, 2), dtype=torch.long)
    elif defect == 'label_shape':
        batch['labels'] = batch['labels'][:, None]
    elif defect == 'label_dtype':
        batch['labels'] = batch['labels'].float()
    elif defect == 'mask_shape':
        batch['attention_mask'] = torch.ones((2, 1))
    elif defect == 'mask_empty':
        batch['attention_mask'][0] = False
    elif defect == 'mask_nan':
        batch['attention_mask'] = torch.full((2, 2), float('nan'))
    else:
        batch['input_ids'][1, 0] = 16
    t.model.eval()
    before = snapshot(t)
    with pytest.raises(ValueError):
        t.train_step(batch)
    same(snapshot(t), before)


def test_optional_mask_means_all_tokens_observed():
    t = trainer()
    batch = t._prepare_batch(records())
    del batch['attention_mask']
    assert torch.isfinite(torch.tensor(t.train_step(batch)['loss']))


@pytest.mark.parametrize('task', ['mlm', '', None, []])
def test_unknown_finetuning_task_rejected(task):
    t = trainer()
    with pytest.raises(ValueError):
        t.train(records(), task=task)


@pytest.fixture
def mounted(monkeypatch):
    import foundation.model as source

    class TinyConfig(FoundationModelConfig):
        def __init__(self):
            super().__init__(vocab_size=128, d_model=8, num_heads=2, num_layers=1,
                             d_ff=16, max_len=8, dropout=0, batch_size=2, epochs=2)

    # Only bootstrap dimensions are reduced; actual router/model/trainer/AdamW run.
    monkeypatch.setattr(source, 'FoundationModelConfig', TinyConfig)
    name = 'routes.foundation_routes'
    previous = sys.modules.pop(name, None)
    route = importlib.import_module(name)
    app = FastAPI()
    app.include_router(route.router)
    yield TestClient(app), route
    sys.modules.pop(name, None)
    if previous is not None:
        sys.modules[name] = previous


@pytest.mark.parametrize('task', ['classification', 'regression'])
def test_actual_uploaded_route_uses_named_head_and_keeps_config(mounted, task):
    client, route = mounted
    inactive = route.model.classification_head if task == 'regression' else route.model.regression_head
    active = route.model.regression_head if task == 'regression' else route.model.classification_head
    old_inactive = copy.deepcopy(inactive.state_dict())
    old_active = copy.deepcopy(active.state_dict())
    payload = [{'origin': 'a', 'destination': 'b', 'cargo_type': 'c', 'price': 1750, 'is_urgent': True},
               {'origin': 'b', 'destination': 'c', 'cargo_type': 'a', 'price': 2375, 'is_urgent': False}]
    response = client.post(f'/foundation/finetune?task={task}&epochs=1',
                           files={'file': ('data.json', json.dumps(payload), 'application/json')})
    assert response.status_code == 200, response.text
    assert response.json()['data']['task'] == task
    assert route.config.epochs == 2
    same(inactive.state_dict(), old_inactive)
    assert any(not torch.equal(old_active[k], v) for k, v in active.state_dict().items())


def test_actual_upload_empty_observation_is_client_rejection(mounted):
    client, route = mounted
    before = snapshot(route.trainer)
    response = client.post('/foundation/finetune', files={'file': ('data.json', '[{}]', 'application/json')})
    assert response.status_code == 422, response.text
    same(snapshot(route.trainer), before)


@pytest.mark.parametrize('budget', ['MAX_RECORDS', 'MAX_TOKENS', 'MAX_TOKEN_WORK'])
def test_work_budgets_reject_complete_operation_before_update(monkeypatch, budget):
    import foundation.finetuning as admission
    import foundation.model as source

    monkeypatch.setattr(source if budget == 'MAX_TOKEN_WORK' else admission, budget, 1)
    t = trainer()
    before = snapshot(t)
    with pytest.raises(ValueError):
        t.train(records())
    same(snapshot(t), before)


def test_direct_batch_is_owned_before_native_forward():
    t = trainer()
    control = trainer()
    batch = t._prepare_batch(records('regression'), 'regression')
    expected = control.train_step(copy.deepcopy(batch), 'regression')

    def caller_mutates(module, args):
        batch['input_ids'].fill_(15)
        batch['labels'].fill_(99)
        batch['attention_mask'].fill_(False)

    handle = t.model.register_forward_pre_hook(caller_mutates)
    try:
        actual = t.train_step(batch, 'regression')
    finally:
        handle.remove()
    assert actual == expected
    same(t.model.state_dict(), control.model.state_dict())
    same(t.optimizer.state_dict(), control.optimizer.state_dict())


def test_native_internal_valueerror_is_not_mislabeled_as_client_error(mounted):
    client, route = mounted

    def failing_callback(module, args):
        raise ValueError('internal native callback failure')

    handle = route.model.register_forward_pre_hook(failing_callback)
    try:
        payload = [{'origin': 'a', 'destination': 'b', 'cargo_type': 'c', 'price': 1750}]
        response = client.post('/foundation/finetune?epochs=1',
                               files={'file': ('data.json', json.dumps(payload), 'application/json')})
    finally:
        handle.remove()
    assert response.status_code == 500
    assert response.json()['detail'] == 'Internal server error'
