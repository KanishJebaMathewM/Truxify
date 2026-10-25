"""Native differentiable MAML inference row/mode correctness and ASGI."""
import copy

import httpx
import numpy as np
import pytest
import torch
from fastapi import FastAPI
from meta.model import MAML, FewShotLearner, MAMLModel


def learner():
    torch.manual_seed(42)
    return MAML(MAMLModel(2, 8, 1, num_layers=1), inner_lr=0.1)


def inputs():
    return np.array([[1., 0.], [0., 1.]], dtype=np.float32), np.array([2., -2.], dtype=np.float32), np.array([[1., 1.], [2., 0.]], dtype=np.float32)


@pytest.mark.parametrize('steps', [1, 2, 4])
def test_scalar_labels_equal_exact_row_columns_without_broadcast(steps):
    maml = learner()
    maml.model.eval()
    few = FewShotLearner(maml)
    sx, sy, qx = inputs()
    torch.testing.assert_close(torch.from_numpy(few.few_shot_predict(sx, sy, qx, steps)),
                               torch.from_numpy(few.few_shot_predict(sx, sy[:, None], qx, steps)))


@pytest.mark.parametrize('training', [True, False])
def test_few_shot_predictions_repeat_without_shared_mode_or_rng_mutation(training):
    maml = learner()
    maml.model.train(training)
    before = copy.deepcopy(maml.model.state_dict())
    modes = [module.training for module in maml.model.modules()]
    sx, sy, qx = inputs()
    rng = torch.get_rng_state().clone()
    few = FewShotLearner(maml)
    first = few.few_shot_predict(sx, sy, qx, 3)
    second = few.few_shot_predict(sx, sy, qx, 3)
    np.testing.assert_array_equal(first, second)
    assert [module.training for module in maml.model.modules()] == modes
    torch.testing.assert_close(torch.get_rng_state(), rng)
    for key, tensor in before.items():
        torch.testing.assert_close(maml.model.state_dict()[key], tensor)


def test_adapted_eval_and_train_modes_are_private():
    maml = learner()
    sx, sy, _ = inputs()
    adapted = maml.adapt(torch.tensor(sx), torch.tensor(sy[:, None]), 1)
    adapted.eval()
    assert not adapted.base_model.training
    assert maml.model.training
    maml.model.eval()
    adapted.train()
    assert adapted.base_model.training
    assert not maml.model.training
    assert adapted.base_model is not maml.model


def test_inner_update_private_eval_retains_meta_gradient_links():
    maml = learner()
    sx, sy, qx = inputs()
    adapted = maml.inner_update(maml.model, torch.tensor(sx), torch.tensor(sy))
    adapted.eval()
    loss = adapted(torch.tensor(qx)).square().sum()
    grads = torch.autograd.grad(loss, tuple(maml.model.parameters()))
    assert all(torch.isfinite(g).all() for g in grads)
    assert sum(g.abs().sum() for g in grads) > 0
    assert maml.model.training


def test_eval_adaptation_preserves_second_order_meta_gradients():
    maml = learner()
    sx, sy, qx = inputs()
    adapted = maml.adapt(torch.tensor(sx), torch.tensor(sy), 2, training=False)
    grad = torch.autograd.grad(adapted(torch.tensor(qx)).square().sum(), tuple(maml.model.parameters()), create_graph=True)
    higher = torch.autograd.grad(sum(g.square().sum() for g in grad), tuple(maml.model.parameters()), allow_unused=True)
    assert any(g is not None and g.abs().sum() > 0 for g in higher)
    assert maml.model.training


@pytest.mark.parametrize('shape', [(1,), (2, 2), (3, 1)])
def test_mismatched_target_shapes_are_rejected_before_broadcast(shape):
    maml = learner()
    with pytest.raises(ValueError, match='targets must match'):
        maml.adapt(torch.ones(2, 2), torch.ones(shape), 1)


def test_native_meta_training_accepts_scalar_row_labels():
    maml = learner()
    sx, sy, qx = inputs()
    tasks = [(torch.tensor(sx), torch.tensor(sy), torch.tensor(qx), torch.tensor([1., 2.]))]
    loss = maml.meta_train_step(tasks)
    assert np.isfinite(loss)
    assert all(parameter.grad is not None for parameter in maml.model.parameters())


def test_classification_adaptation_is_private_eval_and_does_not_draw_dropout_rng():
    maml = learner()
    few = FewShotLearner(maml)
    sx, _, qx = inputs()
    rng = torch.get_rng_state().clone()
    first = few.few_shot_classify({'0': sx[:1], '1': sx[1:]}, qx, 2)
    second = few.few_shot_classify({'0': sx[:1], '1': sx[1:]}, qx, 2)
    np.testing.assert_array_equal(first, second)
    torch.testing.assert_close(torch.get_rng_state(), rng)
    assert maml.model.training


@pytest.mark.asyncio
async def test_actual_asgi_fewshot_prediction_repeatability_and_label_validation(monkeypatch):
    from routes import meta_routes as r
    monkeypatch.setattr(r, 'few_shot', FewShotLearner(learner()))
    app = FastAPI()
    app.include_router(r.router)
    sx, sy, qx = inputs()
    body = {'support_x': sx.tolist(), 'support_y': sy.tolist(), 'query_x': qx.tolist(), 'steps': 2}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        first = await client.post('/meta/few-shot/predict', json=body)
        second = await client.post('/meta/few-shot/predict', json=body)
        assert first.status_code == second.status_code == 200
        assert first.json()['data'] == second.json()['data']
        body['support_y'] = [1.]
        invalid = await client.post('/meta/few-shot/predict', json=body)
        assert invalid.status_code == 422
    assert r.few_shot.maml.model.training
