import asyncio
import json
from datetime import datetime
from functools import partial

from . import traffic_pipeline as _traffic_pipeline

_BaseTrafficPipeline = _traffic_pipeline.TrafficPipeline


async def _ingest_traffic_data_without_synthetic_training_rows(self, route_id, source, dest):
    try:
        gmaps_data = await self._fetch_gmaps_traffic(source, dest)
        osrm_data = await self._fetch_osrm_data(source, dest)

        gmaps_is_live = "speed" in gmaps_data and "congestion" in gmaps_data
        osrm_is_live = {
            "distance",
            "duration",
            "speed",
            "free_flow_speed",
        }.issubset(osrm_data)

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

        if gmaps_is_live and osrm_is_live:
            await asyncio.to_thread(self._persist_traffic_entry, traffic_entry)
        else:
            self._log_synthetic_traffic_skip(route_id, gmaps_is_live, osrm_is_live)

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


def _log_synthetic_traffic_skip(self, route_id, gmaps_is_live, osrm_is_live):
    logger = getattr(_traffic_pipeline, "logger", None)
    if logger:
        logger.warning(
            "Skipping persistence of incomplete traffic data for route %s "
            "(live Google Maps=%s, live OSRM=%s); keeping it available for live ETA only",
            route_id,
            gmaps_is_live,
            osrm_is_live,
        )


_BaseTrafficPipeline._persist_traffic_entry = _persist_traffic_entry
_BaseTrafficPipeline._log_synthetic_traffic_skip = _log_synthetic_traffic_skip
_BaseTrafficPipeline.ingest_traffic_data = _ingest_traffic_data_without_synthetic_training_rows
_traffic_pipeline.TrafficPipeline = _BaseTrafficPipeline
