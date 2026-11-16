"""Native numerical surgery against independent exact binary rational projection."""

import random
from fractions import Fraction

import pytest
import torch
from mtl.gradient_projection import MAX_PAIR_COORDINATES, project_conflicts
from mtl.model import GradientSurgery, MTLLoss, MultiTaskTrainer
from torch import nn


def rational_reference(vectors):
    """Project exact binary input values in Fraction arithmetic, not Torch dots."""
    originals = [[Fraction(float(x)) for x in value.flatten()] for value in vectors]
    resolved = []
    for i, value in enumerate(originals):
        current = value.copy()
        for j, other in enumerate(originals):
            if i == j:
                continue
            dot = sum(a * b for a, b in zip(current, other))
            norm = sum(x * x for x in other)
            if dot < 0 and norm:
                current = [a - dot / norm * b for a, b in zip(current, other)]
        resolved.append(torch.tensor([float(x) for x in current], dtype=vectors[i].dtype)
                        .reshape(vectors[i].shape))
    return resolved


@pytest.mark.parametrize("dtype,scale", [
    (torch.float32, 1e-30), (torch.float32, 1e-23), (torch.float32, 1e20),
    (torch.float32, 1e30), (torch.float64, 1e-200), (torch.float64, 1e200),
    (torch.float64, 1e300), (torch.float16, 1e4), (torch.float16, 1e-6),
    (torch.bfloat16, 1e20), (torch.bfloat16, 1e-30),
])
def test_native_scale_extremes_match_exact_binary_rational_oracle(dtype, scale):
    rng = random.Random(17792)
    for _ in range(20):
        vectors = [torch.tensor([rng.uniform(.5, 1.5) * scale for _ in range(4)], dtype=dtype),
                   -torch.tensor([rng.uniform(.5, 1.5) * scale for _ in range(4)], dtype=dtype)]
        saved = [x.clone() for x in vectors]
        expected = rational_reference(vectors)
        actual = GradientSurgery.pcgrad(vectors)
        # Compare in normalized float64 coordinates so underflow cannot hide a
        # wrong tiny vector and output rounding is judged at the original dtype.
        eps = torch.finfo(dtype).eps
        quantum = torch.nextafter(torch.tensor(0., dtype=dtype), torch.tensor(1., dtype=dtype))
        atol = max(float(quantum) / scale, eps * 4)
        for result, reference, source, old in zip(actual, expected, vectors, saved):
            torch.testing.assert_close(result.double() / scale, reference.double() / scale,
                                       atol=atol, rtol=eps * 4)
            assert torch.isfinite(result).all()
            assert result.dtype == source.dtype and result.device == source.device
            assert torch.equal(source, old) and result.data_ptr() != source.data_ptr()


@pytest.mark.parametrize("dtype,scale", [(torch.float32, 1e-23), (torch.float32, 1e20),
                                        (torch.float64, 1e-200), (torch.float64, 1e200)])
def test_analytic_conflict_and_positive_scale_invariance(dtype, scale):
    inputs = [torch.tensor([scale, scale], dtype=dtype), torch.tensor([-scale, 0.], dtype=dtype)]
    result = GradientSurgery.pcgrad(inputs)
    expected = [torch.tensor([0., 1.], dtype=torch.float64), torch.tensor([-.5, .5], dtype=torch.float64)]
    for actual, want in zip(result, expected):
        torch.testing.assert_close(actual.double() / scale, want, atol=1e-6, rtol=1e-6)


def test_ordered_three_task_projection_matches_rational_reference():
    vectors = [torch.tensor([[1e200, 0.]], dtype=torch.float64),
               torch.tensor([[-1e-200, 1e-200]], dtype=torch.float64),
               torch.tensor([[0., -1e200]], dtype=torch.float64)]
    result = project_conflicts(vectors)
    expected = rational_reference(vectors)
    for actual, want in zip(result, expected):
        torch.testing.assert_close(actual, want)


def test_owned_singleton_detaches_autograd_and_preserves_noncontiguous_shape():
    original = torch.arange(6., requires_grad=True).reshape(2, 3).T
    result, = project_conflicts([original])
    assert result.shape == original.shape and not result.requires_grad
    assert result.data_ptr() != original.data_ptr()
    result.zero_()
    assert torch.count_nonzero(original) == 5


@pytest.mark.parametrize("vectors", [[], [torch.empty(0)], [torch.zeros(2), torch.zeros(2)],
                                     [torch.zeros(2), torch.ones(2)],
                                     [torch.tensor(1.), torch.tensor(-2.)]])
