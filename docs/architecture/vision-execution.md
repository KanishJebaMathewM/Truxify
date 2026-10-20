# Native vision execution ownership

The vision analysis endpoint admits its existing MIME-checked, bounded upload and
submits one immutable encoded-frame job through `app.execution.run_inference`.
The entire OpenCV decode, monitor processing and cache continuation runs in that
job. No per-request pool or detached background task is created. Vision status
cache reads and JSON parsing also use bounded native execution; HTTP503/504
admission outcomes remain visible rather than becoming an internal500.

One lazily initialized reentrant owner belongs to each VisionMonitor. It covers
encoded decode and the full graph/counter/report operation for direct and worker
callers. Direct valid frames are copied into private complete storage; a caller
changing its array shape after admission cannot change the monitor's retained
view. Locally decoded frames already have private storage and enter the same
processing body under the owner without a second BGR allocation. Invalid frames retain the existing UNKNOWN/error/reset path. Counter
thresholds, native processing, upload limits, valid response fields, missing versus
present JSON cache results (including null) and cache-failure behavior remain.

An admitted native job retains executor capacity until it exits, including after
an HTTP waiter cancels/times out. Waiting for the same monitor owner can occupy
bounded executor slots; no fair scheduling, fast cancellation of native work or
cross-process coordination is claimed. Status reads share executor admission and
may receive backpressure while frame jobs occupy capacity. Direct-caller private copies add work
and one frame-sized allocation; this does not redesign codec allocation limits.
Copying does not provide an atomic snapshot during unsynchronized external writes.
This is per-monitor ordering; existing shared driver/stream identity, detector
quality, fusion policy, audio/hardware capture and production rollout are outside
this repair. Synthetic NO_FACE tests do not certify physical monitoring quality.

## Native verification

The focused suite uses actual OpenCV decoding, MediaPipe FaceMesh, Keras
construction, private Unix Redis, native thread interleavings and mounted selected
endpoint/helper bodies. Unrelated audio initialization and the unused optional
dlib startup detector/predictor are isolated; graph/decoder/report/Redis execution
is not replaced. The dlib macOS dependency fails its old SDK PNG compilation and
is not used by process_frame. Full application/hardware startup is not claimed.
Native tests retain existing synthetic OpenCV pose/fusion/executor controls and
check frame ownership, actual graph wait and Redis pause responsiveness, explicit
backpressure outcomes, cancellation capacity retention, upload admission, invalid
frames, direct private-copy failure and absence of a redundant decoded BGR copy. No test deselections. Existing Keras/protobuf/
Starlette deprecations and MediaPipe informational warnings remain explicit.

On macOS, the graphics context required native test execution outside the file
sandbox. Linux uses a software graphics context under Xvfb. No camera, microphone,
real sensor/provider feed or vehicle control is used. The baseline's controlled
300ms delay after real graph processing is a blocking-operation witness rather
than normal algorithm latency or a throughput benchmark; native Redis CLIENT
PAUSE ALL is an independent real cache-I/O witness.
