# Native fitting candidate admission

The trainer admits complete owned train/label and optional paired heldout tensors
before private fitting. Native family inputs match feature/position capacity and
labels match the actual forecast horizon. Generic native modules retain real
floating/integer input compatibility; exact native output/target geometry is
checked before MSE. Targets match model float32/64 dtype. No target broadcasting.

The complete invocation admits at most10,000 rows per collection,2,000,000 combined
scalar elements and100,000,000 element-epochs; epochs1..500 and native batch size
1..10,000. Existing HTTP request ranges1..500 epochs/1..1024 batch remain. Bounds
are collection/work admission, not calibrated latency/complete model memory.
Owned copies cost memory in addition to the existing private model/optimizer and
retained in-flight serving generations. Attention complexity still depends on
admitted native model and sequence geometry.

Native AdamW policy/registered state is checked before clone/shuffle. Every native
step requires exact finite predictions, scalar finite objective, finite clipping
norm and resulting registered model/buffer/moment state. Completed histories must
be finite. Finite weights alone are insufficient: the final private model also
runs a bounded eval/no-grad pass over owned train/heldout observations, checking
actual forecasts/objectives. This adds an observation pass; readiness is established
only for those admitted observations, not all future data or empirical quality.
Existing loss history meanings/formulas are retained rather than replacing them
with the final readiness probe's loss.

A failed private fit is discarded and the exact prior serving model/optimizer
remain. Corrected retry works. Existing native mutation ownership, in-flight old
readers, captured checkpoint saves and cancellation-before-publication stay intact.
The cancellation check follows the complete readiness probe immediately before
publication. This adds no optimizer rollback context or checkpoint schema change.

The three existing training routes classify observation admission as422 and retain
generic500 for internal numerical failures. Actual request data and heldout pairs
remain required; no synthetic provider/bootstrap data is invented. Rectangular
conversion errors are client admission errors. Forecast endpoints, horizon response
metadata, checkpoint semantic validation, model architecture and serving lifecycle
are not redesigned.

CPU float32/64, genuine MSE/autograd/clipping/AdamW and generic native embedding
inputs are verified. CUDA is admitted untested. Arbitrary hooks/custom criteria or
optimizers, external model/input mutations during snapshot acquisition, RNG rollback,
cross-process ownership, fatal-device recovery, providers, physical controls and
real-data forecast calibration are outside this contract. Private rejected work
may consume RNG/work, but never publishes its candidate.
