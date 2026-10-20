# PINN training row ownership

Observation tensors are admitted as nonempty finite model-dtype coordinate rows with one scalar target per row. Vector labels[N] become columns[N,1]; other targets are rejected. Collocation tensors are validated completely before the first optimizer update. Evolution physics uses two space/time coordinates; Poisson retains all spatial axes. Finite scalar coefficients and scalar or full row-wise forcing are admitted up front.

Each training batch samples its collocation points and row-wise forcing with the same indices. Constant forcing is unchanged. Observation targets use the same shuffled indices as observation coordinates, including singleton tails. Collocation gradient leaves remain private, preserving caller tensors/autograd graphs. Finite objective and gradient gates prevent Adam advancement on numerical failure.

Epoch objective/data/physics metrics are weighted by observation rows; physics remains a separately sampled mean within each batch. This corrects over-weighted small final batches without changing PDE equations, physical coefficients, model topology or optimizer choices. Positive integer loop controls are required.

Native evidence uses vector/column loss equivalence, explicit independently constructed Adam loops (nonconstant forcing, batch sizes1/2/3/5/9), invalid full-dataset preservation of existing parameters/moments/gradients/modes/RNG/scheduler, real float64 checkpoint continuation and existing manufactured PDE/ASGI tests.

`PYTHONPATH=backend/ml OMP_NUM_THREADS=1 python -m pytest -q backend/ml/tests/test_pinn_training_identity.py backend/ml/tests/test_pinn_coordinate_derivatives.py backend/ml/tests/test_pinns.py`

Global service/Flutter gates and separate NumPy axle physics are outside this focused gate. Original17119 derivative repair remains distinct. No provider calls, production training or prediction-accuracy claim.
