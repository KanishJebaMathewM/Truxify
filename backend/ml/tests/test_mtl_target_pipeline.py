"""Native named-target minibatches and pre-update dataset admission."""
import copy

import pytest
import torch
from torch import nn

from mtl.model import MTLLoss, MultiTaskModel, MultiTaskTrainer


def setup(mixed=False):
    torch.manual_seed(5)
    tasks = {'eta': {'output_dim': 1}, 'price': {'output_dim': 1}}
    losses = {'eta': nn.MSELoss(), 'price': nn.MSELoss()}
    if mixed:
        tasks['risk'] = {'output_dim': 2, 'type': 'classification'}
        losses['risk'] = nn.CrossEntropyLoss()
    model = MultiTaskModel(2, tasks, hidden_dim=8)
    for layer in model.modules():
        if isinstance(layer, nn.Dropout):
            layer.p = 0
    trainer = MultiTaskTrainer(model, MTLLoss(losses), device='cpu')
    trainer.gradient_method = 'standard'
    x = torch.arange(14, dtype=torch.float32).reshape(7, 2) / 10
    targets = {'eta': x[:, :1] + 1, 'price': x[:, :1] + 100}
    if mixed:
        targets['risk'] = torch.arange(7) % 2
    return trainer, x, targets


@pytest.mark.parametrize('mixed', [False, True])
@pytest.mark.parametrize('batch_size', [1, 3, 7])
def test_native_shuffled_epoch_is_invariant_to_target_insertion_order(mixed, batch_size):
    first, x, y = setup(mixed)
    second, _, _ = setup(mixed)
    torch.manual_seed(91)
    a = first.train(x, y, epochs=2, batch_size=batch_size, val_data=x, val_targets=y)
    torch.manual_seed(91)
    b = second.train(x, dict(reversed(list(y.items()))), epochs=2,
                     batch_size=batch_size, val_data=x,
                     val_targets=dict(reversed(list(y.items()))))
    assert a == b
    for name, param in first.model.state_dict().items():
        torch.testing.assert_close(param, second.model.state_dict()[name], rtol=0, atol=0)
    assert first.optimizer.state and second.optimizer.state
    for key, state in first.optimizer.state_dict()['state'].items():
        for name, value in state.items():
            torch.testing.assert_close(value, second.optimizer.state_dict()['state'][key][name], rtol=0, atol=0)


def assert_nested_equal(a, b):
    if isinstance(a, torch.Tensor):
        torch.testing.assert_close(a, b, rtol=0, atol=0)
    elif isinstance(a, dict):
        assert a.keys() == b.keys()
        for key in a:
            assert_nested_equal(a[key], b[key])
    elif isinstance(a, (list, tuple)):
        assert len(a) == len(b)
        for left, right in zip(a, b):
            assert_nested_equal(left, right)
    else:
        assert a == b


@pytest.mark.parametrize('bad', [
    'missing', 'extra', 'rows', 'rank', 'width', 'target_nan', 'target_inf',
    'input_nan', 'input_features', 'input_rank', 'input_dtype', 'empty',
    'class_float', 'class_rank', 'class_negative', 'class_overflow',
    'val_bad', 'val_only', 'val_targets_only', 'epochs_zero', 'epochs_bool',
    'batch_zero', 'batch_float', 'late_class', 'target_dtype', 'target_object', 'input_integer', 'val_nan',
])
def test_full_dataset_admission_preserves_existing_optimizer_and_model(bad):
    trainer, x, y = setup(mixed=True)
    # Already-trained state ensures failure cannot reset or partially advance Adam.
    trainer.train(x, y, epochs=1, batch_size=3)
    trainer.model.eval()
    before = copy.deepcopy((trainer.model.state_dict(), trainer.optimizer.state_dict(),
                            trainer.scheduler.state_dict()))
    modes = {name: layer.training for name, layer in trainer.model.named_modules()}
    x = x.clone(); y = {name: target.clone() for name, target in y.items()}
    kwargs = {'epochs': 1, 'batch_size': 2}
    if bad == 'missing': del y['price']
    elif bad == 'extra': y['unknown'] = y['eta']
    elif bad == 'target_dtype': y['price'] = y['price'].double()
    elif bad == 'target_object': y['price'] = y['price'].tolist()
    elif bad == 'input_integer': x = x.long()
    elif bad == 'val_nan':
        val = x.clone(); val[-1, 0] = float('nan')
        kwargs.update(val_data=val, val_targets=y)
    elif bad == 'rows': y['price'] = y['price'][:-1]
    elif bad == 'rank': y['price'] = y['price'].flatten()
    elif bad == 'width': y['price'] = y['price'].expand(-1, 2)
    elif bad == 'target_nan': y['price'][-1] = float('nan')
    elif bad == 'target_inf': y['price'][-1] = float('inf')
    elif bad == 'input_nan': x[-1, 0] = float('nan')
    elif bad == 'input_features': x = x[:, :1]
    elif bad == 'input_rank': x = x.flatten()
    elif bad == 'input_dtype': x = x.double()
    elif bad == 'empty': x = x[:0]; y = {k: v[:0] for k, v in y.items()}
    elif bad == 'class_float': y['risk'] = y['risk'].float()
    elif bad == 'class_rank': y['risk'] = y['risk'][:, None]
    elif bad == 'class_negative': y['risk'][-1] = -1
    elif bad in ('class_overflow', 'late_class'): y['risk'][-1] = 2
    elif bad == 'val_bad': kwargs.update(val_data=x, val_targets={**y, 'risk': y['risk'].float()})
    elif bad == 'val_only': kwargs['val_data'] = x
    elif bad == 'val_targets_only': kwargs['val_targets'] = y
    elif bad == 'epochs_zero': kwargs['epochs'] = 0
    elif bad == 'epochs_bool': kwargs['epochs'] = True
    elif bad == 'batch_zero': kwargs['batch_size'] = 0
    elif bad == 'batch_float': kwargs['batch_size'] = 1.5
    with pytest.raises(ValueError, match='training|validation|epochs|batch_size'):
        trainer.train(x, y, **kwargs)
    after = (trainer.model.state_dict(), trainer.optimizer.state_dict(), trainer.scheduler.state_dict())
    assert_nested_equal(before, after)
    assert modes == {name: layer.training for name, layer in trainer.model.named_modules()}


def test_existing_public_train_validate_predict_contract():
    trainer, x, y = setup(mixed=True)
    result = trainer.train(x, y, epochs=2, batch_size=3, val_data=x, val_targets=y)
    assert len(result['train_losses']) == len(result['val_losses']) == 2
    assert result['final_loss'] == result['train_losses'][-1]
    assert result['final_val_loss'] == result['val_losses'][-1]
    pred = trainer.predict(x)
    assert pred['eta'].shape == (7, 1)
    torch.testing.assert_close(pred['risk'].sum(-1), torch.ones(7))
