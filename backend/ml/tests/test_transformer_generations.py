"""Native CPU torch regressions for trainer publication and operation ownership."""
import threading
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pytest
import torch
from app import execution
from transformers.model import DemandForecastTransformer, TransformerTrainer


def trainer():
    torch.manual_seed(42)
    return TransformerTrainer(torch.nn.Sequential(torch.nn.Linear(2, 2), torch.nn.Linear(2, 1)), lr=.1, device='cpu')


def data():
    return torch.tensor([[1., 2.], [3., 4.]]), torch.tensor([[5.], [9.]])


@pytest.mark.parametrize('operation', ['train', 'train_step', 'load'])
def test_inflight_prediction_keeps_complete_old_model(operation, tmp_path):
    subject = trainer()
    x, y = data()
    old = subject.model
    before = subject.predict(x).copy()
    checkpoint = tmp_path / 'new.pth'
    replacement = trainer()
    replacement.train(x, y, epochs=1, batch_size=2)
    replacement.save(checkpoint)
    entered, release = threading.Event(), threading.Event()
    def pause(module, inputs, output):
        if threading.current_thread().name.startswith('native-reader'):
            entered.set()
            assert release.wait(10)
    handle = old[0].register_forward_hook(pause)
    with ThreadPoolExecutor(1, thread_name_prefix='native-reader') as pool:
        pending = pool.submit(subject.predict, x)
        try:
            assert entered.wait(10)
            if operation == 'train':
                subject.train(x, y, epochs=1, batch_size=2)
            elif operation == 'train_step':
                subject.train_step(x, y)
            else:
                subject.load(checkpoint)
            assert not np.allclose(subject.predict(x), before)
        finally:
            release.set()
            handle.remove()
        np.testing.assert_allclose(pending.result(10), before)
    assert subject.model is not old
    np.testing.assert_allclose(old(x).detach().numpy(), before)
    owned = {id(p) for p in subject.model.parameters()}
    assert owned == {id(p) for group in subject.optimizer.param_groups for p in group['params']}


def test_private_fit_does_not_block_readers_and_failure_keeps_pair():
    subject = trainer()
    x, y = data()
    old_model, old_optimizer = subject.model, subject.optimizer
    before = subject.predict(x)
    entered, release = threading.Event(), threading.Event()
    def failing_loss(prediction, target):
        entered.set()
        assert release.wait(10)
        raise ValueError('native fit failure')
    subject.criterion = failing_loss
    with ThreadPoolExecutor(1) as pool:
        fit = pool.submit(subject.train, x, y, 1, 2)
        try:
            assert entered.wait(10)
            np.testing.assert_allclose(subject.predict(x), before)
        finally:
            release.set()
        with pytest.raises(ValueError, match='native fit failure'):
            fit.result(10)
    assert subject.model is old_model
    assert subject.optimizer is old_optimizer


def test_cancelled_fit_preserves_pair(monkeypatch):
    subject = trainer()
    x, y = data()
    old_model, old_optimizer = subject.model, subject.optimizer
    monkeypatch.setattr(execution, 'is_training_cancelled', lambda: True)
    with pytest.raises(execution.TrainingCancelled):
        subject.train(x, y, epochs=1, batch_size=2)
    assert subject.model is old_model
    assert subject.optimizer is old_optimizer


@pytest.mark.parametrize('broken', ['model_state_dict', 'optimizer_state_dict'])
def test_failed_load_preserves_serving_pair(broken, tmp_path):
    subject = trainer()
    x, y = data()
    subject.train(x, y, epochs=1, batch_size=2)
    old_model, old_optimizer = subject.model, subject.optimizer
    before = subject.predict(x).copy()
    path = tmp_path / 'invalid.pth'
    replacement = trainer()
    replacement.train(x, y, epochs=2, batch_size=2)
    state = {'model_state_dict': replacement.model.state_dict(), 'optimizer_state_dict': replacement.optimizer.state_dict()}
    state[broken] = {}
    torch.save(state, path)
    with pytest.raises((RuntimeError, KeyError, ValueError)):
        subject.load(path)
    np.testing.assert_allclose(subject.predict(x), before)
    assert subject.model is old_model
    assert subject.optimizer is old_optimizer


