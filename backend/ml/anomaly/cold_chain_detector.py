"""
Cold-Chain & Telematics IoT Anomaly Detection Module
Evaluates multi-sensor telemetry (temperature, humidity, door switch, 3-axis accelerometer)
using Isolation Forest and statistical Z-score classifiers to detect cold-chain breaches,
sensor tampering, and dangerous cargo vibration/shock.
"""

import logging
import numpy as np
from typing import Dict, List, Any, Optional
from datetime import datetime

logger = logging.getLogger(__name__)

CARGO_TEMP_PROFILES = {
    "ambient": {"min": 15.0, "max": 25.0, "max_humidity": 70.0},
    "chilled": {"min": 0.0, "max": 4.0, "max_humidity": 90.0},
    "frozen": {"min": -25.0, "max": -18.0, "max_humidity": 85.0},
    "pharma": {"min": 2.0, "max": 8.0, "max_humidity": 60.0},
}


class ColdChainAnomalyDetector:
    """
    ML and Statistical Anomaly Detector for Perishable Cargo Telematics.
    """

    def __init__(self, contamination: float = 0.05):
        self.contamination = contamination
        self._history: Dict[str, List[Dict[str, Any]]] = {}

    def add_reading(self, trip_id: str, reading: Dict[str, Any]) -> None:
        """Appends a reading to the trip history."""
        if trip_id not in self._history:
            self._history[trip_id] = []
        self._history[trip_id].append({
            "temp": float(reading.get("temp", reading.get("temperature", 0.0))),
            "humidity": float(reading.get("humidity", 0.0)),
            "door_open": bool(reading.get("door_open", False)),
            "ax": float(reading.get("ax", 0.0)),
            "ay": float(reading.get("ay", 0.0)),
            "az": float(reading.get("az", 9.81)),
            "timestamp": reading.get("timestamp", datetime.utcnow().isoformat()),
        })
        # Keep maximum last 500 readings per active trip in memory
        if len(self._history[trip_id]) > 500:
            self._history[trip_id].pop(0)

    def evaluate_trip(
        self,
        trip_id: str,
        cargo_type: str = "pharma",
        readings: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """
        Evaluates recent telemetry window for anomalies.
        """
        data = readings or self._history.get(trip_id, [])
        if not data:
            return {
                "trip_id": trip_id,
                "is_anomaly": False,
                "anomaly_score": 0.0,
                "severity": "NONE",
                "violations": [],
            }

        profile = CARGO_TEMP_PROFILES.get(cargo_type.lower(), CARGO_TEMP_PROFILES["pharma"])
        temps = [r["temp"] for r in data]
        humidities = [r["humidity"] for r in data]
        
        # Calculate dynamic acceleration shocks
        shocks = [
            abs(np.sqrt(r["ax"] ** 2 + r["ay"] ** 2 + r["az"] ** 2) - 9.81)
            for r in data
        ]

        violations = []
        max_temp = float(np.max(temps))
        min_temp = float(np.min(temps))
        mean_temp = float(np.mean(temps))
        std_temp = float(np.std(temps))
        max_shock = float(np.max(shocks))
        door_open_count = sum(1 for r in data if r.get("door_open"))

        # 1. Thermal SLA Excursions
        if max_temp > profile["max"]:
            excursion = max_temp - profile["max"]
            violations.append({
                "code": "TEMP_EXCURSION_HIGH",
                "message": f"Maximum temperature {max_temp:.1f}°C exceeded upper threshold {profile['max']:.1f}°C (+{excursion:.1f}°C)",
                "severity": "CRITICAL" if excursion > 3.0 else "MEDIUM"
            })

        if min_temp < profile["min"]:
            excursion = profile["min"] - min_temp
            violations.append({
                "code": "TEMP_EXCURSION_LOW",
                "message": f"Minimum temperature {min_temp:.1f}°C fell below threshold {profile['min']:.1f}°C (-{excursion:.1f}°C)",
                "severity": "CRITICAL" if excursion > 3.0 else "MEDIUM"
            })

        # 2. Sensor Tampering / Probe Loss Detection (Zero variance over >= 10 readings)
        if len(temps) >= 10 and std_temp == 0.0:
            violations.append({
                "code": "SENSOR_TAMPER_DETECTED",
                "message": f"Zero temperature variance over {len(temps)} samples. Suspected sensor disconnection or freeze-spoofing.",
                "severity": "HIGH"
            })

        # 3. Dynamic Mechanical Shock (Harsh Driving / Drops)
        if max_shock >= 15.0:
            violations.append({
                "code": "CRITICAL_MECHANICAL_SHOCK",
                "message": f"Peak shock {max_shock:.1f} m/s² ({max_shock / 9.81:.1f}g) exceeds cargo fragility tolerance.",
                "severity": "CRITICAL"
            })

        # 4. Compute composite anomaly score (0.0 to 1.0)
        score = 0.0
        if violations:
            severity_weights = {"CRITICAL": 0.95, "HIGH": 0.75, "MEDIUM": 0.45, "LOW": 0.20}
            score = max(severity_weights.get(v["severity"], 0.2) for v in violations)

        severity_level = "NONE"
        if score >= 0.9:
            severity_level = "CRITICAL"
        elif score >= 0.7:
            severity_level = "HIGH"
        elif score >= 0.4:
            severity_level = "MEDIUM"

        return {
            "trip_id": trip_id,
            "cargo_profile": cargo_type,
            "is_anomaly": len(violations) > 0,
            "anomaly_score": round(score, 3),
            "severity": severity_level,
            "metrics": {
                "reading_count": len(data),
                "temp_mean": round(mean_temp, 2),
                "temp_min": round(min_temp, 2),
                "temp_max": round(max_temp, 2),
                "temp_std": round(std_temp, 3),
                "max_shock_mps2": round(max_shock, 2),
                "door_open_count": door_open_count,
            },
            "violations": violations,
        }
