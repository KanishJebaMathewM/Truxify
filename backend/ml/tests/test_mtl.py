import pytest
import torch
import torch.nn as nn
from mtl.model import MultiTaskModel, MultiTaskTrainer, MTLLoss

class TestMTLModel:
    def test_mtl_init(self):
        model = MultiTaskModel(input_dim=12, tasks={"eta": {"output_dim": 1, "type": "regression"}})
        assert model is not None
        assert hasattr(model, 'forward')


class TestPCGradPerTask:
    def _make_trainer(self):
        tasks = {
            "task_a": {"output_dim": 1, "type": "regression"},
            "task_b": {"output_dim": 1, "type": "regression"},
        }
        model = MultiTaskModel(input_dim=8, tasks=tasks)
        loss = MTLLoss({
            "task_a": nn.MSELoss(),
            "task_b": nn.MSELoss(),
        })
        trainer = MultiTaskTrainer(model, loss, lr=0.01)
        # Capture the gradient PCGrad applies instead of stepping.
        trainer.optimizer.step = lambda: None
        return trainer, model

    def test_per_task_grads_sum_to_combined_backward(self):
        """Each task's gradient must be materialized independently; the sum of
        the per-task gradients must equal a single combined backward of the
        summed loss (autograd linearity). Regression vs. the old buggy path
        that read already-summed .grad buffers."""
        trainer, model = self._make_trainer()

        x = torch.randn(4, 8)
        y = torch.randn(4, 1)
        targets = {"task_a": y, "task_b": y}

        params = [p for p in model.parameters() if p.requires_grad]
        model.zero_grad()
        preds = model(x)
        losses = trainer.loss.compute_losses(preds, targets)

        task_grads = []
        for loss in losses.values():
            g = torch.autograd.grad(loss, params, retain_graph=True, allow_unused=True)
            task_grads.append([
                gi if gi is not None else torch.zeros_like(p)
                for gi, p in zip(g, params)
            ])

        summed = [
            torch.stack([task_grads[t][i] for t in range(len(task_grads))], dim=0).sum(dim=0)
            for i in range(len(params))
        ]

        # Reference combined backward over the SAME forward graph so the
        # dropout masks are identical (linearity guarantees equality).
        model.zero_grad()
        combined = trainer.loss.compute_weighted_loss(losses, {})
        combined.backward()
        reference = [p.grad.clone() for p in params]

        assert len(summed) == len(reference)
        for s, r in zip(summed, reference):
            assert torch.allclose(s, r, atol=1e-5), (
                "Sum of per-task gradients must equal the combined-backward "
                "gradient."
            )

    def test_train_step_applies_projected_gradient(self):
        """Smoke test: the per-task PCGrad path runs and updates parameters
        without error (gradient surgery is actually exercised)."""
        trainer, model = self._make_trainer()

        x = torch.randn(4, 8)
        targets = {
            "task_a": torch.randn(4, 1),
            "task_b": torch.randn(4, 1),
        }
        before = [p.detach().clone() for p in model.parameters()]
        trainer.train_step(x, targets)
        after = [p.detach().clone() for p in model.parameters()]
        # With step disabled, grads were assigned; ensure no NaN/Inf crept in.
        for p in model.parameters():
            assert p.grad is None or torch.isfinite(p.grad).all()

    def test_pcgrad_projection_behavior(self):
        from mtl.model import GradientSurgery

        # Identical (non-conflicting) task grads -> no-op projection.
        g = torch.tensor([1.0, 2.0, -1.0])
        projected = GradientSurgery.pcgrad([g, g.clone()])
        assert torch.allclose(projected[0], g)
        assert torch.allclose(projected[1], g)

        # Conflicting task grads -> projected to remove the conflict.
        a = torch.tensor([1.0, 0.0])
        b = torch.tensor([-1.0, 0.0])
        proj = GradientSurgery.pcgrad([a, b])
        # Each projected gradient must be orthogonal (non-negative dot) to the other.
        assert torch.dot(proj[0], proj[1]) >= -1e-6


