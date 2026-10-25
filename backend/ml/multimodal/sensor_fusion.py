"""Observation-backed fusion; missing or invalid feeds cannot certify SAFE."""

import json
import logging
import math
from datetime import datetime
from typing import Any

import redis

logger = logging.getLogger(__name__)
FEED_KEYS = {
    "vision": "vision:latest",
    "audio": "audio:latest",
    "sensors": "sensor:latest",
}
MAX_FRAME_BYTES = 65536


class SensorFusion:
    """Preserve risk coefficients while admitting owned, observed feed values."""

    def __init__(self, redis_url: str = "redis://localhost:6379"):
        self.redis = redis.Redis.from_url(
            redis_url, socket_connect_timeout=2, socket_timeout=2
        )
        self.weights = {"vision": 0.5, "audio": 0.3, "sensors": 0.2}
        self.thresholds = {"critical": 0.8, "warning": 0.5, "safe": 0.2}
        self.sensor_cache = {}

    @staticmethod
    def _number(value):
        if type(value) not in (int, float):
            raise ValueError("invalid numeric observation")
        try:
            result = float(value)
        except OverflowError as exc:
            raise ValueError("invalid numeric observation") from exc
        if not math.isfinite(result):
            raise ValueError("invalid numeric observation")
        return result

    @staticmethod
    def _boolean(value):
        if type(value) is not bool:
            raise ValueError("invalid boolean observation")
        return value

    @staticmethod
    def _timestamp(value):
        if not isinstance(value, str):
            raise TypeError("invalid timestamp")
        # Legacy producers use local naive datetime.now().isoformat().
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone()

    def _admit(self, name, frame, source, now):
        info = {"available": False, "source": source, "reason": "missing", "fields": []}
        if frame is None or (isinstance(frame, dict) and not frame):
            return {}, info
        if not isinstance(frame, dict):
            info["reason"] = "invalid"
            return {}, info
        try:
            if frame.get("status") in ("ERROR", "UNKNOWN", "NO_FACE_DETECTED"):
                raise ValueError("model unavailable")
            stamp = frame.get("timestamp")
            if source == "cache" or stamp is not None:
                age = (now - self._timestamp(stamp)).total_seconds()
                if age > 60 or age < -5:
                    info["reason"] = "stale" if age > 60 else "future"
                    return {}, info
            out = {}
            if name == "vision":
                for field, allowed in (
                    ("drowsiness", {"AWAKE", "SLEEPY", "DROWSY"}),
                    ("distraction", {"FOCUSED", "DISTRACTED"}),
                ):
                    if field not in frame:
                        continue
                    part = frame[field]
                    if not isinstance(part, dict):
                        raise TypeError("invalid model observation")
                    status = part.get("status")
                    if status in ("UNKNOWN", "ERROR", None):
                        continue
                    if status not in allowed:
                        raise ValueError("invalid model status")
                    out[field] = {"status": status}
            elif name == "audio":
                for field, flag in (("emergency", "is_emergency"), ("honk", "is_honk")):
                    if field not in frame:
                        continue
                    part = frame[field]
                    if not isinstance(part, dict) or flag not in part:
                        raise ValueError("invalid audio observation")
                    out[field] = {flag: self._boolean(part[flag])}
                    if field == "honk":
                        count = part.get("honk_count")
                        if type(count) is not int or count < 0:
                            raise ValueError("invalid honk count")
                        self._number(count)
                        out[field]["honk_count"] = count
                if "emotion" in frame:
                    part = frame["emotion"]
                    if not isinstance(part, dict):
                        raise ValueError("invalid emotion")
                    emotion = part.get("emotion")
                    if emotion not in ("unknown", "UNKNOWN", None):
                        if emotion not in (
                            "neutral",
                            "happy",
                            "sad",
                            "angry",
                            "fearful",
                            "surprised",
                        ):
                            raise ValueError("invalid emotion")
                        out["emotion"] = {"emotion": emotion}
            else:
                for field in ("speed", "acceleration", "steering_angle"):
                    if field in frame:
                        out[field] = self._number(frame[field])
                if "speed" in out and out["speed"] < 0:
                    raise ValueError("invalid speed")
                if "seatbelt" in frame:
                    out["seatbelt"] = self._boolean(frame["seatbelt"])
            if not out:
                info["reason"] = "no_observations"
                return {}, info
            info.update(available=True, reason="observed", fields=list(out))
            if stamp is not None:
                out["timestamp"] = stamp
            return out, info
        except (ValueError, TypeError, OverflowError):
            info["reason"] = "invalid"
            return {}, info

    def _cached_frames(self):
        """One Redis command observes all feed values at one server snapshot."""
        try:
            raw_frames = self.redis.mget(list(FEED_KEYS.values()))
        except redis.RedisError:
            return {}, {name: "cache_unavailable" for name in FEED_KEYS}
        frames, errors = {}, {}
        for name, raw in zip(FEED_KEYS, raw_frames):
            if raw is None:
                frames[name] = None
                continue
            try:
                if len(raw) > MAX_FRAME_BYTES:
                    raise ValueError("frame too large")
                frames[name] = json.loads(raw, parse_constant=self._reject_constant)
            except (ValueError, TypeError, UnicodeError, RecursionError):
                frames[name] = None
                errors[name] = "invalid"
        return frames, errors

    @staticmethod
    def _reject_constant(value):
        raise ValueError("non-finite JSON number")

    def analyze(self, vision_data=None, audio_data=None, sensor_data=None):
        """None selects cache; an explicitly supplied empty mapping stays empty."""
        provided = {"vision": vision_data, "audio": audio_data, "sensors": sensor_data}
        cached, errors = (
            self._cached_frames()
            if any(v is None for v in provided.values())
            else ({}, {})
        )
        sources = {
            name: "cache" if value is None else "request"
            for name, value in provided.items()
        }
        frames = {
            name: cached.get(name) if value is None else value
            for name, value in provided.items()
        }
        return self._fuse(frames, sources, errors)

    def fuse_data(self, vision_data: dict, audio_data: dict, sensor_data: dict) -> dict:
        return self._fuse(
            {"vision": vision_data, "audio": audio_data, "sensors": sensor_data},
            dict.fromkeys(FEED_KEYS, "request"),
            {},
        )

    def _fuse(self, frames, sources, errors):
        now = datetime.now().astimezone()
        components, availability = {}, {}
        for name in FEED_KEYS:
            components[name], availability[name] = self._admit(
                name, frames[name], sources[name], now
            )
            if sources[name] == "cache" and name in errors:
                availability[name]["reason"] = errors[name]
        risks = {
            "vision": self._calculate_vision_risk(components["vision"]),
            "audio": self._calculate_audio_risk(components["audio"]),
            "sensors": self._calculate_sensor_risk(components["sensors"]),
        }
        risk = sum(risks[name] * self.weights[name] for name in risks)
        complete = all(info["available"] for info in availability.values())
        level = (
            (
                "CRITICAL"
                if risk > self.thresholds["critical"]
                else "WARNING"
                if risk > self.thresholds["warning"]
                else "SAFE"
            )
            if complete
            else "UNKNOWN"
        )
        messages = {
            "UNKNOWN": "Insufficient valid observations to assess driver safety.",
            "SAFE": "No elevated risk detected in the available observations.",
            "WARNING": "Moderate risk detected. Please be careful.",
            "CRITICAL": "High risk detected! Immediate action required.",
        }
        report = {
            "fusion_risk": float(risk),
            "vision_risk": float(risks["vision"]),
            "audio_risk": float(risks["audio"]),
            "sensor_risk": float(risks["sensors"]),
            "alert_level": level,
            "alert_message": messages[level],
            "data_available": any(info["available"] for info in availability.values()),
            "coverage_complete": complete,
            "availability": availability,
            "components": components,
            "timestamp": now.isoformat(),
        }
        report["actions"] = self._generate_actions(report)
        report["persistence_available"] = True
        try:
            self.redis.setex("fusion:latest", 60, json.dumps(report, allow_nan=False))
        except redis.RedisError:
            logger.warning("Safety report persistence unavailable")
            report.update(
                persistence_available=False,
                alert_level="UNKNOWN",
                alert_message="Safety report persistence unavailable.",
            )
            report["actions"] = self._generate_actions(report)
        return report

    def _calculate_vision_risk(self, data):
        status = data.get("drowsiness", {}).get("status")
        risk = 0.4 if status == "DROWSY" else 0.2 if status == "SLEEPY" else 0.0
        if data.get("distraction", {}).get("status") == "DISTRACTED":
            risk += 0.3
        return min(risk, 1.0)

    def _calculate_audio_risk(self, data):
        risk = 0.4 if data.get("emergency", {}).get("is_emergency") else 0.0
        honk = data.get("honk", {})
        if honk.get("is_honk") and honk.get("honk_count", 0) > 3:
            risk += 0.2
        if data.get("emotion", {}).get("emotion") in ("angry", "fearful"):
            risk += 0.2
        return min(risk, 1.0)

    def _calculate_sensor_risk(self, data):
        risk = 0.2 if data.get("speed", 0) > 80 else 0.0
        if abs(data.get("acceleration", 0)) > 5:
            risk += 0.2
        if abs(data.get("steering_angle", 0)) > 30:
            risk += 0.1
        if data.get("seatbelt") is False:
            risk += 0.3
        return min(risk, 1.0)

    def get_safety_report(self) -> dict:
        return self.analyze()

    def _generate_actions(self, report: dict) -> list[str]:
        if report["alert_level"] == "UNKNOWN":
            return [
                "Check feed connectivity and observation validity.",
                "Wait for valid observations before assessing safety.",
            ]
        if report["alert_level"] == "CRITICAL":
            return [
                "Sound alarm immediately",
                "Notify fleet manager",
                "Contact emergency services if needed",
                "Record video for incident analysis",
                "Suggest immediate break",
            ]
        if report["alert_level"] == "WARNING":
            return [
                "Alert driver with voice warning",
                "Monitor driver closely",
                "Suggest rest stop",
                "Log incident for review",
            ]
        return ["Continue monitoring", "Record safety metrics", "Update safety score"]

    def get_stats(self) -> dict[str, Any]:
        raw = self.redis.get("fusion:latest")

        def count_keys(pattern):
            count = 0
            cursor = 0
            while True:
                cursor, keys = self.redis.scan(cursor=cursor, match=pattern, count=100)
                count += len(keys)
                if cursor == 0:
                    break
            return count

        return {
            "last_fusion": json.loads(raw) if raw else None,
            "vision_count": count_keys("vision:*"),
            "audio_count": count_keys("audio:*"),
            "timestamp": datetime.now().astimezone().isoformat(),
        }
