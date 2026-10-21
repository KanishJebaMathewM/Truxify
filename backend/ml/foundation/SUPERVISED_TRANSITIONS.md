# Supervised native transitions

`FoundationModelTrainer.train_step` admits an owned direct classification tensor
batch before changing modes, clearing gradients or executing the model. Missing
masks keep the legacy all-token behavior; supplied token masks require a binary
keep value and at least one observed token per row. Record packing and named
task objectives remain separate finetuning concerns (#17799).

The existing `optimizer_transition` context accepts an optional native cosine
scheduler. With that argument, a supervised AdamW update and its cosine step
publish together after finite model/buffer/moment, scheduler policy and coherent
count/learning-rate checks. On an ordinary exception or nonfinite candidate,
registered parameter values, optimizer state, scheduler state, prior gradients
and every module's prior training mode are restored. Registered parameter
objects are retained. Previously accepted batches are retained too.

Native objective and gradient norm checks run before AdamW. Successful updates
use the existing CE, clipping, AdamW and cosine formulas. A per-trainer reentrant
lock serializes train, direct train steps and validation, including the complete
optimizer/scheduler interval. Existing two-argument masked-token consumers keep
their optimizer-only protocol.

Recovery stores model and optimizer snapshots per batch, so memory use increases
with model size and existing AdamW moments. This is process-local recovery for
ordinary native AdamW/CosineAnnealingLR; custom optimizer/scheduler classes,
external parameter mutations, arbitrary hooks, RNG consumption, whole epochs,
checkpoint publication, cross-process work and physical quality are outside the
contract. A process termination or device failure that prevents state restoration
cannot be recovered by this context. No default large model bootstrap or provider
is needed for the focused native tests.
