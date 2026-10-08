# Explicit NeRF ray RGB learning

The pointwise NeRFTrainer API fits color at individual coordinates. Density is
not part of that objective; its returned training metadata now says
`objective: pointwise_rgb`, `density_gradient_path: false`, including the existing
synthetic pointwise mounted endpoint. Its data fields and numerical fitting
semantics are preserved. Point positions are never reinterpreted as origins.

`NeRFTrainer.train_rays` instead owns explicit `[rays, 3]` origins, directions
and target RGB. It queries the existing field along each ray and fits the
actual volume-rendered pixel RGB. The objective couples density and color,
with metadata `rendered_ray_rgb`, `density_gradient_path: true`. This describes
objective connectivity, not a guarantee that each derivative is nonzero:
nonpositive clamped density, opaque tails and uninformative observations can
have zero density gradients. The native Adam optimizer/learning rate already
registered with the trainer is used; no new optimizer or density heuristic.

`NeRFRenderer.render_rays(..., differentiable=True)` admits the actual native
render graph. Default inference remains detached for all returned tensors,
and an outer no-grad context is honored even with the opt-in flag. The flag
must be boolean. The established skip topology, nonnegative-density clamp,
ray-length deltas, exclusive optical transmittance, uniform t samples and
1e10 tail convention are unchanged. Ray fitting requires enabled autograd;
it does not silently override the caller. The old inference rendering and
camera pose APIs remain compatible.

Complete ray data is checked/copied before any update: same finite native
floating `[rays, 3]` geometry/dtype, representable nonzero direction norms,
RGB in [0,1], compatible finite interval/endpoints/positional encoding range,
and bounded integer/work policy. Geometry ownership precedes native hooks or
shuffling. Float32/64 CPU/CUDA field state is admitted; CPU tested, CUDA
untested. Ray fitting accepts at most 10,000 rays, 100 epochs, 4096 batch rows,
2..256 samples per ray, 262,144 samples per query and 128,000,000 sample-epoch
work. These are library policies, not calibrated latency or complete field
activation/FLOP/memory bounds. Native loss and derivatives must be finite
before Adam; numerical model/optimizer failures remain ordinary errors.
Earlier accepted batches are not rolled back, nor is this a checkpoint,
optimizer-candidate, RNG, concurrent-reader or process transaction.

`POST /nerf/train/rays` takes the explicit arrays plus the same sampling/loop
options. Counts and work are checked before native tensor construction;
Pydantic bounds row counts and each 3-vector. Native admission rejects 422;
internal fitting failure returns generic 500. No camera/sensor/provider feed is
opened or invented. This is supplied observation fitting, not synthetic
scene evidence. Body parsing/network byte budgets are external service limits.

## Independent native evidence

A native two-sample field with sigma 0.4, t=[0.1,1], unit +Z direction and
color sigmoid(t) renders 0.6687559. The independent analytic derivative of RGB
with respect to constant density is approximately -0.1294. Native density and
color parameter gradients match closed-form volume/MSE derivatives; the
constant-density derivative also matches an independent finite difference.
Actual one-step Adam/model/moments match an independently evaluated two-sample
volume objective. Multiple actual updates change density and reduce pixel
error on this controlled field. This does not establish scene reconstruction
quality on real data.

122 native tests PASS: new ray objective, existing volume layout and camera
geometry plus positional encoding. Actual default NeRF/Adam and mounted ASGI
run (no substituted model/bootstrap); complete dataset/Fourier-range rejection,
caller ownership, legacy pointwise density exclusion, inference defaults and
internal-error handling pass. Existing AnyIO deprecation remains. Full new
helper/tests Ruff and changed legacy E9,F63,F7,F82,I,F401 analysis pass.

Scientific scope follows [the original NeRF paper](https://arxiv.org/abs/2003.08934):
image observations supervise the field through differentiable volume rendering.
This implementation keeps the repository's current discretization; it adds no
hierarchical/stratified sampler, photometric calibration, new camera model,
white background, real-world observation accuracy or trained-quality promise.
