# Head pose and vision observation contract

The previous deterministic heuristic clamps yaw to ±30 and pitch to ±20, while
distraction requires an absolute angle greater than30. Thus its distraction
streak cannot advance. Original #4454 requested pose estimation; #4464 removed
randomness but retained an unreachable decision contract.

## Native geometry

Six declared approximate template points correspond to MediaPipe indices
1/152/33/263/61/291 (nose/chin/eye/mouth corners). OpenCV solvePnP estimates the
object-to-camera rotation/translation. Camera axes are right/down/forward.
Euler angles satisfy Rz(roll) Ry(yaw) Rx(pitch) in degrees; no decision-angle
clamping occurs. Gimbal-lock ambiguity yields UNKNOWN.

A known (width,height) frame is required. Default pinhole intrinsics use
focal=max(width,height) and centered principal point, with zero distortion.
These and the face template are approximations, not measured calibration.
Instances can provide head_pose_camera_matrix and head_pose_distortion with
actual calibration; reports label the camera source. Landmarks retain subpixel
precision and the actual frame shape is passed to distraction analysis.

Admission owns complete finite real landmarks, up to1024 rows and at least292,
with2D geometry spanning a nondegenerate image. Frame axes1–8192, supported
finite intrinsic/distortion shapes, positive template depth and reprojection
RMS at most2% of the larger frame axis are required. Landmarks outside one-frame
margin are unavailable rather than extrapolated. These are deterministic quality
admission policies; the2% limit is not a calibrated probability or accuracy score.

## Observation lifecycle

Existing angle/streak thresholds are preserved. Failed/missing pose resets the
distraction streak and returns UNKNOWN. No face or invalid frame resets both
streaks and produces a complete UNKNOWN report; its cache replaces previous
SAFE observations when writes are available. Unknown reports generate UNKNOWN
alerts. Cache failure does not manufacture a safe result. Per-driver ownership,
concurrent SDK/model access and cache partitioning remain outside this scope.

## Evidence and limits

70 focused tests use actual native OpenCV projections/solvers/color conversion,
SciPy distances and private Redis. Axis rotations,20 seeded calibrated poses,
distortion, ownership, complete admission, behind-camera geometry, gimbal lock,
reprojection and actual streak/frame/report paths are covered. Two selected
complete-observation controls fail against unchanged actual repository methods;
a separate native projection baseline confirms ±45/60-degree poses remain
FOCUSED with the old heuristic.

Actual selected VisionMonitor methods are executed from trusted repository
source. Constructor/MediaPipe/dlib/Keras startup is explicitly excluded. A
controlled landmark-provider boundary supplies independently projected points
for frame-method tests; pose mathematics is native and is not replaced. No real
camera, microphone or vehicle is used. Full application bootstrap, clinical
accuracy and real-driver calibration are not verified.

Reference: [OpenCV pose conventions and solvePnP](https://docs.opencv.org/doc/doxygen/html/d5/d1f/calib3d_solvePnP.html).
