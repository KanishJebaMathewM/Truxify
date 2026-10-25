# Native categorical REINFORCE contract

Training computes selected action log probabilities with `log_softmax` directly
from logits. It reuses the existing registered policy modules before the final
public Softmax; parameter/checkpoint keys and public probabilities remain intact.
There is no floor/clamp that biases rare-action gradients.

Each state row owns one action and reward. `[rows,1]` rewards normalize to
`[rows]`; malformed shape, out-of-range/fractional action and nonfinite data fail
before optimizer updates. Every trajectory validates before flattening/shuffling,
preventing mismatched per-trajectory row counts from shifting credit assignment.
Existing reward normalization remains; no reward/business/safety policy change.
Unrepresentable loss or gradient norms stop before Adam updates.

```sh
PYTHONPATH=backend/ml OMP_NUM_THREADS=1 python -m pytest -q \
  backend/ml/tests/test_reinforce_logit_contract.py backend/ml/tests/test_imitation.py
python -m ruff check backend/ml/imitation/model.py \
  backend/ml/tests/test_reinforce_logit_contract.py --select E9,F63,F7,F82
```

23 new native controls pass; the unchanged source fails18/passes5. Tests verify
an exact saturated-logit2000loss with finite Adam states, closed-form selected
categorical gradients, singleton/column rewards, row IDs through short shuffled
batches, malformed full-trajectory no-update behavior and actual mounted local
training with a small real native policy. The existing BC init control passes.

The focused Linux gate includes actual route-registry PyG dependencies. This
establishes neither broad optional-module/backend CI nor production model quality
or training throughput. Behavior-cloning/IRL/PIRL algorithms, providers,
checkpoint publication and deployments are outside this scope.
