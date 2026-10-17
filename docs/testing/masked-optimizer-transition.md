# Masked-token optimizer transition recovery

Actual Torch2.8 CPU reproduction on the mounted masked-token trainer accepted an infinite configured learning rate: one real CE/backward/clipping/AdamW step reported a finite loss while21 parameter tensors became nonfinite. A huge but finite1e308 learning rate after a normal warm step also returned successful metrics with nonfinite model parameters and advanced optimizer counters. Native Torch already rejects a NaN configured learning rate; that was not the reported constructor defect.

The trainer now admits finite learning rate and native AdamW policy/state. Before a supervised step it snapshots model parameters/buffers, optimizer state, existing gradients and every module's training mode. Success requires a finite complete model and optimizer state after actual AdamW. Exceptional or nonfinite work restores the exact prior native state and rethrows, so callers can correct policy and retry. Parameter objects stay in place. Zero-supervision steps remain true no-ops. Successful native clipping/AdamW mathematics remains unchanged.

A reentrant operation lock serializes step, train and validation on this trainer. It prevents a validation mode switch or parameter read from racing its own optimizer work. Previous successful steps remain committed if a later step fails; this is not whole-epoch atomicity.

## Native verification

The existing `.github/workflows/foundation-masked-pretraining.yml` now runs19 new transition controls plus32 existing objective/compatibility tests. With its pinned native Torch2.8 CPU, NumPy1.26.4 and pytest9 dependencies:

```sh
OMP_NUM_THREADS=1 PYTHONPATH=backend/ml python -m pytest backend/ml/tests/test_foundation_mlm_objective.py backend/ml/tests/test_mlm_optimizer_transition.py -q
```

51 local tests pass. An independent tiny native cross-entropy/AdamW reference matches a successful step and a corrected retry after failure. Controlled faults are applied only after real AdamW work to exercise exception, model-parameter, buffer and moment failures. Tests compare exact prior tensors, moments, counters, gradients, modes and scheduler state. Concurrent actual validation waits for the admitted optimizer operation. Five selected unchanged-main recovery controls fail, demonstrating the regression rather than only mirroring helper structure.

## Cost and boundaries

Snapshots add memory proportional to the full model/buffers, AdamW state and retained gradients, plus copy/finite-check time on each supervised step. This correctness repair claims no training speed improvement or large-model benchmark. Snapshot allocation occurs before training mutation; allocation failures do not start the step. Verification is native CPU only, not a GPU performance claim.

Ownership applies to operations on this trainer instance. Other trainers or direct external reads/writes of the same model/optimizer bypass it; this is not cross-trainer or process/distributed ownership. Global RNG advancement is not rolled back. Invalid configuration/state remains invalid until the caller explicitly corrects it. Supervised training, scheduler redesign, formal model-quality guarantees and providers are outside scope. No production model or paid resource was used.
