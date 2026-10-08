# Native PCGrad dynamic range

`GradientSurgery.pcgrad` delegates to an owned numerical projection helper.
The previous raw dot and squared norm overflowed on finite float32 `1e20`
and float64 `1e200` gradients; float32 `1e-23` conflicts underflowed and were
silently skipped. The ordered full-coordinate contract from #17169 remains.

## Projection coordinates

For original gradient `g_i`, retain scale `s_i = max(abs(g_i))` and normalized
coordinates `u_i = g_i / s_i`. Zero vectors are kept zero. In float64, for each
other original normalized target `u_j` in the existing deterministic order:

```
if dot(current_i, u_j) < 0:
    current_i -= dot(current_i, u_j) / dot(u_j, u_j) * u_j
```

The target's original scale cancels algebraically. Nonzero normalized targets
have a coordinate of magnitude one, so their squared norm cannot underflow;
the collection's work limits bound sums. Each source stays normalized through
all projections, and its original scale is restored once at the output boundary.
Finite output in the original shape, dtype and device is required; an
unrepresentable projection raises rather than clamping or returning infinity.
No partial result list escapes on failure. Inputs are detached and cloned,
including singleton and empty tensors. Caller mutation during admission/copy is
unsupported; ownership begins with the completed private snapshot.

## Supported contract and limits

- A list/tuple of at most64 compatible strided tensors, with identical shape,
  device and dtype; empty collections and empty/scalar tensors are supported.
- Real float16, bfloat16, float32 and float64 on CPU/CUDA. CPU Torch2.8.0 is
  natively verified; CUDA is admitted but not exercised by this CPU workflow.
  MPS/meta/sparse/complex/integer and mixed layouts/types are rejected.
- At most8million total input coordinates and128million ordered pair-coordinate
  operations. These are library work policies, not measured latency guarantees.
- Ordinary binary floating rounding remains. Near-cancelling dots and coordinates
  beyond float64's relative dynamic range can lose information; this is not exact
  PCGrad arithmetic. Exact rational arithmetic is only the independent test oracle.
- Gradients are optimizer inputs, not differentiable outputs; no second-order
  autograd link is promised. No stochastic reshuffling or new PCGrad variant.
- Finite projected gradients do not guarantee finite downstream task sums, Adam
  moments, losses or model weights. Their admission/recovery is separate work.
  No GPU accuracy, trained model quality or full-service bootstrap claim.

## Native verification

`test_pcgrad_dynamic_range.py` compares220 seeded pairs across11 dtype/scale
combinations with exact binary Fraction projections, normalized at output to
prevent tiny-value absolute tolerance from hiding a wrong result. Independent
analytic/three-task controls, noncontiguous singleton ownership, work/type/finite
admission, unrepresentable outputs, actual autograd and a three-step native Adam
reference exercise the public class and actual trainer. Existing heterogeneous
weighted full-coordinate, checkpoint, logits and named-target consumers also run.

The existing disconnected-parameter fixture now constructs a coherent trainer
after registering that parameter, preserving the already-merged generation API
instead of replacing its optimizer independently. No production checkpoint
behavior or parameter layout is changed.
