import asyncio
from datetime import datetime, timedelta

from . import traffic_pipeline as _traffic_pipeline

_BaseTrafficPipeline = _traffic_pipeline.TrafficPipeline


def _load_forecast_history(self, route_id):
    session = self.Session()
    try:
        return (
            session.query(_traffic_pipeline.TrafficData)
            .filter(_traffic_pipeline.TrafficData.route_id == route_id)
            .order_by(_traffic_pipeline.TrafficData.timestamp.desc())
            .limit(168)
            .all()
        )
    finally:
        session.close()


async def _get_traffic_forecast_with_horizon(self, route_id, hours=1):
    try:
        requested_hours = int(hours)
    except (TypeError, ValueError):
        raise ValueError("hours must be a positive integer")

    if requested_hours < 1:
        raise ValueError("hours must be a positive integer")
    requested_hours = min(requested_hours, 24)

    data = await asyncio.to_thread(self._load_forecast_history, route_id)
    if len(data) < 10:
        return {
            "forecast": None,
            "forecast_by_hour": None,
            "forecast_hours": requested_hours,
            "confidence": "low",
        }

    by_hour = {}
    speeds = []
    for row in data:
        if row.traffic_speed is None:
            continue
        by_hour.setdefault(row.hour, []).append(float(row.traffic_speed))
        speeds.append(float(row.traffic_speed))

    if not speeds:
        return {
            "forecast": None,
            "forecast_by_hour": None,
            "forecast_hours": requested_hours,
            "confidence": "low",
        }

    overall_average = _traffic_pipeline.np.mean(speeds)
    next_hour = (datetime.now() + timedelta(hours=1)).hour
    forecast_by_hour = [
        float(
            _traffic_pipeline.np.mean(
                by_hour.get((next_hour + offset) % 24, speeds)
            )
        )
        for offset in range(requested_hours)
    ]

    populated_hours = sum(
        1
        for offset in range(requested_hours)
        if (next_hour + offset) % 24 in by_hour
    )
    confidence = (
        "medium"
        if len(data) > 20 and populated_hours == requested_hours
        else "low"
    )

    return {
        "forecast": forecast_by_hour[0],
        "forecast_by_hour": forecast_by_hour,
        "forecast_hours": requested_hours,
        "std": float(_traffic_pipeline.np.std(speeds)),
        "confidence": confidence,
        "historical_data_points": len(data),
        "historical_average": float(overall_average),
    }


_BaseTrafficPipeline._load_forecast_history = _load_forecast_history
_BaseTrafficPipeline.get_traffic_forecast = _get_traffic_forecast_with_horizon
_traffic_pipeline.TrafficPipeline = _BaseTrafficPipeline
