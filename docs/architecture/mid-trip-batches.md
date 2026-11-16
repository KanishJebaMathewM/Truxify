# Bounded mid-trip candidate road batches

The road adapter admits at most100locations. A candidate problem needs current location, the full remaining route and its pickup/dropoff pair; other candidates' cross-edges are not used by exhaustive insertion. The consumer now streams bounded groups of those independent candidate problems rather than building one quadratic table for all eligible loads.

Batch size is floor((provider cap - baseline location count)/2). Every batch retains the complete unchanged baseline, and local pickup/dropoff offsets map back to the owned candidate records. No eligible candidate is truncated. Baselines that cannot fit even one candidate raise an explicit ValueError before any provider query. Increasing the provider cap or shortening routes is outside this change.

The evaluator captures its clock once after the first table observation, as before for a single batch. All subsequent candidates use that same evaluation clock and the existing exhaustive insertion, append-pickup deadline, units and tie policy. Stable global top-five reduction after each batch preserves earlier identities at tied scores. Candidate records are copied before provider work so later caller edits cannot replace their IDs/payments across batches; callers still must synchronize writes during capture.

Completed batch matrices are released by the consumer and producer before the next table query. Live road-matrix workspace is bounded by one provider-sized distance/duration pair plus its insertion workspace; owned input candidates still require O(L) records. Top-five reduction retains at most five prior recommendations plus the current bounded batch. Road calls remain sequential, and total calls grow with candidate count. Observations can reflect different provider times; this is not an atomic road-network snapshot or native cancellation facility. Each failed table keeps the existing whole-batch geometric fallback estimate, not proof of actual road reachability.

The pending #18671 repair separately certifies partial-road insertions; it is not embedded in this diff. Their actual source composition is tested locally. This batching change preserves the current provider null policy and existing insertion semantics; it does not independently fix that prior disconnected-dropoff defect. No provider/vehicle accuracy or hardware performance claim.

## Native verification

Actual Requests/local OSRM tests verify49/50/120eligible loads require table sizes[100], [100,4], [100,100,46], all with complete baseline and global ranking. A97-stop baseline fits exactly one candidate per100-location query;98stops reject before dispatch. Independent co-located score certificates, directed local indices, stable ties, owned identities, one clock, failed-batch geometric fallback and weak-reference matrix retirement supplement existing insertion/deadline controls.

15 actual unchanged-main finite directed consumer references match at1/5/49/50/120candidates across3seeds. Temporary composition with #18671 passes155native tests; that pending production scope remains separate.

```sh
PYTHONPATH=backend/ml OSRM_BASE_URL=http://127.0.0.1:1 python -m pytest \
 backend/ml/tests/test_mid_trip_batches.py \
 backend/ml/tests/test_mid_trip_insertion_complexity.py \
 backend/ml/tests/test_mid_trip_deadline_insertion.py \
 backend/ml/tests/test_mid_trip_payment_validation.py \
 backend/ml/tests/test_mid_trip_road_eta.py backend/ml/tests/test_mid_trip_model.py -q
```
