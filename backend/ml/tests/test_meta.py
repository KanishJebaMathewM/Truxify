import pytest
import torch
from meta.model import MAML, MAMLModel


def _make_task(input_dim=8):
    w = torch.randn(input_dim, 1)
    b = torch.randn(1)
    support_x = torch.randn(5, input_dim)
    support_y = support_x @ w + b
    query_x = torch.randn(5, input_dim)
    query_y = query_x @ w + b
    return support_x, support_y, query_x, query_y


class TestMetaModel:
    def test_maml_init(self):
        model = MAMLModel(input_dim=10, output_dim=1)
        assert model is not None
        assert hasattr(model, 'adapt')

    def test_meta_train_step_backprops_to_meta_params(self):
        """Regression test for #13118: the inner-loop update must not detach
        the graph; meta-model parameters must receive a non-None gradient."""
        torch.manual_seed(0)
        model = MAMLModel(input_dim=8, hidden_dim=16, output_dim=1, num_layers=2)
        maml = MAML(model, inner_lr=0.1, outer_lr=0.1)

        tasks = [_make_task(8) for _ in range(4)]
        maml.meta_train_step(tasks)

        grads = [p.grad for p in maml.model.parameters()]
        assert all(g is not None for g in grads), "meta params received no gradient (graph detached)"
        assert all(g.abs().sum() > 0 for g in grads), "meta gradients are all zero"

    def test_meta_loss_decreases(self):
        """Regression test for #13118: with a working meta-gradient the
        meta-loss should decrease across training steps."""
        torch.manual_seed(0)
        model = MAMLModel(input_dim=8, hidden_dim=16, output_dim=1, num_layers=2)
        maml = MAML(model, inner_lr=0.1, outer_lr=0.1)

        losses = []
        for _ in range(5):
            losses.append(maml.meta_train_step([_make_task(8) for _ in range(4)]))

        assert losses[-1] < losses[0], "meta-loss did not decrease (model not training)"
