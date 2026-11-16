"""
Cold-Chain & Cargo Integrity ML Anomaly Detection Service.

Provides:
1. Mean Kinetic Temperature (MKT) Arrhenius kinetics evaluation.
2. 3-Axis Shock & Vibration impact analysis.
3. Multi-modal sensor breach classification for SLA enforcement.
"""

import math
from typing import Any

DELTA_H_OVER_R = 10000.0
ABSOLUTE_ZERO_CELSIUS = -273.15


def _finite_number(value, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be a finite number")  # noqa: TRY004 - uniform input error protocol
    try:
        result = float(value)
    except OverflowError as exc:
        raise ValueError(f"{name} must be a finite number") from exc
    if not math.isfinite(result):
        raise ValueError(f"{name} must be a finite number")
    return result


def _temperatures(values):
    # Reject the whole window: dropping samples changes its equal-time meaning.
    result = [_finite_number(t, "temperature") for t in values]
    if any(t <= ABSOLUTE_ZERO_CELSIUS for t in result):
        raise ValueError("temperature must be above absolute zero")
    return result


def calculate_mean_kinetic_temperature(
    temperatures_celsius: list[float],
) -> float | None:
    """Equal-observation Arrhenius MKT; empty input has no estimate.

    Invalid observations reject the complete window. This is a numerical
    summary with the existing activation constant, not a product certification.
    """
    temps = _temperatures(temperatures_celsius)
    if not temps:
        return None
    kelvin = [t - ABSOLUTE_ZERO_CELSIUS for t in temps]
    exponents = [-DELTA_H_OVER_R / t for t in kelvin]
    largest = max(exponents)
    if largest > -0.5:
        # Hot values approach exp(x)=1. Preserve their tiny negative deficit.
        deficit = math.fsum(math.expm1(x) for x in exponents) / len(exponents)
        log_average = math.log1p(deficit)
    else:
        # The largest shifted exponential is 1 even for very cold windows.
        scaled = math.fsum(math.exp(x - largest) for x in exponents)
        log_average = largest + math.log(scaled / len(exponents))
    equivalent = DELTA_H_OVER_R / -log_average
    # The exact mean is inside the sample range; bound final rounding drift.
    equivalent = min(max(equivalent, min(kelvin)), max(kelvin))
    return round(equivalent + ABSOLUTE_ZERO_CELSIUS, 2)


def evaluate_shock_vibration(
    shock_readings_g: list[float], max_shock_g: float = 3.5
) -> dict[str, Any]:
    """Scale-normalized RMS of a complete finite sensor window."""
    threshold = _finite_number(max_shock_g, "max_shock_g")
    if threshold < 0:
        raise ValueError("max_shock_g must be nonnegative")
    values = [abs(_finite_number(s, "shock")) for s in shock_readings_g]
    peak = max(values, default=0.0)
    rms = 0.0
    if peak:
        rms = peak * math.sqrt(math.fsum((s / peak) ** 2 for s in values) / len(values))
    return {
        "peak_shock_g": round(peak, 2),
        "rms_vibration_g": round(rms, 2),
        "shock_breach": peak > threshold,
        "breach_count": sum(s > threshold for s in values),
    }


def evaluate_cargo_integrity(
    temperatures_celsius: list[float],
    min_temp: float,
    max_temp: float,
    shock_readings_g: list[float] | None = None,
    door_open_events: int = 0,
    max_allowed_excursion_mins: int = 45,
    sample_interval_mins: float = 1.0,
) -> dict[str, Any]:
    """
    Comprehensive multi-modal cargo integrity and SLA compliance evaluation.
    """
    temperatures_celsius = _temperatures(temperatures_celsius)
    if not temperatures_celsius:
        raise ValueError("cargo evaluation requires a nonempty temperature window")
    min_temp, max_temp = _temperatures([min_temp, max_temp])
    if min_temp > max_temp:
        raise ValueError("min_temp must not exceed max_temp")
    max_allowed_excursion_mins = _finite_number(
        max_allowed_excursion_mins, "excursion allowance"
    )
    sample_interval_mins = _finite_number(sample_interval_mins, "sample interval")
    if max_allowed_excursion_mins < 0 or sample_interval_mins <= 0:
        raise ValueError(
            "excursion allowance must be nonnegative and sample interval positive"
        )
    if (
        isinstance(door_open_events, bool)
        or not isinstance(door_open_events, int)
        or door_open_events < 0
    ):
        raise ValueError("door_open_events must be a nonnegative integer")
    shock_results = evaluate_shock_vibration(
        [] if shock_readings_g is None else shock_readings_g
    )
    mkt = calculate_mean_kinetic_temperature(temperatures_celsius)
    latest_temp = temperatures_celsius[-1]

    # Calculate thermal excursion duration
    excursions = [
        t
        for t in temperatures_celsius
        if t is not None and (t < min_temp or t > max_temp)
    ]
    excursion_count = len(excursions)
    excursion_duration = excursion_count * sample_interval_mins
    if not math.isfinite(excursion_duration):
        raise ValueError("excursion duration exceeds the finite numeric range")
    excursion_minutes = round(excursion_duration, 1)

    temp_breach = excursion_minutes > max_allowed_excursion_mins
    mkt_breach = mkt is not None and (mkt > max_temp + 2.0 or mkt < min_temp - 2.0)

    door_breach = door_open_events > 2

    # Overall SLA status classification
    critical_breaches = []
    if temp_breach:
        critical_breaches.append(
            f"Temperature excursion ({excursion_minutes} mins) exceeded limit ({max_allowed_excursion_mins} mins)"
        )
    if mkt_breach:
        critical_breaches.append(
            f"MKT ({mkt}°C) outside safe kinetic envelope [{min_temp}°C, {max_temp}°C]"
        )
    if shock_results["shock_breach"]:
        critical_breaches.append(
            f"Peak shock impact ({shock_results['peak_shock_g']}g) exceeded limit"
        )
    if door_breach:
        critical_breaches.append(
            f"Unauthorized door opening events ({door_open_events}) detected"
        )

    if critical_breaches:
        status = "CRITICAL_SLA_BREACH"
        quality_score = max(
            0, 100 - (len(critical_breaches) * 30 + int(excursion_minutes))
        )
    elif (
        excursion_minutes > 0
        or shock_results["peak_shock_g"] > 2.0
        or door_open_events > 0
    ):
        status = "WARNING"
        quality_score = (
            50 if excursion_minutes >= 25 else max(50, 100 - int(excursion_minutes * 2))
        )
    else:
        status = "NORMAL"
        quality_score = 100

    return {
        "status": status,
        "quality_score": quality_score,
        "mkt_celsius": mkt,
        "latest_temp_celsius": latest_temp,
        "excursion_minutes": excursion_minutes,
        "max_allowed_excursion_mins": max_allowed_excursion_mins,
        "temp_breach": temp_breach,
        "mkt_breach": mkt_breach,
        "shock_analysis": shock_results,
        "door_open_events": door_open_events,
        "critical_breaches": critical_breaches,
    }
