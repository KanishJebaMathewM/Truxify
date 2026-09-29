from . import traffic_pipeline as _traffic_pipeline


async def _fetch_osrm_data(self, source, dest):
    if self._osrm_circuit_open:
        return {
            "speed": 50,
            "free_flow_speed": 80,
        }

    url = (
        f"{self.osrm_url}/route/v1/driving/"
        f"{source['lng']},{source['lat']};"
        f"{dest['lng']},{dest['lat']}"
    )

    timeout = _traffic_pipeline.aiohttp.ClientTimeout(
        connect=self.traffic_connect_timeout,
        total=self.traffic_total_timeout,
    )
    max_attempts = 3

    for attempt in range(max_attempts):
        try:
            async with _traffic_pipeline.aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(url) as response:
                    data = await response.json()
                    if data.get("routes"):
                        route = data["routes"][0]
                        self._osrm_failure_count = 0
                        reference_speed = (
                            route["distance"] / route["duration"]
                            if route["duration"] > 0
                            else 50
                        )
                        return {
                            "duration": route["duration"],
                            "distance": route["distance"],
                            "speed": reference_speed,
                            "free_flow_speed": reference_speed,
                        }
        except (
            _traffic_pipeline.aiohttp.ClientError,
            _traffic_pipeline.asyncio.TimeoutError,
            TimeoutError,
        ):
            if attempt < max_attempts - 1:
                await _traffic_pipeline.asyncio.sleep(2 ** attempt)
            else:
                self._osrm_failure_count += 1
                if self._osrm_failure_count >= 5:
                    self._osrm_circuit_open = True

    return {
        "speed": 50,
        "free_flow_speed": 80,
    }


_traffic_pipeline.TrafficPipeline._fetch_osrm_data = _fetch_osrm_data
