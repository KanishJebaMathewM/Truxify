import os
import time

from . import traffic_pipeline as _traffic_pipeline

_BaseTrafficPipeline = _traffic_pipeline.TrafficPipeline
_BaseFetchOsrmData = _BaseTrafficPipeline._fetch_osrm_data

_CACHE_TTL_SECONDS = float(os.getenv("TRAFFIC_OSRM_CACHE_SECONDS", "5"))


async def _fetch_osrm_data_with_short_cache(self, source, dest):
    cache = getattr(self, "_osrm_route_cache", None)
    if cache is None:
        cache = {}
        self._osrm_route_cache = cache

    key = (
        float(source["lat"]),
        float(source["lng"]),
        float(dest["lat"]),
        float(dest["lng"]),
    )
    now = time.monotonic()
    cached = cache.get(key)
    if cached is not None:
        cached_at, data = cached
        if now - cached_at <= _CACHE_TTL_SECONDS:
            return dict(data)
        cache.pop(key, None)

    data = await _BaseFetchOsrmData(self, source, dest)
    if data.get("distance") is not None and data.get("duration") is not None:
        cache[key] = (now, dict(data))

        if len(cache) > 128:
            oldest_key = min(cache, key=lambda item: cache[item][0])
            cache.pop(oldest_key, None)

    return data


_BaseTrafficPipeline._fetch_osrm_data = _fetch_osrm_data_with_short_cache
_traffic_pipeline.TrafficPipeline = _BaseTrafficPipeline
