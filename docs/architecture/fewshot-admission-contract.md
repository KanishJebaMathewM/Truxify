# Complete few-shot observation and output contract

## Native defect

Before this repair, a scalar regression score was rounded to an unrestricted category and squeezed across all dimensions. A native model with bias 3, binary support classes 0/1 and one adaptation step produced category 2 and a scalar single-query output. NaN support targets returned NaN predictions, and negative steps silently skipped adaptation.

## Complete admission and ownership

Regression and binary classification own the entire support, target and query collection before adapting. Dense real observations must be nonempty, paired, finite and representable in the active model dtype/device. Scalar support targets normalize to exact row columns. Model float32/64 CPU/CUDA placement is retained; no unconditional float32 conversion occurs. Public NumPy observations are copied; direct tensor adaptation clones while preserving differentiable input links.

Steps are strict integers from 1 to 32; every feature collection has at most 4096 rows, complete observations at most 1048576 values, and support row-step-parameter and query row-parameter work each at most 64000000. These are library admission policies, not model accuracy estimates. All query admission precedes native support forward and graph allocation. One existing generation lock covers consumer admission/adaptation/prediction so observations cannot straddle checkpoint publication.

## Native private adaptation

The existing private evaluation modules, exact paired MSE objective and differentiable parameter links are retained. Native support predictions/objective, actual autograd gradients, each adapted parameter and final native query predictions must be finite. Failure does not publish adapted parameters or advance shared Adam. Shared model weights, optimizer, prior gradients and mixed modes remain unchanged. Existing tests verify second-order parameter links, including direct tensor input links.

This is finite private inference admission, not a replacement for meta-training transition recovery, optimizer/checkpoint transactions, RNG recovery for arbitrary training-mode hooks, asynchronous cancellation or cross-process/external mutation fences. CUDA is admitted but only CPU Torch 2.8 is tested.

## Honest binary score contract

This repository has a scalar MSE head and binary task sampler. Classification requires exactly nonempty classes `0` and `1` and one scalar model output; arbitrary ordinal labels and multiclass sets are rejected instead of pretending to be a multiclass classifier. A finite score greater than 0.5 maps to class 1, otherwise class 0, preserving the prior binary midpoint tie. Scores are regression outputs, not calibrated probabilities. Output is always a one-dimensional integer vector with one category per query, including a single query.

Regression remains an [query rows, output_dim] array. Mounted prediction/classification run synchronously in FastAPI's native worker pool and reject malformed observations/policies with 422 and native failures with generic 500. These are compatibility changes from silent coercion/no-op adaptation and unrestricted rounded labels. Existing task generation, training and checkpoint APIs remain intact; no production datasets/providers/hardware or real logistics quality claim.

## Evidence

Independent analytic affine MSE gradient recurrences match actual native adaptation for 1, 2 and 32 steps in float32/64. Synthetic extreme/midpoint binary scores preserve category/query identity. Actual finite-input candidate overflow, nonfinite loss/query output, complete query admission before hooks, caller mutation during native forward, prior gradient/mode preservation, work limits and full default-model ASGI consumers are covered. Existing inference/meta-gradient, task truth, training and checkpoint suites remain included.
