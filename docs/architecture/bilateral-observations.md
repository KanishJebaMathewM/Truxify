# Bilateral matching observations

`match_bilateral` captures private list membership and dictionary records before validation or native routing dispatch. Validation retains the admitted floats for every coordinate, capacity, dimension, deadline, preference and rating. Routing tiles, cost calculations and Hungarian result indices use that same private problem throughout the call. Caller dictionaries are not normalized in place.

The boundary continues to accept the existing float-coercible numeric values, including numeric strings. Their validated floats now reach scoring rather than the original values. Rating defaults to 3; either absent preferred coordinate still disables the destination preference penalty. Finite/range/positive validation and the accepted-edge Hungarian objective are unchanged.

This prevents later caller edits, list replacement, deletion, reordering or appended records from replacing an admitted feasibility decision or changing the routing matrix shape. Indices refer to the captured input order; callers that edit their lists must retain their own original index mapping. Capture is not an atomic snapshot across unsynchronized concurrent writes during capture. Synchronize writers when a consistent caller generation is required.

Copies are shallow: all matching fields are normalized to immutable floats before dispatch, and unrelated opaque metadata is never used by routing or costs. The private copies cost O(loads + drivers) records in addition to the existing cost matrix. Native provider admission, timeout ownership, tile assembly and unknown/unreachable semantics remain unchanged. Direct private routing-helper callers are outside the public matching admission boundary. No provider accuracy or vehicle safety certification is claimed.

## Native verification

`test_bilateral_observations.py` uses actual Requests and a loopback HTTP server whose native handler edits caller records while routing waits. It verifies all consumed fields, overweight admission, multi-tile cardinality/index ownership, coercion and caller preservation. Existing routing-lifetime tests exercise provider timeout and admission; existing solver, validation and algorithm controls remain in the focused gate.

```sh
PYTHONPATH=backend/ml TRUXIFY_ML_USE_OSRM=false python -m pytest \
  backend/ml/tests/test_bilateral_observations.py \
  backend/ml/tests/test_bilateral_routing_lifetime.py \
  backend/ml/tests/test_bilateral_input_validation.py \
  backend/ml/tests/test_bilateral_unmatched.py \
  backend/ml/tests/test_bilateral_assignment_objective.py \
  backend/ml/tests/test_bilateral_matcher_algo.py -q
```
