# NeRF pinhole camera geometry

`CameraPose` stores a consistent owned pose. Its rows are world-space right,
vertical and backward axes. They form a right-handed orthonormal basis.
Camera -Z points toward `look_at`; row camera vectors multiply the stored
basis directly. A conventional column camera-to-world rotation is `rotation.T`.

`fov` is horizontal degrees strictly between 0 and 180. For height H, width W,
focal length is W/(2 tan(fov/2)); pixel centers use
`((column+.5-W/2)/f, -(row+.5-H/2)/f, -1)`. Returned world directions are unit
vectors. Raster rows increase downward. Default up remains [0,-1,0]; callers
wanting world +Y upward must supply [0,1,0]. The reference NeRF implementation
uses camera -Z/downward raster Y; this helper explicitly uses pixel centers
rather than its historical integer-index offset:
https://github.com/bmild/nerf/blob/master/run_nerf_helpers.py

## Ownership and migration

Constructor vectors are complete finite real length-three inputs, copied on
admission. Coincident positions and parallel/zero up directions raise ValueError.
Scale-first norms avoid finite underflow/overflow. Subtraction is rescaled only
when it actually overflows, preserving tiny changes beside unchanged huge axes.
Public pose properties and ray/matrix results are independent copies. In-place
edits of returned properties no longer update the pose; construct a new pose to
move it. Attribute assignment is rejected. Corrected geometry and pixel sampling
change previously incorrect ray outputs. Path count must be a positive integer,
radius positive finite, center finite and spiral height finite. Negative height
is valid. Collapsed/unrepresentable generated poses reject the whole returned
path. Defaults/counts/output dictionary keys remain unchanged.

## Verification and limits

```
PYTHONPATH=backend/ml python -m pytest -q backend/ml/tests/test_nerf_camera_geometry.py
python -m ruff check backend/ml/nerf/camera.py backend/ml/tests/test_nerf_camera_geometry.py
```

The native NumPy suite checks independent image-plane projection, 80 seeded
world-space cross-product references, handedness, unit norms, rectangular/single
pixels, finite extremes, owned results, all path generators and invalid geometry.
Eleven selected geometry controls fail on unchanged main with ndarray inputs.
The baseline-only missing unused cv2 import was accommodated with an empty module;
no camera calculations were replaced. Fixed source removes unused cv2/Torch imports
and its focused CI needs neither package.

The existing route consumes these poses. This PR does not change model.py or
claim complete service rendering: the separate model skip/volume fix #17183 is
still open. No lens distortion, calibrated real camera, navigation control or
rendering quality guarantee is introduced. Large rasters/path counts allocate
proportional memory and have no new resource quota; callers must size them suitably.
