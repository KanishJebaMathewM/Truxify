# Reverse diffusion time-grid correctness

`num_steps=None` or the full training count retains the existing adjacent stochastic DDPM mean/beta-noise update. Reduced positive counts select distinct descending rounded linspace indices spanning the trained last/high-noise timestep and0; one-step starts at the high-noise index and transitions directly to clean data.

Reduced sampling uses deterministic DDIM (eta0): predict x0=(x_t-sqrt(1-A_t)*eps)/sqrt(A_t), then x_s=sqrt(A_s)*x0+sqrt(1-A_s)*eps, where A is the existing cumulative alpha schedule and the terminal virtual clean index has A=1. No extra diffusion noise is drawn on those reduced transitions. Endpoint inpainting still draws its existing forward noise and pins the final start/end values. [DDIM original paper, Eq12 and accelerated sub-sequences](https://arxiv.org/abs/2010.02502).

Step count and positive batch/sequence/input dimensions, paired finite endpoints and finite valid cumulative alphas are admitted before initial sampling. Sampling owns eval modes, restores every prior child mode in finally, and rejects nonfinite/shape-incompatible noise or generated coordinates instead of returning a partial result. Output is detached and initialized in model dtype.

Native tests replay an actual denoiser with independent scalar DDIM math and fixed initial RNG, trace actual time embeddings, preserve the full adjacent law/RNG, verify heterogeneous dropout mode ownership/restoration on real nonfinite failures, and exercise native endpoint generation. No mocked denoiser or quality claim.

`PYTHONPATH=backend/ml OMP_NUM_THREADS=1 python -m pytest -q backend/ml/tests/test_diffusion_reverse_schedule.py backend/ml/tests/test_diffusion.py backend/ml/tests/test_diffusion_trainer.py`

This corrects reduced-step schedule semantics, not model training/conditional parameter ownership. Prior17191 owns condition parameters;15167 introduced endpoints. Full adjacent variance remains legacy beta. No sampling-quality benchmark, production provider or retraining claim.
