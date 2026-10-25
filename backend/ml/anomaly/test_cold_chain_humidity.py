"""Regression tests for humidity excursion detection in cold_chain_detector.

The evaluator collects humidity on every reading and every cargo profile
carries a max_humidity bound, so a window that breaches it must raise a
HUMIDITY_EXCURSION_HIGH violation instead of passing silently.
"""
from cold_chain_detector import ColdChainAnomalyDetector, CARGO_TEMP_PROFILES


def _readings(temp=4.0, humidity=50.0, n=12):
    return [
        {
            "temp": temp + (0.1 if i % 2 else -0.1),
            "humidity": humidity,
            "door_open": False,
            "ax": 0.0,
            "ay": 0.0,
            "az": 9.81,
        }
        for i in range(n)
    ]


def test_humidity_within_bound_raises_no_violation():
    detector = ColdChainAnomalyDetector()
    result = detector.evaluate_trip("trip-ok", "pharma", _readings(humidity=55.0))
    assert result["is_anomaly"] is False
    assert result["violations"] == []


def test_humidity_breach_raises_excursion_violation():
    detector = ColdChainAnomalyDetector()
    limit = CARGO_TEMP_PROFILES["pharma"]["max_humidity"]
    result = detector.evaluate_trip(
        "trip-wet", "pharma", _readings(humidity=limit + 5.0)
    )
    codes = [v["code"] for v in result["violations"]]
    assert "HUMIDITY_EXCURSION_HIGH" in codes
    assert result["is_anomaly"] is True


def test_large_humidity_breach_is_critical():
    detector = ColdChainAnomalyDetector()
    limit = CARGO_TEMP_PROFILES["chilled"]["max_humidity"]
    result = detector.evaluate_trip(
        "trip-soaked", "chilled", _readings(humidity=limit + 15.0)
    )
    matches = [
        v for v in result["violations"] if v["code"] == "HUMIDITY_EXCURSION_HIGH"
    ]
    assert matches and matches[0]["severity"] == "CRITICAL"
