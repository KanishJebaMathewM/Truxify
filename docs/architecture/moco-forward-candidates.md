# MoCo native forward candidates

A training forward now admits the paired views, registered query/key
parameters, dictionary geometry/content/pointer and momentum/temperature policy
before preparing a candidate. Finite compatible observations are copied.
The query copy preserves input autograd; the key view/dictionary are detached.
Keys must remain frozen. Query/key parameter names/shapes/dtypes/devices must
match. Existing literal queue insertion remains available; this forward does
not impose a new unit-norm constraint on an externally supplied finite queue.

The EMA parameters are formed privately and actual native
`torch.func.functional_call` runs the existing key encoder with them. Query
encoding uses the registered query encoder. Only a finite native contrastive
logit tensor and finite cross-entropy objective admit publication of the
complete prepared key/queue/pointer candidate. Ordinary encoding exceptions or
nonrepresentable objectives leave these registered states unchanged. The
owned dictionary used by autograd is distinct from the next dictionary: its
version cannot change when accepted observations are enqueued. Parameter and
buffer identities/checkpoint keys are preserved. Eval uses the existing key
without publishing any dictionary change. Exact momentum 0/1 cases copy their
source; intermediate binary32/half EMA accumulates in binary64 before checked
conversion. This introduces ordinary rounding differences, not a new EMA law.

Feature L2 normalization divides by an owned detached maximum amplitude,
computes a bounded norm, then uses native normalized direction. Below the
original epsilon 1e-12, it preserves `features / epsilon`, including genuine
zero output and its epsilon derivative. Half/bfloat16 features and objective
arithmetic promote to float32; published keys retain dictionary dtype.
The query parameter/input graph remains native. Scaled cancellation and the
limits of native floating arithmetic remain; this is not exact arithmetic or
a promise that every subsequent parameter derivative/optimizer step is finite.

Limits: 8,000,000 values each for supplied views, projected observations,
dictionary and one encoder's parameters; 64,000,000 candidate logits. These
are library work/admission policies, not measured latency or total-memory
bounds. CPU Torch 2.8 tested for float16/bfloat16/float32/float64; CUDA admitted
but untested; other devices unsupported by this candidate implementation.
Publication is one ordinary forward's protocol, not a concurrent transaction
with external optimizer updates/readers, checkpoint writers or custom hooks.
Native functional parameter substitution is temporary; concurrent access to
that encoder is unsupported. Custom forward/state hooks that mutate registered
state, external topology/config mutation, process interruption, RNG replay,
late backward failure and AdamW rollback remain outside this repair. An
accepted forward still updates the dictionary before backward, as ordinary
MoCo does. This PR does not repair SimCLR/MAE or full training admission.

## Independent native evidence

Untouched main returns a NaN loss at positive finite temperature 1e-45 while
changing EMA and queue pointer, and finite 1e38 features enqueue a zero key.
The repaired native model rejects nonfinite logits and a separate native
cross-entropy overflow with finite logits before publication; native Linear
overflow and controlled encoder callback failures also preserve the dictionary.
Large binary32/64 feature controls match a closed-form normalized direction
and logsumexp objective. Query derivatives match an independent analytic
normalization Jacobian from very small through very large amplitudes. Native
half models, zero epsilon semantics, serial ring-buffer/EMA references,
checkpoint continuation and caller mutation controls pass.

144 native tests PASS across new candidate and existing MoCo/SimCLR/MAE suites.
New helper/tests receive full Ruff; changed legacy model receives
E9,F63,F7,F82,I,F401 analysis. No production providers, GPU hardware,
full service bootstrap, trained accuracy or score/merge guarantee.
