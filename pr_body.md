## Problem

`backend/ml/marl/mappo_fleet.py` computes the stochastic policy with a numerically unstable softmax:

```python
probs = np.exp(action_logits) / np.sum(np.exp(action_logits))
```

`action_logits` is an unbounded dot product of `state × actor_weights`, so `np.exp(logits)` overflows to `inf` for moderately large logits. The resulting `inf/inf` (or `inf/sum`) yields `NaN`, and `np.argmax(NaN)` returns `0`. The fleet agent therefore collapses to a fixed action (`agent_id = 0`) regardless of state, and large/negative logits silently distort the distribution.

## Fix

Replaced the softmax with a numerically stable version that subtracts the max before exponentiating:

```python
z = action_logits - np.max(action_logits)
e = np.exp(z)
probs = e / np.sum(e)
```

Added a guard for the degenerate all-`-inf` case (falls back to a uniform distribution) and a unit test asserting finite probabilities, a normalized distribution, and that the selected agent matches the argmax of the raw logits (which fails on the old NaN/argmax=0 path).

## Files changed

- `backend/ml/marl/mappo_fleet.py`
- `backend/ml/marl/test_mappo.py` (added `test_stable_softmax_large_logits`)

## Testing

- `python -c "import ast; ast.parse(...)"` for syntax validation.
- `pytest backend/ml/marl/test_mappo.py` passes (2 passed). The new test feeds large-magnitude logits and verifies finite, normalized probabilities and a state-dependent selected agent.

Closes #11388