def test_empty_zero_and_scalar_gradients(vectors):
    actual = project_conflicts(vectors)
    expected = rational_reference(vectors)
    for result, want in zip(actual, expected):
        assert torch.equal(result, want)


@pytest.mark.parametrize("invalid", [
    "not_sequence", "not_tensor", "integer", "complex", "mixed_shape", "mixed_dtype",
    "nan", "inf", "sparse", "meta", "too_many", "work",
])
def test_complete_collection_admission_rejects_unsupported_inputs(invalid):
    first = torch.tensor([1., 2.])
    vectors = [first, first.clone()]
    if invalid == "not_sequence": vectors = iter(vectors)
    elif invalid == "not_tensor": vectors[1] = [1., 2.]
    elif invalid == "integer": vectors = [torch.ones(2, dtype=torch.int64)]
    elif invalid == "complex": vectors = [torch.ones(2, dtype=torch.complex64)]
    elif invalid == "mixed_shape": vectors[1] = torch.ones(3)
    elif invalid == "mixed_dtype": vectors[1] = first.double()
    elif invalid == "nan": vectors[1][0] = float("nan")
    elif invalid == "inf": vectors[1][0] = float("inf")
    elif invalid == "sparse": vectors[1] = first.to_sparse()
    elif invalid == "meta": vectors[1] = torch.ones(2, device="meta")
    elif invalid == "too_many": vectors = [first] * 65
    elif invalid == "work": vectors = [torch.zeros(MAX_PAIR_COORDINATES // (64 * 63) + 1)] * 64
    with pytest.raises(ValueError):
        project_conflicts(vectors)
    assert torch.equal(first, torch.tensor([1., 2.]))


@pytest.mark.parametrize("dtype", [torch.float16, torch.bfloat16, torch.float32, torch.float64])
def test_unrepresentable_projection_rejects_without_clamping_or_input_mutation(dtype):
    limit = torch.finfo(dtype).max
    source = torch.tensor([limit, limit], dtype=dtype)
    vectors = [source, torch.tensor([1., -2.], dtype=dtype)]
    with pytest.raises(ValueError, match="not representable"):
        project_conflicts(vectors)
    assert torch.equal(source, torch.tensor([limit, limit], dtype=dtype))


def test_native_autograd_large_finite_derivatives_project_before_raw_squared_norms():
    parameter = nn.Parameter(torch.zeros(2, dtype=torch.float64))
    losses = [parameter @ torch.tensor([1e200, 1e200], dtype=torch.float64),
              parameter @ torch.tensor([-1e200, 0.], dtype=torch.float64)]
    gradients = [torch.autograd.grad(loss, parameter, retain_graph=True)[0] for loss in losses]
    actual = GradientSurgery.pcgrad(gradients)
    expected = rational_reference(gradients)
    for result, reference in zip(actual, expected):
        torch.testing.assert_close(result, reference)


class LinearTasks(nn.Module):
    def __init__(self):
        super().__init__()
        self.weight = nn.Parameter(torch.zeros(2, dtype=torch.float64))
        self.tasks = {"a": {"output_dim": 1}, "b": {"output_dim": 1}}

    def forward_for_loss(self, _):
        return {"a": self.weight.sum(), "b": -self.weight[0]}


class LinearLoss(nn.Module):
    def forward(self, prediction, _):
        return prediction * 1e-200


def test_real_trainer_and_adam_follow_independent_tiny_gradient_reference():
    model = LinearTasks()
    trainer = MultiTaskTrainer(model, MTLLoss({"a": LinearLoss(), "b": LinearLoss()}), device="cpu")
    reference = nn.Parameter(torch.zeros(2, dtype=torch.float64))
    optimizer = torch.optim.Adam([reference], lr=1e-3)
    for _ in range(3):
        result = trainer.train_step(torch.zeros(1, 2, dtype=torch.float64),
                                    {"a": torch.tensor(0.), "b": torch.tensor(0.)})
        reference.grad = torch.tensor([-.5e-200, 1.5e-200], dtype=torch.float64)
        optimizer.step()
        torch.testing.assert_close(model.weight / 1e-200, reference / 1e-200, atol=1e-8, rtol=1e-12)
        torch.testing.assert_close(model.weight.grad / 1e-200, reference.grad / 1e-200)
        assert torch.isfinite(torch.tensor(result["total_loss"]))
    for key in ("step", "exp_avg", "exp_avg_sq"):
        assert torch.equal(trainer.optimizer.state[model.weight][key], optimizer.state[reference][key])
