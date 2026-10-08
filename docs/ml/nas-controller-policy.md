# Native reinforcement architecture controller

The prior `RLNASController` sampled uniform Python architectures and its reward
update was a no-op. The repaired Python interface uses an actual CPU recurrent
categorical policy. `nas.model.RLNASController` remains the compatibility import.
The original unused LSTM checkpoint layout is incompatible with this new policy;
no checkpoint migration or HTTP reinforcement method is introduced.

The policy samples depth first, then operation, filter count and activation for
each layer, conditioned on previous decisions through native LSTMCell state.
Supported configured choices are snapshotted at construction; filters are
multiples of eight. Limits: 1..32 depth, at most64 distinct supported operations
or activations, 1..128 filter choices within1..4096, CPU float32/64 coherent native
parameters, and finite rewards within +/-1e6. Default choices retain existing
NAS operations, including the existing `zero` operation behavior.

There is exactly one outstanding owned on-policy sample. Return dictionaries
are independent copies. `update_controller(architecture,reward)` must match that
sample and its exact sampled parameter generation. Mutated, replayed, missing
or changed-policy observations are rejected. `discard_sample()` releases an
unevaluated trajectory, without restoring sampling RNG. Operations share a
native RLock. Direct external concurrent parameter/optimizer mutation is not
covered; update schema checks do not provide a cross-process transaction.

Teacher-forced reconstruction computes the sampled trajectory log-probability
under the unchanged policy. The objective is `-(reward - prior_baseline) *
sum(log_probability)`. Native Adam uses those gradients; after a successful
candidate, the running baseline becomes `.9 * prior_baseline + .1 * reward`.
The first baseline is zero; a zero-advantage observation records evaluation and
best/history identity without an Adam step. These are supplied evaluation scores,
not predicted accuracy or a guarantee of improvement or optimality. The policy
gradient approach is based on [Zoph and Le](https://arxiv.org/abs/1611.01578);
this small bounded implementation does not replicate their search benchmark.

Finite policy/logits/objective/gradients/native Adam parameters and moments are
required. Failed ordinary native updates restore registered parameter values,
Adam state and prior gradients, retaining the pending sample and previous
baseline/best metadata. An admitted earlier search update is not rolled back
if a later evaluator fails. Custom hooks, asynchronous cancellation, RNG,
whole-search rollback and custom optimizer topology are excluded. Failed native
candidates may have executed transiently before recovery; this is an in-process
publication boundary, not isolation from external readers.

`NASSearcher.reinforcement_search(num_trials,evaluator)` requires a caller
supplied evaluator and caps trials at128. It evaluates separate genotype copies,
updates the actual policy, and publishes separately owned architecture/score
history and best evaluated architecture only after a completed run. Its result
marks `score_source: provided_evaluator`. A failed evaluator leaves the previous
published search result intact. Random/evolutionary behavior and their synthetic
default scores remain unchanged. Caller evaluators own model fitting/data splits,
real accuracy measurements and any cost; the implementation does not contact
providers or control hardware. No synthetic scores are presented as learned
validation accuracy.

Focused native tests use an independent categorical log-probability and gradient
formula, exact first-step Adam references for positive/negative/zero advantages,
autoregressive logsumexp/gradient references, actual policy-controlled sampling,
reward baseline/replay/mutated schema checks, real native moment overflow and
post-step failure recovery, concurrent samplers, and an actual NASModel evaluator
whose explicit reward is negative measured parameter count, not accuracy.
Existing genotype identity, construction and execution suites remain included.
