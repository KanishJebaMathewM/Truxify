import asyncio
import json
from functools import partial
from typing import Optional

from . import traffic_pipeline as _traffic_pipeline

_BaseTrafficPipeline = _traffic_pipeline.TrafficPipeline


async def ingest_traffic_data(
    self,
    route_id: str,
    source: dict,
    dest: dict,
    cache_route_signature: Optional[str] = None,
):
    """Write real-time traffic under a destination-versioned cache key."""
    traffic_entry = await _BaseTrafficPipeline.ingest_traffic_data(
        self,
        route_id,
        source,
        dest,
    )
    if traffic_entry is None:
        return None

    route_signature = cache_route_signature or self.build_route_signature(dest)
    cache_key = f"traffic:{route_id}:{route_signature}"
    payload = json.dumps({
        "speed": traffic_entry.traffic_speed,
        "congestion": traffic_entry.congestion_level,
        "timestamp": traffic_entry.timestamp.isoformat(),
        "route_signature": route_signature,
    })
    await asyncio.get_running_loop().run_in_executor(
        None,
        partial(self.redis.setex, cache_key, 300, payload),
    )
    return traffic_entry


async def get_real_time_traffic(
    self,
    route_id: str,
    route_signature: Optional[str] = None,
):
    """Read traffic only for the requested destination version."""
    if not route_signature:
        return None

    cache_key = f"traffic:{route_id}:{route_signature}"
    cached = await asyncio.get_running_loop().run_in_executor(
        None,
        partial(self.redis.get, cache_key),
    )
    if not cached:
        return None

    data = json.loads(cached)
    if data.get("route_signature") != route_signature:
        return None
    return data


async def get_route_congestion(
    self,
    route_id: str,
    route_signature: Optional[str] = None,
):
    traffic = await self.get_real_time_traffic(route_id, route_signature)
    return traffic.get("congestion", 0) if traffic else 0


_BaseTrafficPipeline.ingest_traffic_data = ingest_traffic_data
_BaseTrafficPipeline.get_real_time_traffic = get_real_time_traffic
_BaseTrafficPipeline.get_route_congestion = get_route_congestion
