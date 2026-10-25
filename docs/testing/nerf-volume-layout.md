# Native NeRF configured forward and volume integration

Skip configuration counts Linear layers; the registered Sequential interleaves Linears and ReLUs. Concatenation now happens immediately before the configured skip Linear, retaining every parameter/checkpoint key. Skip0 is the input layer and receives no duplicated input; indices beyond network depth leave no active skip.

Renderer uses scalar density/alpha/weight axes `[batch, rays, samples]`, RGB `[batch, rays, 3]`, and depth `[batch, rays]`. Physical sample intervals multiply ray direction lengths; viewing directions are normalized. Density is clamped nonnegative. Alpha uses stable expm1 and exclusive preceding-sample optical depth for transmittance. The existing opaque terminal interval1e10 convention remains; depth is the weighted ray parameter, not metric ray distance. At least float32 scalar accumulation handles float16/bfloat16 terminal intervals. Renderer retains its inference/no-grad network query.

Ray admission rejects nonmatching/empty3D layouts, nonfinite or incompatible dtype/device, zero/nonfinite direction lengths, invalid interval/sample counts and unrepresentable sampled points. Valid singleton samples and image reshaping work. No hierarchical sampling feature is included.

Run:

```sh
PYTHONPATH=backend/ml OMP_NUM_THREADS=1 python -m pytest -q backend/ml/tests/test_nerf_volume_layout.py backend/ml/tests/test_nerf.py
python -m ruff check backend/ml/nerf/model.py backend/ml/tests/test_nerf_volume_layout.py --select E9,F63,F7,F82
```

39local native tests pass; unchangedmain fails36/passes2 new tests. Independent configured native linear reference and real Adam verify skip0/1/2/4/9 in float32/64. An actual differentiable analytic field feeds the production renderer; a separate scalar front-to-back integration oracle validates arbitrary multi-batch/multi-ray shapes, singleton sampling, transparent/negative/opaque density and nonunit ray scaling. Native full NeRF trainer/save/load/image render and float16/bfloat16 terminal attenuation stay finite.

Prior3841/3856 added the missing layer call but left the configured-vs-interleaved index mismatch. Positional encoding pi-factor12664 remains. Original volume-rendering reference: https://arxiv.org/abs/2003.08934. No provider, production fit or reconstruction-quality claim; focused Linux native CI only.
