# NAS construction and execution plan

NASModel now validates a complete owned genotype/input geometry before native weight
allocation. Rectangular `(channels,height,width)` is admitted, with positive integer
dimensions up to8192 and channels up to4096. Stages are bounded to128 and filters to4096.
The existing operation/activation admission and search genotype ownership remain intact.

A static integer plan propagates the existing operations' dimensions, counts native
registered parameters (including biases), and estimates convolution/dense multiply-add
work at each spatial output. `get_flops()` returns **per-sample convolution/dense MAC
FLOPs**, using two operations per multiply-add. This fixes spatial undercounting: a
one-input-channel/three-filter3x3 convolution at5x7 plus the10-output classifier costs1950;
at50x70 it costs189060. The old estimator returned114 for both.

This convention matches the relevant native Torch profiler convolution/matrix estimates:
https://docs.pytorch.org/docs/stable/profiler . It excludes bias addition, activations,
pooling, memory movement, workspaces and hardware-specific kernels. It is not elapsed
latency, total instruction count, trained accuracy or every floating operation. Existing
`zero` remains the current ZeroPad2d(0) behavior; this PR does not redefine its search semantics.

Complete default construction limits are50000000 registered parameters,100000000000
convolution/dense FLOPs and16000000 peak feature values. Constructor keyword limits can
be lowered; admitted ceilings are100000000 parameters,1000000000000 MAC FLOPs and64000000
peak values. `max_batch_size` defaults1024, maximum4096. The limits are library resource
policies, not a hardware-specific memory/time guarantee. Peak feature values do not
count all simultaneously retained autograd activations or native workspaces.

Forward requires dense finite floating NCHW tensors matching declared C,H,W and active
parameter dtype/device. Batch size must be positive and within count limits; batch times
per-sample MAC work and peak feature values must fit the same configured limits. Input
already allocated by callers is not retroactively bounded. Nonfinite native outputs reject;
this does not certify weights or rollback RNG/external side effects.

`architecture` returns an owned copy and `input_shape` is the plan's immutable tuple.
Public rebuild constructs a private module list then replaces the registered network
rather than appending another network. Valid initial state_dict keys remain unchanged.
Rebuilding intentionally reinitializes weights: previously attached optimizers should
not be reused. Rebuild is not a checkpoint restore or globally coordinated hot reload;
external mutation of registered modules/private plan data is unsupported.

The mounted `/nas/build-model` returns422 for invalid construction and reports cost from
its default1x28x28 model. It keeps existing response keys and does not expose client
budget overrides. Existing search ranking/controller policy and evaluator scores are
unchanged. Default random search still uses its existing placeholder score, so no search
quality improvement is claimed.

Verification runs native CPU Torch2.8.0 profiler comparisons for all seven operations and
four activations,20 seeded mixed genotypes, rectangular/batch costs, RNG immutability on
preallocation rejection, rebuild/checkpoint compatibility, metadata ownership and actual
router requests. The focused version is2.8.0, not the repository's separate broad declared
2.13.0 dependency stack. Router fixture bypasses unrelated eager full ML startup. The
preexisting AnyIO TestClient deprecation and separate heuristic Pareto test are not fixed.
