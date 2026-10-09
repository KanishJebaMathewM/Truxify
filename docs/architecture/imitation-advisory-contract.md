# Imitation recommendation and toy rule observations

## Defect and scope

The aggregate predictor previously averaged a categorical policy ID into continuous cloning coordinates, retained a batch axis for rule checks, and called `tolist()` on a Python integer. Native prediction therefore failed serialization. The old predicates also accepted nonfinite observations, substituted zero for absent action coordinates, and could report safe after changing an action while its observed state still violated a rule.

This contract evaluates configured toy threshold predicates. It does not certify physical safety or operate vehicles. All evidence uses synthetic observations and native CPU models.

## Recommendation identity

`action` and `bc_action` are flat continuous vectors. The bounded recommendation comes from behavioral cloning; `pg_action` is a scalar categorical diagnostic and `pg_probabilities` retains its independent distribution. There is no documented category-to-control mapping, so IDs are never added to continuous coordinates. Native outputs must be compatible, finite vectors and valid probabilities. Evaluation temporarily uses inference modes and restores every previous module mode, without changing existing gradients or weights.

The aggregate installs the four existing documented default rules. Prediction owns its full finite, exact-width observation and active rules before inference. Active rules are exposed through a defensive copy; use `add_rule` for changes. Only speed, lane, distance and brake types, matching threshold fields, and bounded descriptions are admitted.

## Rule verdict and adjustment

`evaluated: true` and `safe: true` mean all configured predicates pass. `safe: false` includes structured violations with observed values and thresholds. An empty rule set or disabled checking returns `evaluated: false, safe: null`; absence of evaluation is not evidence that predicates pass.

Required state/action coordinates must exist and be finite before evaluating any rule. Existing inclusive boundaries and thresholds remain: speed state[0] at most80, absolute lane state[1] at most0.5, distance state[2] at least50, and brake action[2] at most0.8. These values are library conventions, not calibrated physical units.

The existing advisory adjustment may change action coordinates. Both initial and final evaluations are returned; final evaluation uses the same owned observed state. A speed, lane or distance violation cannot disappear merely because a recommendation was adjusted. The brake rule remains observable when the existing heuristic does not correct it.

## HTTP compatibility and limits

`POST /imitation/predict` now returns a serializable flat recommendation and scalar category. Wrong dimensions, nonfinite/bool/string observations and malformed rule configuration are admission errors (422); unexpected native model failures remain generic500. `GET /imitation/safety/rules` returns actual configured rules. Training and checkpoint endpoints remain unchanged.

Policies bound vectors to4096 coordinates, collections to128 rules, descriptions to256 characters and nonnegative finite thresholds to1e9. These are admission limits, not safety calibration. CPU float32/64 is tested; CUDA is admitted but not exercised. There is no category/control mapping, physical validation, provider/hardware access, concurrent training/inference transaction, RNG recovery or checkpoint transaction guarantee.

## Evidence

The focused native suite exercises independent softmax/category and continuous references, inclusive rule predicates, persistent observed violations, caller/rule ownership, mixed mode and gradient preservation, internal failures, complete default model bootstrap and actual ASGI serialization/error handling. Existing imitation, cloning objective and REINFORCE logit suites remain included. Ninety tests pass locally, with the existing AnyIO deprecation warning.
