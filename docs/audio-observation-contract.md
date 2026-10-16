# Audio observation contract

The analysis service accepts owned normalized finite PCM arrays: one or two
channels, integer sample rates from 8 kHz to 192 kHz, and at most ten seconds.
Decoded upload rates are forwarded; stereo is averaged and real Librosa resampling
produces the 16 kHz model input. Float audio outside [-1, 1] is rejected rather
than silently clipped. Resampling/noise-reduction intermediates can legitimately
overshoot PCM amplitude; their revalidation checks finiteness without clipping.
This service bound applies after decoding, not before it.

Each mel, MFCC and chroma family occupies exactly 1000 elements, zero-padding
short families independently. The real models receive 3000 finite features.
Classifier admission requires the complete finite normalized softmax shape.
Honk confidence is class zero (honk), not confidence of an unrelated winning class.
Native bool/float decisions serialize with strict JSON and cache for 60 seconds.

Every detector marks observation success or failure. Partial/invalid analysis is
UNKNOWN, never SAFE; invalid input replaces a stale SAFE cache when Redis is
available. Failed cache writes return a complete UNKNOWN report and reset streaks.
The upload success flag reflects the actual report. Failed modality decisions
are not calibrated negative observations.

## Verification and limitations

36 native tests use synthetic PCM, real Librosa/noise reduction, actual TensorFlow
models with controlled real weights, SoundFile WAV decoding, and private Redis.
The actual upload function and upload helpers are executed from repository source;
unrelated legacy vision/model startup and full application bootstrap are excluded.
Tests never record microphone audio or access a vehicle. The workflow runs the
suite on Linux with real dependencies, plus full analysis of new files and scoped
legacy analysis excluding pre-existing findings.

The earlier #4090 declaration change did not guarantee 3000 extracted features.
Baseline valid 2-second PCM produces 2575, breaks the emotion model, and its
numpy bool fails report JSON. A high-confidence normal class is falsely honk;
a NaN waveform causes failed analyses to report SAFE.

Models are existing untrained placeholders; this change makes their contracts
coherent, not their predictions clinically accurate. No calibration, retraining,
hardware recording policy, concurrent counter ownership, per-driver cache
partitioning, decoded-media memory hardening, or full vision router startup is
claimed. The original microphone recording path is not exercised by this suite.
