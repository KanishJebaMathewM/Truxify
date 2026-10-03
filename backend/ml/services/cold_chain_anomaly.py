"""
Cold-Chain & Cargo Integrity ML Anomaly Detection Service.

Provides:
1. Mean Kinetic Temperature (MKT) Arrhenius kinetics evaluation.
2. 3-Axis Shock & Vibration impact analysis.
3. Multi-modal sensor breach classification for SLA enforcement.
"""

import math
import numpy as np
from typing import List, Dict, Any, Optional

# Standard activation energy constant (deltaH / R in Kelvin for typical perishable goods)
DELTA_H_OVER_R = 10000.0


def calculate_mean_kinetic_temperature(temperatures_celsius: List[float]) -> Optional[float]:
    """
    Computes the Mean Kinetic Temperature (MKT) in Celsius.
    MKT gives higher weight to temperature excursions due to exponential degradation kinetics.
    """
    if not temperatures_celsius:
        return None

    valid_temps = [t for t in temperatures_celsius if isinstance(t, (int, float)) and not math.isnan(t)]
    if not valid_temps:
        return None

    sum_exp = 0.0
    for t in valid_temps:
        temp_kelvin = t + 273.15
        if temp_kelvin <= 0:
            continue
        sum_exp += math.exp(-DELTA_H_OVER_R / temp_kelvin)

    avg_exp = sum_exp / len(valid_temps)
    if avg_exp <= 0:
        return None

    mkt_kelvin = DELTA_H_OVER_R / (-math.log(avg_exp))
    mkt_celsius = mkt_kelvin - 273.15
    return round(mkt_celsius, 2)


def evaluate_shock_vibration(shock_readings_g: List[float], max_shock_g: float = 3.5) -> Dict[str, Any]:
    """
    Evaluates tri-axial shock/vibration spikes against structural cargo limits.
    """
    if not shock_readings_g:
        return {
            "peak_shock_g": 0.0,
            "rms_vibration_g": 0.0,
            "shock_breach": False,
            "breach_count": 0,
        }

    valid_shocks = [abs(s) for s in shock_readings_g if isinstance(s, (int, float)) and not math.isnan(s)]
    if not valid_shocks:
        return {
            "peak_shock_g": 0.0,
            "rms_vibration_g": 0.0,
            "shock_breach": False,
            "breach_count": 0,
        }

    peak_shock = float(np.max(valid_shocks))
    rms_vibration = float(np.sqrt(np.mean(np.square(valid_shocks))))
    breach_count = int(np.sum(np.array(valid_shocks) > max_shock_g))

    return {
        "peak_shock_g": round(peak_shock, 2),
        "rms_vibration_g": round(rms_vibration, 2),
        "shock_breach": peak_shock > max_shock_g,
        "breach_count": breach_count,
    }


def evaluate_cargo_integrity(
    temperatures_celsius: List[float],
    min_temp: float,
    max_temp: float,
    shock_readings_g: Optional[List[float]] = None,
    door_open_events: int = 0,
    max_allowed_excursion_mins: int = 45,
    sample_interval_mins: float = 1.0,
) -> Dict[str, Any]:
    """
    Comprehensive multi-modal cargo integrity and SLA compliance evaluation.
    """
    mkt = calculate_mean_kinetic_temperature(temperatures_celsius)
    latest_temp = temperatures_celsius[-1] if temperatures_celsius else None

    # Calculate thermal excursion duration
    excursions = [
        t for t in temperatures_celsius
        if t is not None and (t < min_temp or t > max_temp)
    ]
    excursion_count = len(excursions)
    excursion_minutes = round(excursion_count * sample_interval_mins, 1)

    temp_breach = excursion_minutes > max_allowed_excursion_mins
    mkt_breach = mkt is not None and (mkt > max_temp + 2.0 or mkt < min_temp - 2.0)

    shock_results = evaluate_shock_vibration(shock_readings_g or [])
    door_breach = door_open_events > 2

    # Overall SLA status classification
    critical_breaches = []
    if temp_breach:
        critical_breaches.append(f"Temperature excursion ({excursion_minutes} mins) exceeded limit ({max_allowed_excursion_mins} mins)")
    if mkt_breach:
        critical_breaches.append(f"MKT ({mkt}°C) outside safe kinetic envelope [{min_temp}°C, {max_temp}°C]")
    if shock_results["shock_breach"]:
        critical_breaches.append(f"Peak shock impact ({shock_results['peak_shock_g']}g) exceeded limit")
    if door_breach:
        critical_breaches.append(f"Unauthorized door opening events ({door_open_events}) detected")

    if critical_breaches:
        status = "CRITICAL_SLA_BREACH"
        quality_score = max(0, 100 - (len(critical_breaches) * 30 + int(excursion_minutes)))
    elif excursion_minutes > 0 or shock_results["peak_shock_g"] > 2.0 or door_open_events > 0:
        status = "WARNING"
        quality_score = max(50, 100 - int(excursion_minutes * 2))
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
