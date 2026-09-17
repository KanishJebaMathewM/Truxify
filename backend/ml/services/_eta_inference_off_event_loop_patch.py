import asyncio
import json
from datetime import datetime, timedelta
from functools import partial

import numpy as np

from app.execution import run_inference
from . import traffic_pipeline as _traffic_pipeline

_BaseTrafficPipeline = _traffic_pipeline.TrafficPipeline


async def update_eta_realtime(self, order_id, current_location, destination):
    """Update ETA without running synchronous model inference on the event loop."""
    try:
        traffic_data = await self.ingest_traffic_data(
            f"order_{order_id}",
            current_location,
            destination,
        )

        if traffic_data:
            features = np.array([[
                traffic_data.traffic_speed,
                traffic_data.free_flow_speed,
                traffic_data.congestion_level,
                datetime.now().hour,
                datetime.now().weekday(),
            ]])

            route_signature = self.build_route_signature(destination)
            predicted_speed_mps = await _traffic_pipeline.run_inference(
                self.predict_eta,
                features,
                f"order_{order_id}",
                route_signature,
            )

            if predicted_speed_mps is not None:
                osrm_data = await self._fetch_osrm_data(current_location, destination)
                route_distance_m = float(osrm_data.get("distance") or 0)
                if route_distance_m > 0 and predicted_speed_mps > 0:
                    eta_seconds = route_distance_m / predicted_speed_mps
                else:
                    eta_seconds = float(osrm_data.get("duration") or 0)

                eta_minutes = eta_seconds / 60
                eta_string = str(timedelta(seconds=int(eta_seconds)))

                await asyncio.get_running_loop().run_in_executor(
                    None,
                    partial(
                        self.redis.setex,
                        f"eta:order:{order_id}",
                        300,
                        json.dumps({
                            "eta_seconds": eta_seconds,
                            "eta_minutes": eta_minutes,
                            "eta_string": eta_string,
                            "timestamp": datetime.now().isoformat(),
                            "traffic_speed": traffic_data.traffic_speed,
                            "congestion_level": traffic_data.congestion_level,
                        }),
                    ),
                )

                return {
                    "eta_seconds": eta_seconds,
                    "eta_minutes": eta_minutes,
                    "eta_string": eta_string,
                    "traffic_speed": traffic_data.traffic_speed,
                    "congestion_level": traffic_data.congestion_level,
                }

        return None
    except Exception as exc:
        _traffic_pipeline.logger.error(f"ETA update failed: {exc}")
        return None


_BaseTrafficPipeline.update_eta_realtime = update_eta_realtime
_traffic_pipeline.run_inference = run_inference
