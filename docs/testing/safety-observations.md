# Safety observation protocol

Issue #17696 repairs the regressed #10755/#11177 missing-observation behavior
at the fusion core and both HTTP entry points. It does not certify driver safety,
calibrate the existing model scores, implement a hardware producer or partition
feeds by driver. The existing global cache namespace remains global.

## Admission and coverage

`SensorFusion.fuse_data` admits explicit dictionaries. `analyze` and
`GET /safety/fusion/report` read omitted modalities from one Redis `MGET` snapshot:
`vision:latest`, `audio:latest`, `sensor:latest`. `None` selects cache; an explicit
empty dictionary stays empty, including `POST /safety/fusion/analyze` bodies.
No sensor values are generated. Without an actual producer, sensor coverage
remains unavailable.

Recognized vision statuses are AWAKE/SLEEPY/DROWSY and FOCUSED/DISTRACTED.
Audio admits strict boolean emergency/honk flags, nonnegative integer honk counts
and known emotions; unknown emotion alone supplies no evidence. Sensor values
must be finite JSON numbers (booleans and strings are rejected), speed must be
nonnegative, and seatbelt must be a boolean. ERROR/UNKNOWN/NO_FACE_DETECTED frames,
metadata only and invalid recognized values supply no coverage. Accepted reports
own copies of recognized fields; unrelated payload metadata is not echoed.

Cached frames must be JSON objects of at most 64 KiB and carry an ISO timestamp.
They must be at most 60 seconds old and no more than 5 seconds in the future.
Legacy naive timestamps are interpreted in the process's local timezone, matching
existing `datetime.now().isoformat()` producers; timezone-aware timestamps and Z
are supported. Explicit observations are contemporaneous when no timestamp is
supplied; a supplied timestamp must pass the same freshness check.

The original 0.5/0.3/0.2 weights and risk thresholds remain unchanged. Missing
feeds are not renormalized into stronger evidence. `data_available` means at
least one modality supplied observations; `coverage_complete` means all three
did. Incomplete modality coverage is always UNKNOWN, retaining measured risk
and per-feed source/reason/field metadata. SAFE means no elevated score under
this existing heuristic on admitted observations, not a clinical or fleet-wide
guarantee. UNKNOWN actions request observation/connectivity checks.

Redis read failures produce unavailable cached feeds. Redis publication failures
return a complete UNKNOWN report with `persistence_available: false`; internal
exceptions are not exposed. Successful publication stores the same strict-JSON
report for 60 seconds. The report HTTP response retains availability, coverage
and persistence metadata; existing fields remain.

## Verification

Install a local `redis-server` and the scoped dependencies from
`.github/workflows/safety-observations.yml`. Run from the repository root:

```sh
PYTHONPATH=backend/ml python -m pytest backend/ml/tests/test_safety_observations.py -q
python -m ruff check backend/ml/multimodal/sensor_fusion.py backend/ml/routes/safety_fusion_routes.py backend/ml/tests/test_safety_observations.py
python -m ruff check backend/ml/routes/safety_routes.py --ignore B008,BLE001,DTZ005,RUF059
```

Set `REDIS_SERVER` to an alternative Redis executable if needed. The suite starts
its own Unix-socket Redis with TCP and persistence disabled, flushes only that
private instance, and terminates it afterward. Native ACLs reproduce publication
failure; a nonexistent private socket reproduces read failure. HTTP tests mount
the actual fusion router and use this native client. No neural model, risk math,
camera, microphone, provider or vehicle control is mocked or exercised.

The parent safety module retains unrelated existing B008/BLE001/DTZ005/RUF059
lint findings in upload/status/alert functions. The scoped gate does not claim
full service boot, model calibration or repository-wide CI health.
