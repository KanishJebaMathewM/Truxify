# Native trust candidate admission

Trust generations consist of a fitted `RandomForestClassifier` and fitted
`StandardScaler` with five behavioral features in `FEATURE_NAMES` order. Candidate
admission runs outside the short serving-state lock, before training persistence
and loaded publication. The previous captured serving pair remains available
while validation runs or rejects a candidate. Successful cold loading retains the
existing lifecycle coalescing protocol.

Admission checks fitted feature counts and optional named-column order, one
supported risk output, a nonempty unique subset of numeric labels0/1/2, finite
five-feature scaler state with positive scales and nonnegative variance, and
finite nonnegative native tree values with positive class mass at every node.
Native tree feature/output layout and finite thresholds are required. Three
representative finite profiles must transform and produce finite normalized native
probabilities. Constant feature variance and supported single-class forests remain
valid; mean/variance/scale arrays are required. This is the normalization contract
produced by this module's ordinary training; arbitrary callable-only artifacts are
no longer accepted as trust generations.

Serving uses one captured pair and the forest's native probability/argmax rule,
matching ordinary valid RandomForest classification. Unsupported classes, invalid
probability shape/range/normalization and nonfinite transformed features fail
explicitly instead of manufacturing a valid Medium/Low label. Named-column pairs
use the canonical feature names during native transformation/classification.
The deterministic score, valid response keys, synthetic training policy, class
names, artifact authentication/storage and API authorization remain unchanged.

Finite state and representative probes establish an operational admission
contract; they do not establish real-world risk quality, fairness, class coverage
or model/scaler provenance from the same original dataset. This is per-instance
lifecycle publication, not cross-process coordination. Artifact decoding remains
the existing authenticated storage mechanism; this validation is not a sandbox
for arbitrary objects or a replacement for artifact integrity. Internal callers
must not mutate a published native pair concurrently. The candidate checks inspect
all native tree values; this adds work proportional to the forest size at lifecycle
boundaries rather than every request. Per-request probability checks retain native
forest inference cost.

## Verification

The pinned focused Linux matrix covers sklearn1.5.2 and declared1.9.0. Native tests
save/load through authenticated private local artifact directories, reject unfit,
wrong-width/order, unknown-class, nonfinite/negative/zero native states, preserve
warm output on every rejection and verify cold coalescing/warm availability and
captured pairs through a mid-transform load. Actual invalid training cannot persist
or publish. Named-feature and constant/single-class native generations remain
accepted. Corrupted native probabilities cannot report Low.

Existing tag-based lifecycle tests keep their estimator doubles at explicit native
admission/classification seams; their concurrency, failure retention and pair
identity assertions are retained. The existing real classifier/scaler lifecycle
integration uses the actual native admission and classification, and all existing
formula controls remain. No tests are deselected. These tests use synthetic data
and temporary artifact directories; no production models or providers are used.
