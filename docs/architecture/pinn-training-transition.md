# Native PINN training candidate publication

## Native failure

A real tiny PINN with Poisson objective and finite Adam weight decay 1e30 reports loss 1.0, while two actual second-moment tensors become infinite. Finite objective and clipped gradients alone do not validate the candidate Adam publishes. Same-dtype admitted observations/targets also retained caller storage aliases.

## Checked publication

One native reentrant lock serializes trainer train-step/train/predict/save/load operations. A step admits coherent registered float32/64 CPU/CUDA parameters, matching ordinary Adam parameter order/group/policies and finite compatible moments before execution. Before native forward it captures registered model, actual Adam, scheduler, prior parameter gradients and mixed modes. Native forward/PDE objective, backward, clipping and actual Adam step remain unchanged; every resulting model tensor and Adam moment must be finite and compatible. Ordinary failure restores captured state on the same registered parameter/optimizer identities. A valid candidate is retained with existing training-mode behavior.

Complete observation/target/collocation tensors and scalar/paired physics values are cloned in actual model dtype/device. Paired labels and Poisson forcing sampling, second-order PDE equations and collocation leaf semantics from prior repairs remain intact. Caller mutation during a native forward cannot replace admitted observations or forcing. Direct feature/coefficient graph links remain ordinary clone links; collocation leaves retain existing detach behavior.

A later failed batch recovers to the immediately previous accepted native state; earlier accepted batches remain. The scheduler advances only after a completed epoch. Captured scheduler state is restored on ordinary failed step callbacks, but whole-epoch/scheduler-operation recovery is not claimed.

## Mounted ownership and policies

Mounted native operations execute in FastAPI worker threads, with the same trainer lock held across complete route access. Request-specific toy physics selection is restored on exit. A running worker retains model ownership if its awaiting HTTP request is cancelled; admitted work may finish after cancellation, which does not roll back the model. This is one process/module's ownership, not a cross-process or direct external mutation fence.

Training request counts are strict positive bounded integers (epochs up to 1000, batches up to 4096, observation/collocation rows up to 10000). Complete tensors have bounded value admission. Estimated row/epoch work is at most 2000000 and point/parameter work at most 200000000; this is a library work policy, not a precise memory/time estimate. Native direct steps have the same point/parameter limit. Invalid request/policy admission returns 422 before synthetic allocation, unexpected/native numerical failures return generic 500. The default toy HTTP demonstration now uses one epoch with 32 observation and 32 collocation points, replacing the unbounded practical cost of the former 1000-epoch default.

## Evidence and limits

Actual finite-input Adam second-moment overflow is rejected/restored in float32/64 and AMSGrad. Native post-step callback failures preserve gradients, mixed modes, scheduler state and registered identities; the next ordinary step remains usable. Independent analytic native PDE derivative/ordinary Adam references match all four equation families. Caller-mutation, earlier accepted minibatch retention, default native ASGI/policy/error distinction and actual blocked-Torch overlap/cancellation evidence are included with prior PDE/row-forcing suites.

CPU Torch 2.8 is exercised; CUDA is admitted but untested. No equations, physical calibration, checkpoint publication format/atomicity, whole-epoch/RNG recovery, asynchronous process termination, arbitrary external hook/topology mutation, provider/hardware or production logistics quality claims.
