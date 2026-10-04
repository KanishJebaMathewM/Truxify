# Native binary task truth

Python3.12 / CPU Torch2.8.0, install requirements.txt then:

```sh
PYTHONPATH=backend/ml OMP_NUM_THREADS=1 python -m pytest -q backend/ml/tests/test_meta_task_truth.py
```

Support and query labels come from the same linear binary halfspace. Normalize
coefficients by their maximum magnitude before computing the unit direction and
boundary, avoiding norm underflow/overflow. Draw the normal component conditional
on the required class; the independent orthogonal Gaussian component is unchanged.
For positive thresholds use exponential proposals with rate
`a/2 + hypot(a/2,1)` and acceptance `exp(-(z-rate)^2/2)`; negative thresholds use
standard-normal proposals. Each class uses one batch of `4*k_shot+64` proposals.
Insufficient accepted samples or unresolved finite boundaries fail explicitly;
there is no unbounded rare-class search. This bounds proposals for a requested
shot count; it is not a general API resource admission limit.

Native tests check actual latent truth, rare tails, conditional moments and
orthogonal independence, extreme coefficient scales, finite proposal counts,
exhaustion and local ASGI behavior. Keys, widths and ten query rows are preserved.
Only binary classes are supported by the latent threshold task; unsupported arity
or nonpositive shot count returns422. Degenerate/nonfinite/unrepresentable tasks
return503 without partial or mislabeled output. This does not change MAML weights,
optimizer, provider or model architecture. Actual-source combination with17112
merges cleanly and passes41 native tests/1stale initialization assertion excluded.
