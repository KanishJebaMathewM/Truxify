# Diffusion condition parameter ownership

An explicit `cond_dim` creates a registered Linear; unspecified width creates a registered PyTorch LazyLinear. Optimizers constructed before the first conditional call already own both parameter objects, and native materialization retains those identities. The first valid condition fixes the width; later mismatches raise ValueError instead of replacing learned weights. Inference never silently switches schemas.

Conditions may be global[C], per-row[B,C], or per-token[B,L,C], with singleton batch/sequence broadcast. Appended input conditions are retained. Explicit plus appended context is rejected as duplicate. Complete context dimensions/finite real values are admitted before dropout or initialization RNG is consumed; context follows model dtype. Unconditional batches leave lazy parameters unmaterialized and unused. Time embeddings match the time MLP dtype.

Native tests cover Adam ownership/actual projection updates, independent expanded-conditioning outputs, immutable failed schemas/RNG, float64 forward/backward, tensor-only materialized checkpoint reload and identical next Adam update, and the actual DiffusionTrainer joint context/unconditional consumer. The existing19 diffusion/model trainer tests pass.

`PYTHONPATH=backend/ml OMP_NUM_THREADS=1 python -m pytest -q backend/ml/tests/test_diffusion_condition_ownership.py backend/ml/tests/test_diffusion.py backend/ml/tests/test_diffusion_trainer.py`

Use a representative valid conditional forward to materialize lazy weights before tensor-only checkpoint export or parameter shape/count inspection. Already-materialized condition tensor keys remain cond_proj.weight/bias; old optimizer checkpoints constructed without conditional parameters require optimizer migration/recreation. An old entirely unconditional model checkpoint with no cond_proj keys needs explicit migration rather than strict-load compatibility. No claim that those old optimizer states are compatible.

[PyTorch LazyLinear contract](https://docs.pytorch.org/docs/stable/generated/torch.nn.LazyLinear.html). No endpoint generator/noise schedule, trainer row ownership, production provider or model fitting changes. Previously13891/15167 introduced projection/geometry;17117 repaired trainer pairing. This is the distinct registration/materialization/optimizer ownership protocol.
