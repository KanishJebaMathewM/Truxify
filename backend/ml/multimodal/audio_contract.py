"""Bounded waveform and classifier contracts for the native audio pipeline."""

import librosa
import numpy as np

TARGET_RATE = 16000
MAX_SECONDS = 10


def admit_waveform(audio, sample_rate=TARGET_RATE, *, normalized_pcm=True):
    """Copy/downmix/resample input; finite DSP intermediates may overshoot PCM.

    The external process_audio boundary uses normalized_pcm=True. Revalidation
    after resampling/noise reduction checks shape/size/finiteness without clipping
    the legitimate filter overshoot.
    """
    if type(sample_rate) is not int or not 8000 <= sample_rate <= 192000:
        raise ValueError("sample rate must be an integer in [8000, 192000]")
    value = np.asarray(audio)
    if value.dtype.kind not in "fi" or value.ndim not in (1, 2):
        raise ValueError("audio must be a real mono or stereo array")
    if not 1 <= value.shape[0] <= sample_rate * MAX_SECONDS:
        raise ValueError("audio must contain between one sample and ten seconds")
    if value.ndim == 2 and value.shape[1] not in (1, 2):
        raise ValueError("audio must have one or two channels")
    if not np.isfinite(value).all() or (
        normalized_pcm and np.max(np.abs(value.astype(np.float64))) > 1
    ):
        raise ValueError("audio must contain finite normalized PCM in [-1, 1]")
    with np.errstate(over="ignore", invalid="ignore"):
        owned = value.astype(np.float32, copy=True)
    if owned.ndim == 2:
        owned = owned.mean(axis=1)
    if sample_rate != TARGET_RATE:
        owned = librosa.resample(owned, orig_sr=sample_rate, target_sr=TARGET_RATE)
    if not np.isfinite(owned).all():
        raise ValueError("resampled audio must be finite")
    return owned


def feature_block(values):
    """Keep each feature family in its own fixed 1000-element slot."""
    flat = np.asarray(values, dtype=np.float32).ravel()
    if not np.isfinite(flat).all():
        raise ValueError("features must be finite")
    result = np.zeros(1000, dtype=np.float32)
    result[: min(flat.size, 1000)] = flat[:1000]
    return result


def admit_probabilities(predictions, classes):
    """Accept one complete finite softmax vector, retaining class identity."""
    values = np.asarray(predictions)
    if values.dtype.kind not in "fi" or values.shape != (1, classes):
        raise ValueError("classifier returned an invalid probability shape")
    result = values.astype(np.float64, copy=True)[0]
    if (
        not np.isfinite(result).all()
        or np.any(result < 0)
        or np.any(result > 1)
        or not np.isclose(result.sum(), 1, atol=1e-5)
    ):
        raise ValueError("classifier must return finite normalized probabilities")
    return result