def test_checkpoint_owns_captured_generation_during_publication(monkeypatch, tmp_path):
    subject = trainer()
    x, y = data()
    subject.train(x, y, epochs=1, batch_size=2)
    before = subject.predict(x)
    expected_optimizer = subject.optimizer.state_dict()
    entered, release = threading.Event(), threading.Event()
    real_save = torch.save
    def paused_save(state, path):
        entered.set()
        assert release.wait(10)
        real_save(state, path)
    monkeypatch.setattr(torch, 'save', paused_save)
    path = tmp_path / 'captured.pth'
    with ThreadPoolExecutor(1) as pool:
        pending = pool.submit(subject.save, path)
        try:
            assert entered.wait(10)
            subject.train(x, y, epochs=1, batch_size=2)
        finally:
            release.set()
        pending.result(10)
    restored = trainer()
    restored.load(path)
    np.testing.assert_allclose(restored.predict(x), before)
    actual = restored.optimizer.state_dict()
    for key, state in expected_optimizer['state'].items():
        for field, value in state.items():
            torch.testing.assert_close(actual['state'][key][field], value)


def test_two_native_trainers_serialize_without_lost_optimizer_steps():
    subject = trainer()
    x, y = data()
    entered, release, second_loss = threading.Event(), threading.Event(), threading.Event()
    real_loss = subject.criterion
    def paused_loss(prediction, target):
        if threading.current_thread().name.startswith('first-fit'):
            entered.set()
            assert release.wait(10)
        else:
            second_loss.set()
        return real_loss(prediction, target)
    subject.criterion = paused_loss
    with ThreadPoolExecutor(1, thread_name_prefix='first-fit') as first_pool, ThreadPoolExecutor(1, thread_name_prefix='second-fit') as second_pool:
        first = first_pool.submit(subject.train, x, y, 1, 2)
        try:
            assert entered.wait(10)
            second = second_pool.submit(subject.train, x, y, 1, 2)
            assert not second_loss.wait(.15)
        finally:
            release.set()
        first.result(10)
        second.result(10)
    assert second_loss.is_set()
    assert all(state['step'].item() == 2 for state in subject.optimizer.state.values())


@pytest.mark.parametrize('epochs,batch_size', [(0, 2), (1, 0)])
def test_invalid_fit_preserves_pair(epochs, batch_size):
    subject = trainer()
    x, y = data()
    old = subject.model
    with pytest.raises(ValueError):
        subject.train(x, y, epochs, batch_size)
    assert subject.model is old


def test_actual_demand_transformer_training_validation_checkpoint(tmp_path):
    torch.manual_seed(3)
    subject = TransformerTrainer(DemandForecastTransformer(input_dim=2, d_model=4, num_heads=2, num_layers=1, seq_len=3, pred_len=2, dropout=0), device='cpu')
    x, y = torch.randn(3, 3, 2), torch.randn(3, 2)
    old = subject.model
    result = subject.train(x, y, epochs=2, batch_size=2, val_data=x, val_labels=y)
    assert len(result['train_losses']) == len(result['val_losses']) == 2
    assert subject.model is not old
    assert subject.validate(x, y) == pytest.approx(result['final_val_loss'])
    path = tmp_path / 'demand.pth'
    subject.save(path)
    expected = subject.predict(x)
    subject.train_step(x, y)
    subject.load(path)
    np.testing.assert_allclose(subject.predict(x), expected)


def test_actual_timed_out_native_training_never_publishes():
    import asyncio

    subject = trainer()
    x, y = data()
    before = subject.predict(x).copy()
    old_model, old_optimizer = subject.model, subject.optimizer
    entered, release, finished = threading.Event(), threading.Event(), threading.Event()
    native_loss = subject.criterion
    def paused_loss(prediction, target):
        entered.set()
        assert release.wait(10)
        return native_loss(prediction, target)
    subject.criterion = paused_loss
    def train_to_completion():
        try:
            return subject.train(x, y, epochs=1, batch_size=2)
        finally:
            finished.set()
    async def expire_caller():
        try:
            with pytest.raises(asyncio.TimeoutError):
                await execution.run_training_job('transformer-native-cancel-test', train_to_completion, timeout=.05)
            assert entered.is_set()
            assert not finished.is_set()
            np.testing.assert_allclose(subject.predict(x), before)
        finally:
            release.set()
        async with asyncio.timeout(10):
            while not finished.is_set():
                await asyncio.sleep(.001)
    asyncio.run(expire_caller())
    assert subject.model is old_model
    assert subject.optimizer is old_optimizer
    np.testing.assert_allclose(subject.predict(x), before)
