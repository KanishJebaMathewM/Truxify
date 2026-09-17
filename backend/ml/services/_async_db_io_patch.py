import asyncio
import json
from datetime import datetime
from functools import partial

from . import traffic_pipeline as _traffic_pipeline

_BaseTrafficPipeline = _traffic_pipeline.TrafficPipeline


def _persist_traffic_entry(self, traffic_entry):
    session = self.Session()
    try:
        session.add(traffic_entry)
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def _load_forecast_rows(self, route_id):
    session = self.Session()
    try:
        return (
            session.query(_traffic_pipeline.TrafficData)
            .filter(_traffic_pipeline.TrafficData.route_id == route_id)
            .order_by(_traffic_pipeline.TrafficData.timestamp.desc())
            .limit(24)
            .all()
        )
    finally:
        session.close()


async def _ingest_traffic_data_without_event_loop_db_io(self, route_id, source, dest):
    try:
        gmaps_data = await self._fetch_gmaps_traffic(source, dest)
        osrm_data = await self._fetch_osrm_data(source, dest)
        timestamp = datetime.utcnow()

        traffic_entry = _traffic_pipeline.TrafficData(
            route_id=route_id,
            source_lat=source["lat"],
            source_lng=source["lng"],
            dest_lat=dest["lat"],
            dest_lng=dest["lng"],
            traffic_speed=gmaps_data.get("speed", osrm_data.get("speed", 50)),
            free_flow_speed=osrm_data.get("free_flow_speed", 80),
            congestion_level=gmaps_data.get("congestion", 0.3),
            timestamp=timestamp,
            day_of_week=timestamp.weekday(),
            hour=timestamp.hour,
        )

        await asyncio.to_thread(self._persist_traffic_entry, traffic_entry)

        await asyncio.get_running_loop().run_in_executor(
            None,
            partial(
                self.redis.setex,
                f"traffic:{route_id}",
                300,
                json.dumps(
                    {
                        "speed": traffic_entry.traffic_speed,
                        "congestion": traffic_entry.congestion_level,
                        "timestamp": traffic_entry.timestamp.isoformat(),
                    }
                ),
            ),
        )
        return traffic_entry
    except Exception as exc:
        logger = getattr(_traffic_pipeline, "logger", None)
        if logger:
            logger.error(f"Traffic ingestion failed: {exc}")
        return None


async def _get_traffic_forecast_off_event_loop(self, route_id, hours=1):
    data = await asyncio.to_thread(self._load_forecast_rows, route_id)
    if len(data) < 10:
        return {"forecast": None, "confidence": "low"}

    avg_speed = _traffic_pipeline.np.mean([row.traffic_speed for row in data])
    std_speed = _traffic_pipeline.np.std([row.traffic_speed for row in data])

    return {
        "forecast": avg_speed,
        "std": std_speed,
        "confidence": "medium" if len(data) > 20 else "low",
        "historical_data_points": len(data),
    }


_BaseTrafficPipeline._persist_traffic_entry = _persist_traffic_entry
_BaseTrafficPipeline._load_forecast_rows = _load_forecast_rows
_BaseTrafficPipeline.ingest_traffic_data = _ingest_traffic_data_without_event_loop_db_io
_BaseTrafficPipeline.get_traffic_forecast = _get_traffic_forecast_off_event_loop
_traffic_pipeline.TrafficPipeline = _BaseTrafficPipeline
