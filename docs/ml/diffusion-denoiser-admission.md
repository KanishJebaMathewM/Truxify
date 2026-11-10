# Native diffusion denoiser contract

`DiffusionRouteModel.forward/denoise` admit one complete owned tuple before the
registered lazy condition projection materializes or dropout consumes random
numbers. Dense CPU/CUDA float32/float64 latent observations must match the native
input projection dtype/device, have nonempty `[batch, sequence, features]` shape,
and contain finite values. Timesteps are int32/int64 indices on the same device,
exactly one per batch row, within the trained schedule. Floating timesteps and
implicit timestep broadcasting are rejected. CPU float32/64 are verified; CUDA
is admitted but untested.

Global, row, singleton-token and per-token conditions retain their existing
broadcast rules, including appended context. Conditions are copied into the
native model dtype; autograd links are preserved. Conditions supplied twice,
nonfinite values, unrepresentable conversions and changed materialized widths
are rejected before native execution. Registered optimizer parameter identities
and checkpoint keys are unchanged. The owned tuple resists caller mutation after
admission; this does not provide a transaction against simultaneous mutation
while copying or against direct external model changes.

Construction checks positive integral dimensions, hidden width 2..4096,
0..32 residual/attention pairs, 1..64 heads (dividing active hidden width), and
1..10000 schedule steps before random parameter allocation. The native parameter
plan is capped at 32 million, including conditional projection materialization.
Forward admission caps batch at 64, sequence at 4096, input/condition/hidden
values at 8 million, summed attention pair scores at 32 million and estimated
linear projection multiply-add work at 256 million. These conservative work
limits may reject large previously accepted batches, including large default
model training batches; callers must reduce batch/sequence length. They are
admission budgets, not peak-memory or latency guarantees.

The Fourier kernel emits exactly its declared width. Widths 2/3 use frequency
one, avoiding division by zero; odd widths have a trailing zero coordinate.
Normal even-width float32 frequencies remain bitwise compatible with the old
kernel. Float64 modules now compute float64 frequencies/phases instead of
silently quantizing times to float32. An empty nonpersistent dtype anchor adds
no checkpoint keys. Standalone embeddings accept bounded finite real vectors,
including continuous times and their native derivatives; the full denoiser
requires trained integer indices.

Final native predictions must be finite before they are returned. A native
failure raises an error; there is no optimizer, RNG, lazy-materialization or
whole-epoch rollback for otherwise admitted executions. The reverse DDPM/DDIM
schedule, start/end boundary handling, condition projection semantics and
training noise targets remain unchanged. This repair does not implement the
separately assigned conditional route geometry issue #13876. There is no claim
of physical route quality, sensor/vehicle use or production deployment.

The focused native suite compares Fourier values and first derivatives with
independent analytic formulas, verifies legacy float32 values, exercises actual
small/odd-width conditional AdamW learning, rejects complete invalid tuples
without lazy initialization/RNG changes, checks constructor rejection before
allocation, mutates caller inputs during real native projection, verifies strict
checkpoint keys and finite publication, and runs existing condition ownership,
paired training, reverse schedule and generator tests.
