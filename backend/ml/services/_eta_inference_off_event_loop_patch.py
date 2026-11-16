import asyncio
import json
from datetime import datetime, timedelta
from functools import partial

import numpy as np

from app.execution import run_inference
from . import traffic_pipeline as _traffic_pipeline
from ._eta_observations import observation_lock

_BaseTrafficPipeline = _traffic_pipeline.TrafficPipeline


def _get_predict_eta_lock(pipeline):
    """Return the thread lock used to serialize inference for one pipeline."""
    return observation_lock(pipeline)


def _run_serialized_predict_eta(pipeline, features, route_id, route_signature):
    """Run one ETA prediction while holding the pipeline-local inference lock."""
    with _get_predict_eta_lock(pipeline):
        return pipeline.predict_eta(features, route_id, route_signature)


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
                _run_serialized_predict_eta,
                self,
                features,
                f"order_{order_id}",
                route_signature,
            )

            if predicted_speed_mps is not None:
                osrm_data = await self._fetch_osrm_data(current_location, destination)
                route_distance_m = float(osrm_data.get("distance") or 0)
                eta_seconds = _traffic_pipeline.eta_seconds_from_speed(route_distance_m, predicted_speed_mps)
                if eta_seconds is None:
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
