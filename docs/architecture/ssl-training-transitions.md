# Native SSL training transitions

All three SSLPreTrainer entry points share one owned dataset and native AdamW
transition protocol. SimCLR/MoCo observations are `[rows, input_dim]`; MAE
observations are `[rows, tokens, input_dim]`. Complete finite compatible data
is checked/copied before the first update. Method/model type must agree.
Positive integer rows≤10000, epochs≤100 and batch_size≤8192, 8,000,000 data
values and 500,000,000 value-epoch work are library admission policies.
Contrastive jobs additionally admit at most 16,000,000 peak logits and
500,000,000 total logit entries across epochs, using exact full/tail batch
counts and the selected contrastive geometry. These are not measured latency,
total model-memory or feature-dimensional FLOP bounds. The existing
contrastive implementations can impose their own limits.

The model's complete registered state must be finite/strided and fit an
8,000,000-value recovery budget. Native AdamW must own exactly the registered
parameters without duplicates/foreign state. Scalar lr/eps/decay and betas,
finite compatible moments/nonnegative variances, integral scalar step and
AMSGrad state are admitted before training. Moment recovery is bounded to
24,000,000 tensor values. Real CPU/CUDA float16/bfloat16/float32/float64 model
state is admitted; CPU Torch 2.8 tested, CUDA untested. Numerical failures in
native lower-precision losses/derivatives may still reject an admitted input.

An RLock serializes complete operations on one trainer. Before each batch,
owned registered model/native AdamW/previous gradients/module modes are
captured. The actual existing SSL forward/objective executes in training mode,
followed by finite objective/derivative checks, native clipping and actual
AdamW. Finite compatible model/moment candidate checks precede successful
completion. Ordinary failed/rejected batches restore captured state with model,
optimizer, parameter and registered buffer identities preserved. This includes
MoCo momentum keys, dictionary and pointer already advanced by the ordinary
forward. Earlier accepted minibatches remain accepted after a later failure.
Reported epoch objectives are sample-weighted means of native batch losses.

MAE retains Bernoulli masking and its observed/skipped counts. A no-observation
batch performs no optimizer advancement and restores prior gradients/modes as
well as model/moments. Actual native nonempty masks still learn normally.
SimCLR/MoCo augmentation, contrastive algorithms, MAE reconstruction objective
and checkpoint format are unchanged. Successful training leaves training mode;
failed batch recovery restores its prior mixed modes.

The generic and specialized mounted endpoints use strict bounded request
counts and validate selected geometry/work before allocating synthetic data.
Contrastive routes now create rank 2 observations; MAE creates rank 3 with 50
sequence positions. The specialized endpoint selects its own method; the
request method enum remains validated. Client admission returns 422, native
failures generic 500. Full global models/AdamW and mounted ASGI requests are
used in the tests; no numerical operators/provider outputs are replaced.

Limits: training operations on this one trainer are serialized, not direct
external model/optimizer access, other trainers, checkpoint readers/writers,
providers or distributed training. Whole epoch/process/crash/asynchronous
cancellation, RNG replay, external topology/config mutation and custom hooks
with independent state effects are not transactional. Ordinary controlled
native post-step callback failures restore registered state; arbitrary custom
state/load hooks are unsupported. Prior gradient values are restored but
external aliases to previous gradient tensors need not retain identity.

## Native evidence

Untouched main actual AdamW at finite lr 1e30/decay 1e30 reports finite successful
loss but leaves nonfinite model state in SimCLR, MoCo and MAE. The repaired
trainer rejects that actual candidate, restores populated moments and MoCo
dictionary state, and accepts a later valid native update. Native post-step
callback failures also recover prior gradients/modes. Independent model,
objective and AdamW update controls match accepted training. Complete late
NaN/geometry/policy rejection precedes updates; caller mutation cannot change
owned observations. Native threads prove operations do not interleave.

174 local tests PASS with existing MoCo/SimCLR/MAE consumers; no deselections.
Actual pending MoCo candidate source from PR #17803 plus this source integrate
218 PASS. Existing AnyIO TestClient deprecation remains. New helper/tests
receive full Ruff, changed legacy sources E9,F63,F7,F82,I,F401. No provider,
GPU hardware, default external service bootstrap, trained accuracy or guaranteed
Hard/30 award/merge is claimed.
