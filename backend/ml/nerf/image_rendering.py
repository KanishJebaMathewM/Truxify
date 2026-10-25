"""Bounded native single-image queries and complete scene work admission."""

import copy
import math

import torch

MAX_QUERY_SAMPLES = 16_384
MAX_RETAINED_SAMPLES = 8_388_608
MAX_IMAGE_PIXELS = 1_048_576
MAX_SCENE_SAMPLE_WORK = 128_000_000
MAX_POSES = 120
MAX_AXIS = 1024


class ImageAdmissionError(ValueError):
    """Image or scene policy cannot enter native rendering."""


def count(value, name, maximum):
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= maximum:
        raise ImageAdmissionError(f'{name} must be an integer in [1, {maximum}]')
    return value


def raster(image_size):
    if not isinstance(image_size, (tuple, list)) or len(image_size) != 2:
        raise ImageAdmissionError('image_size requires height and width')
    h, w = (count(value, 'image axis', MAX_AXIS) for value in image_size)
    if h * w > MAX_IMAGE_PIXELS:
        raise ImageAdmissionError('image exceeds the pixel budget')
    return h, w


def scene_policy(num_poses, image_size, num_samples):
    poses = count(num_poses, 'num_poses', MAX_POSES)
    h, w = raster(image_size)
    samples = count(num_samples, 'num_samples', 256)
    if poses * h * w * samples > MAX_SCENE_SAMPLE_WORK:
        raise ImageAdmissionError('scene exceeds the sample-work budget')
    return h, w


def render_image(renderer, camera_rays, image_size, *, include_samples=True):
    h, w = scene_policy(1, image_size, renderer.num_samples)
    if not isinstance(include_samples, bool):
        raise ImageAdmissionError('include_samples must be boolean')
    if include_samples and h * w * renderer.num_samples > MAX_RETAINED_SAMPLES:
        raise ImageAdmissionError('image exceeds retained sample-output budget')
    # Capture rendering configuration; model mutation still needs its native owner.
    native = copy.copy(renderer)
    native.model = renderer.model
    native.num_samples = count(renderer.num_samples, 'num_samples', 256)
    if (not math.isfinite(native.near) or not math.isfinite(native.far)
            or not 0 <= native.near < native.far):
        raise ImageAdmissionError('ray interval requires finite 0 <= near < far')
    if not isinstance(camera_rays, dict) or not {'origins', 'directions'} <= camera_rays.keys():
        raise ImageAdmissionError('camera rays require origins and directions')
    parameter = next(native.model.parameters())
    values = [camera_rays[name] for name in ('origins', 'directions')]
    if any(not isinstance(v, torch.Tensor) or v.layout != torch.strided
           or v.dtype != parameter.dtype or v.device != parameter.device
           or v.shape not in ((h * w, 3), (1, h * w, 3)) for v in values):
        raise ImageAdmissionError('camera rays require compatible flat or batched single-image geometry')
    origins, directions = [v.detach().reshape(1, h * w, 3).clone() for v in values]
    if not torch.isfinite(origins).all() or not torch.isfinite(directions).all():
        raise ImageAdmissionError('complete image rays must be finite')
    lengths = torch.linalg.vector_norm(directions, dim=-1)
    if not torch.isfinite(lengths).all() or not (lengths > 0).all():
        raise ImageAdmissionError('complete image directions require finite nonzero lengths')
    scalar_dtype = torch.float32 if parameter.dtype in (torch.float16, torch.bfloat16) else parameter.dtype
    endpoints = torch.tensor([native.near, native.far], device=parameter.device, dtype=scalar_dtype)
    sampled = origins[:, :, None, :] + directions[:, :, None, :] * endpoints[None, None, :, None]
    if not torch.isfinite(sampled).all():
        raise ImageAdmissionError('complete image ray endpoints must be representable')
    frequencies = getattr(getattr(native.model, 'pos_encoder', None), 'num_frequencies', 0)
    if frequencies:
        maximum = torch.finfo(parameter.dtype).max / ((2 ** (frequencies - 1)) * math.pi)
        if not (sampled.abs() <= maximum).all():
            raise ImageAdmissionError('complete image positional encoding must be representable')
    del sampled, lengths, endpoints
    rgb = torch.empty((h * w, 3), device=parameter.device, dtype=scalar_dtype)
    depth = torch.empty(h * w, device=parameter.device, dtype=scalar_dtype)
    samples = {}
    if include_samples:
        samples = {key: torch.empty((h * w, native.num_samples), device=parameter.device,
                                   dtype=scalar_dtype) for key in ('weights', 'alpha')}
    rows = MAX_QUERY_SAMPLES // native.num_samples
    for start in range(0, h * w, rows):
        stop = min(start + rows, h * w)
        result = native.render_rays(origins[:, start:stop], directions[:, start:stop], native.num_samples)
        if not torch.isfinite(result['rgb']).all() or not torch.isfinite(result['depth']).all():
            raise ValueError('native image observations must be finite')
        rgb[start:stop] = result['rgb'][0]
        depth[start:stop] = result['depth'][0]
        for key, output in samples.items():
            output[start:stop] = result[key][0]
        # Retire weights/alpha and native sample intermediates before the next query.
        del result
    return {'rgb': rgb.reshape(h, w, 3), 'depth': depth.reshape(h, w),
            **{key: value.reshape(h, w, native.num_samples) for key, value in samples.items()}}
