# Foundation finetuning observations and objectives

`FoundationModelTrainer.train`, `train_step`, `validate` and `_prepare_batch`
accept an explicit `task`: classification (the backward-compatible default)
or regression. Classification uses integer `[batch]` labels, the class head,
and native cross entropy. Regression preserves finite fractional floating
`[batch, 1]` targets in the regression head's dtype and uses native MSE.
The generic public `criterion` attribute remains for source compatibility;
finetuning objective selection is now explicit, not a custom criterion hook.
The mounted finetune route passes its selected task and epochs directly;
it does not mutate shared config for that invocation. This does not isolate
all global model/vocabulary state or fence concurrent training/prediction.

Before a full training operation starts, both entire record collections are
checked and copied. Missing labels/tokens, empty observations, invalid token
IDs (including in a truncated tail), invalid class indices, and nonfinite or
unrepresentable regression labels reject before changing model mode,
previous gradients, AdamW or scheduler. Caller record order and tokens remain
owned by the caller. Finite representability alone does not guarantee a finite
MSE, gradients or optimizer transition: numerical recovery is outside this
admission change. Earlier accepted minibatches are not rolled back if a native
failure occurs later. RNG, custom callback effects, external topology/config
mutation and process failures are not transactional.

Sequences are truncated to admitted max_len, then padded only to the longest
retained sequence in each batch. The binary keep mask is constructed from
observed lengths, not token IDs: a genuine ID 0 is retained. Both training and
validation pass the mask to the existing attention and pooling implementation.
Direct tensor batches are copied/detached, checked for geometry/IDs/labels and
binary nonempty keep masks before training changes. An omitted direct-batch
mask means every supplied token is an observation. Validation computes the
sample-weighted mean of native losses and restores each module's prior mode.
Default direct tensor use remains classification; regression requires the
explicit task and floating `[batch, 1]` labels.

Library policies: at most 50,000 records per collection, 2,000,000 supplied
IDs per collection (including truncated tails), positive max_len at most 4096
and within the real positional buffer, batch_size at most 8192, epochs at
most 100, and `(train records + validation records) * max_len * epochs` at
most 100,000,000. Direct batch tensors also have a 2,000,000-ID limit. These
bound admission and conservative padded-token work; they are not a measured
latency, quadratic attention FLOP or total model-memory guarantee. Full loops
require a stable externally configured model/config. The existing cosine
scheduler construction and per-update stepping remain unchanged; this PR
makes no new schedule-horizon promise. Pretraining/MLM, prediction-route
padding, checkpoint publication and upload/path rules remain separate.

## Native evidence

Python3.12/CPU Torch2.8.0/NumPy1.26.4: actual classification and regression
losses, clipped derivatives, model updates and full AdamW moments match an
independently constructed native reference. Actual co-batching/padded input
predictions agree with the unpadded observation, including genuine ID 0.
Invalid late train or validation records preserve the complete live native
state. A real forward callback mutating caller tensors proves batch ownership.
Mounted upload requests use the actual route/processor/trainer/model/AdamW;
only bootstrap dimensions are reduced to a tiny model. Internal native
ValueError remains 500, typed admission failure 422. No production provider,
GPU, complete default-model bootstrap or learned accuracy is claimed.

Focused suite: 144 PASS, 12 pytest subtests PASS; one explicitly excluded
unchanged `test_create_pretraining_data_shape` expects no pad_id although the
merged MLM data producer adds it. The broader run reproduces that one failure
with 143 other tests passing before the last native failure-classification test
was added. Existing AnyIO TestClient deprecation remains. New files receive
full Ruff; changed legacy sources receive E9,F63,F7,F82,I,F401 checks.
