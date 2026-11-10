"""Bounded integer geometry/cost admission before native NAS weight allocation."""
from dataclasses import dataclass
from numbers import Integral


class NASPlanError(ValueError):
    """The complete declared NAS construction/execution plan is inadmissible."""


def bounded_integer(value, name, maximum):
    if isinstance(value, bool) or not isinstance(value, Integral) or not 1 <= value <= maximum:
        raise NASPlanError(f"{name} must be an integer in [1,{maximum}]")
    return int(value)


@dataclass(frozen=True)
class ConstructionPlan:
    shape: tuple
    stages: tuple
    parameters: int
    flops: int
    activation_values: int
    max_batch_size: int
    max_flops: int
    max_activation_values: int


def plan_construction(architecture, input_shape, *, max_parameters=50000000,
                      max_flops=100000000000, max_activation_values=16000000,
                      max_batch_size=1024):
    max_parameters = bounded_integer(max_parameters, "max_parameters", 100000000)
    max_flops = bounded_integer(max_flops, "max_flops", 1000000000000)
    max_activation_values = bounded_integer(max_activation_values, "max_activation_values", 64000000)
    max_batch_size = bounded_integer(max_batch_size, "max_batch_size", 4096)
    if not isinstance(input_shape, (list, tuple)) or len(input_shape) != 3:
        raise NASPlanError("input_shape must be (channels,height,width)")
    channels, height, width = (bounded_integer(value, "input_shape dimension", 8192) for value in input_shape)
    if channels > 4096:
        raise NASPlanError("input channels exceed 4096")
    if len(architecture["layers"]) > 128:
        raise NASPlanError("architecture exceeds 128 stages")
    shape = (channels, height, width)
    peak, parameters, flops = channels * height * width, 0, 0
    stages = []
    for operation, filters, activation in zip(architecture["layers"], architecture["filters"], architecture["activations"]):
        filters = bounded_integer(filters, "filters", 4096)
        stages.append((operation, filters, activation))
        if operation in ("conv3x3", "conv5x5", "conv7x7"):
            kernel = {"conv3x3":3, "conv5x5":5, "conv7x7":7}[operation]
            weights = filters * channels * kernel * kernel
            parameters += weights + filters  # Native Conv2d bias is registered.
            flops += 2 * height * width * weights
            channels = filters
        # Supported pooling/identity/ZeroPad2d(0) preserve C,H,W and have no
        # convolution/dense MACs. Existing zero operation semantics are preserved.
        peak = max(peak, channels * height * width)
    parameters += channels * 10 + 10
    flops += 2 * channels * 10
    if parameters > max_parameters or flops > max_flops or peak > max_activation_values:
        raise NASPlanError("complete NAS plan exceeds parameter, MAC-work or activation budget")
    return ConstructionPlan(shape, tuple(stages), parameters, flops, peak,
                            max_batch_size, max_flops, max_activation_values)
