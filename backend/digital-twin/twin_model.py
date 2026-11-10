import logging
import math
import uuid

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional


logger = logging.getLogger(__name__)


# ============================================================
# DATA MODELS
# ============================================================

@dataclass
class LogisticsAsset:
    """Represents a logistics asset in the digital twin."""

    id: str
    type: str
    location: Dict[str, float]
    status: str
    metadata: Dict[str, Any] = field(default_factory=dict)
    created_at: datetime = field(default_factory=datetime.now)
    updated_at: datetime = field(default_factory=datetime.now)

    def __post_init__(self) -> None:
        if not self.id:
            raise ValueError("Asset ID cannot be empty")

        if not self.type:
            raise ValueError("Asset type cannot be empty")

        self.location = _validate_location(self.location)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "type": self.type,
            "location": self.location,
            "status": self.status,
            "metadata": self.metadata,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }


@dataclass
class LogisticsEvent:
    """Represents an event in logistics operations."""

    id: str
    type: str
    timestamp: datetime
    asset_id: str
    location: Dict[str, float]
    metadata: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.id:
            raise ValueError("Event ID cannot be empty")

        if not self.asset_id:
            raise ValueError("Event asset_id cannot be empty")

        self.location = _validate_location(self.location)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "type": self.type,
            "timestamp": self.timestamp.isoformat(),
            "asset_id": self.asset_id,
            "location": self.location,
            "metadata": self.metadata,
        }


@dataclass
class SimulationResult:
    """Result of a simulation run."""

    scenario_id: str
    metrics: Dict[str, Any]
    events: List[LogisticsEvent]
    recommendations: List[str]
    duration: float
    timestamp: datetime

    def to_dict(self) -> Dict[str, Any]:
        return {
            "scenario_id": self.scenario_id,
            "metrics": self.metrics,
            "events": [event.to_dict() for event in self.events],
            "recommendations": self.recommendations,
            "duration": self.duration,
            "timestamp": self.timestamp.isoformat(),
        }


# ============================================================
# VALIDATION HELPERS
# ============================================================

def _validate_location(location: Dict[str, float]) -> Dict[str, float]:
    """Validate and normalize a latitude/longitude dictionary."""

    if not isinstance(location, dict):
        raise ValueError("Location must be a dictionary")

    if "lat" not in location or "lng" not in location:
        raise ValueError("Location must contain 'lat' and 'lng'")

    try:
        lat = float(location["lat"])
        lng = float(location["lng"])
    except (TypeError, ValueError) as exc:
        raise ValueError("Latitude and longitude must be numeric") from exc

    if not math.isfinite(lat) or not math.isfinite(lng):
        raise ValueError("Latitude and longitude must be finite numbers")

    if not -90 <= lat <= 90:
        raise ValueError("Latitude must be between -90 and 90")

    if not -180 <= lng <= 180:
        raise ValueError("Longitude must be between -180 and 180")

    return {
        "lat": lat,
        "lng": lng,
    }


def _clamp(value: float, minimum: float, maximum: float) -> float:
    """Keep a numeric value inside a range."""

    return max(minimum, min(maximum, value))


def _distance_km(
    point_a: Dict[str, float],
    point_b: Dict[str, float],
) -> float:
    """Calculate approximate distance between two coordinates."""

    point_a = _validate_location(point_a)
    point_b = _validate_location(point_b)

    earth_radius_km = 6371.0

    lat1 = math.radians(point_a["lat"])
    lat2 = math.radians(point_b["lat"])

    delta_lat = math.radians(point_b["lat"] - point_a["lat"])
    delta_lng = math.radians(point_b["lng"] - point_a["lng"])

    haversine = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1)
        * math.cos(lat2)
        * math.sin(delta_lng / 2) ** 2
    )

    return earth_radius_km * 2 * math.atan2(
        math.sqrt(haversine),
        math.sqrt(max(0.0, 1 - haversine)),
    )


# ============================================================
# DIGITAL TWIN
# ============================================================

class DigitalTwin:
    """Digital Twin for logistics operations."""

    def __init__(self):
        self.assets: Dict[str, LogisticsAsset] = {}
        self.events: List[LogisticsEvent] = []
        self.history: List[Dict[str, Any]] = []
        self.simulations: List[SimulationResult] = []
        self.state: Dict[str, Any] = {}

        logger.info("Digital Twin initialized")

    # --------------------------------------------------------
    # ASSET MANAGEMENT
    # --------------------------------------------------------

    def add_asset(self, asset: LogisticsAsset) -> LogisticsAsset:
        """Add an asset to the digital twin."""

        if asset.id in self.assets:
            raise ValueError(f"Asset '{asset.id}' already exists")

        self.assets[asset.id] = asset

        logger.info(
            "Asset added: %s (%s)",
            asset.id,
            asset.type,
        )

        return asset

    def update_asset(
        self,
        asset_id: str,
        updates: Dict[str, Any],
    ) -> bool:
        """Update an existing asset safely."""

        asset = self.assets.get(asset_id)

        if asset is None:
            logger.warning("Asset not found: %s", asset_id)
            return False

        if not isinstance(updates, dict):
            raise ValueError("Updates must be a dictionary")

        allowed_fields = {
            "type",
            "location",
            "status",
            "metadata",
        }

        for key in updates:
            if key not in allowed_fields:
                raise ValueError(
                    f"Unsupported asset field: {key}"
                )

        if "location" in updates:
            updates["location"] = _validate_location(
                updates["location"]
            )

        for key, value in updates.items():
            setattr(asset, key, value)

        asset.updated_at = datetime.now()

        logger.info("Asset updated: %s", asset_id)

        return True

    def remove_asset(self, asset_id: str) -> bool:
        """Remove an asset from the digital twin."""

        if asset_id not in self.assets:
            return False

        del self.assets[asset_id]

        logger.info("Asset removed: %s", asset_id)

        return True

    def get_asset_state(
        self,
        asset_id: str,
    ) -> Optional[Dict[str, Any]]:
        """Get the current state of an asset."""

        asset = self.assets.get(asset_id)

        if asset is None:
            return None

        return asset.to_dict()

    def get_all_assets(self) -> List[Dict[str, Any]]:
        """Return all assets."""

        return [
            asset.to_dict()
            for asset in self.assets.values()
        ]

    # --------------------------------------------------------
    # EVENT MANAGEMENT
    # --------------------------------------------------------

    def add_event(self, event: LogisticsEvent) -> LogisticsEvent:
        """Add an event to the digital twin."""

        if event.asset_id not in self.assets:
            raise ValueError(
                f"Asset '{event.asset_id}' does not exist"
            )

        self.events.append(event)

        self.history.append(
            {
                "timestamp": event.timestamp.isoformat(),
                "type": event.type,
                "asset_id": event.asset_id,
                "location": event.location.copy(),
                "metadata": dict(event.metadata),
            }
        )

        logger.info(
            "Event added: %s for %s",
            event.type,
            event.asset_id,
        )

        return event

    def get_events(
        self,
        asset_id: Optional[str] = None,
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        """Return recent events, optionally filtered by asset."""

        if limit < 1:
            return []

        events = self.events

        if asset_id is not None:
            events = [
                event
                for event in events
                if event.asset_id == asset_id
            ]

        events = sorted(
            events,
            key=lambda event: event.timestamp,
            reverse=True,
        )

        return [
            event.to_dict()
            for event in events[:limit]
        ]

    def get_state(self) -> Dict[str, Any]:
        """Return the current state of the digital twin."""

        last_update = None

        if self.events:
            last_update = max(
                event.timestamp
                for event in self.events
            ).isoformat()

        return {
            "assets": self.get_all_assets(),
            "total_assets": len(self.assets),
            "total_events": len(self.events),
            "total_simulations": len(self.simulations),
            "last_update": (
                last_update
                if last_update is not None
                else datetime.now().isoformat()
            ),
        }


# ============================================================
# SIMULATION ENGINE
# ============================================================

class SimulationEngine:
    """Simulation engine for the logistics digital twin."""

    def __init__(self, twin: DigitalTwin):
        self.twin = twin
        self.scenarios: Dict[str, Dict[str, Any]] = {}

        logger.info("Simulation Engine initialized")

    def create_scenario(
        self,
        name: str,
        params: Dict[str, Any],
    ) -> str:
        """Create a simulation scenario."""

        if not name or not name.strip():
            raise ValueError("Scenario name cannot be empty")

        if not isinstance(params, dict):
            raise ValueError("Scenario parameters must be a dictionary")

        scenario_id = f"scenario_{uuid.uuid4().hex[:12]}"

        self.scenarios[scenario_id] = {
            "name": name.strip(),
            "params": dict(params),
            "created_at": datetime.now(),
        }

        logger.info(
            "Scenario created: %s",
            scenario_id,
        )

        return scenario_id

    def run_simulation(
        self,
        scenario_id: str,
        duration: int = 3600,
    ) -> SimulationResult:
        """Run a logistics simulation."""

        if scenario_id not in self.scenarios:
            raise ValueError(
                f"Scenario '{scenario_id}' not found"
            )

        if duration <= 0:
            raise ValueError(
                "Simulation duration must be greater than zero"
            )

        start_time = datetime.now()

        scenario = self.scenarios[scenario_id]
        params = scenario["params"]

        events: List[LogisticsEvent] = []

        assets = list(self.twin.assets.values())

        if assets:
            simulation_steps = max(1, duration // 60)

            event_types = params.get(
                "event_types",
                [
                    "pickup",
                    "dropoff",
                    "arrival",
                    "departure",
                    "delay",
                ],
            )

            event_probability = float(
                params.get("event_probability", 0.1)
            )

            event_probability = _clamp(
                event_probability,
                0.0,
                1.0,
            )

            for step in range(simulation_steps):

                if step % max(1, int(1 / max(event_probability, 0.01))) != 0:
                    continue

                asset = assets[step % len(assets)]

                event_type = event_types[
                    step % len(event_types)
                ]

                event_time = start_time + timedelta(
                    seconds=step * 60
                )

                event = LogisticsEvent(
                    id=f"sim_{uuid.uuid4().hex[:12]}",
                    type=str(event_type),
                    timestamp=event_time,
                    asset_id=asset.id,
                    location=dict(asset.location),
                    metadata={
                        "scenario": scenario_id,
                        "simulation_step": step,
                    },
                )

                events.append(event)

        metrics = self._calculate_metrics(
            events,
            params,
            duration,
        )

        recommendations = self._generate_recommendations(
            metrics
        )

        duration_ms = (
            datetime.now() - start_time
        ).total_seconds() * 1000

        result = SimulationResult(
            scenario_id=scenario_id,
            metrics=metrics,
            events=events,
            recommendations=recommendations,
            duration=duration_ms,
            timestamp=datetime.now(),
        )

        self.twin.simulations.append(result)

        logger.info(
            "Simulation completed: %s",
            scenario_id,
        )

        return result

    def _calculate_metrics(
        self,
        events: List[LogisticsEvent],
        params: Dict[str, Any],
        duration: int,
    ) -> Dict[str, Any]:
        """Calculate simulation metrics."""

        event_types: Dict[str, int] = {}

        for event in events:
            event_types[event.type] = (
                event_types.get(event.type, 0) + 1
            )

        unique_assets = len(
            {event.asset_id for event in events}
        )

        delay_count = event_types.get("delay", 0)

        utilization = 0.0

        if self.twin.assets and duration > 0:
            utilization = len(events) / (
                max(1, len(self.twin.assets))
                * max(1, duration / 60)
            )

            utilization = _clamp(
                utilization,
                0.0,
                1.0,
            )

        efficiency = 1.0

        if events:
            efficiency = 1.0 - (
                delay_count / len(events)
            )

        efficiency = _clamp(
            efficiency,
            0.0,
            1.0,
        )

        return {
            "total_events": len(events),
            "unique_assets": unique_assets,
            "event_types": event_types,
            "utilization": round(utilization, 4),
            "efficiency": round(efficiency, 4),
            "delay_count": delay_count,
            "simulation_duration_seconds": duration,
        }

    def _generate_recommendations(
        self,
        metrics: Dict[str, Any],
    ) -> List[str]:
        """Generate operational recommendations."""

        recommendations: List[str] = []

        utilization = metrics.get(
            "utilization",
            0.0,
        )

        efficiency = metrics.get(
            "efficiency",
            0.0,
        )

        delay_count = metrics.get(
            "delay_count",
            0,
        )

        if utilization < 0.5:
            recommendations.append(
                "Increase asset utilization by optimizing routes and assignments."
            )

        if efficiency < 0.7:
            recommendations.append(
                "Improve operational efficiency by reducing delays and idle time."
            )

        if delay_count > 5:
            recommendations.append(
                "Investigate recurring delays and identify operational bottlenecks."
            )

        if not recommendations:
            recommendations.append(
                "Current simulated operations are running efficiently."
            )

        return recommendations


# ============================================================
# PREDICTIVE ANALYTICS
# ============================================================

class PredictiveAnalytics:
    """Predictive analytics for the digital twin."""

    def __init__(self, twin: DigitalTwin):
        self.twin = twin
        self.predictions: Dict[str, Any] = {}

        logger.info("Predictive Analytics initialized")

    def predict_delays(
        self,
        asset_id: str,
        hours: int = 24,
    ) -> Dict[str, Any]:
        """Estimate future delay risk from historical events."""

        if asset_id not in self.twin.assets:
            return {
                "error": "Asset not found",
                "asset_id": asset_id,
            }

        if hours <= 0:
            raise ValueError(
                "hours must be greater than zero"
            )

        events = self.twin.get_events(
            asset_id,
            limit=100,
        )

        total_events = len(events)

        if total_events < 10:
            return {
                "prediction": "insufficient_data",
                "confidence": round(
                    total_events / 10,
                    2,
                ),
                "delay_probability": None,
                "historical_delays": 0,
                "total_events": total_events,
                "forecast_hours": hours,
            }

        delay_count = sum(
            1
            for event in events
            if event["type"] == "delay"
        )

        delay_probability = (
            delay_count / total_events
        )

        confidence = min(
            1.0,
            total_events / 50,
        )

        if delay_probability >= 0.5:
            prediction = "high_risk"
        elif delay_probability >= 0.3:
            prediction = "medium_risk"
        else:
            prediction = "low_risk"

        result = {
            "prediction": prediction,
            "confidence": round(confidence, 2),
            "delay_probability": round(
                delay_probability,
                4,
            ),
            "historical_delays": delay_count,
            "total_events": total_events,
            "forecast_hours": hours,
        }

        self.predictions[
            f"delay_{asset_id}"
        ] = result

        return result

    def predict_arrival_time(
        self,
        asset_id: str,
    ) -> Dict[str, Any]:
        """Estimate arrival time using the asset's route metadata."""

        asset = self.twin.assets.get(asset_id)

        if asset is None:
            return {
                "error": "Asset not found",
                "asset_id": asset_id,
            }

        status = asset.status.lower().strip()

        if status != "in_transit":
            return {
                "status": asset.status,
                "message": "Asset not in transit",
            }

        metadata = asset.metadata or {}

        destination = metadata.get("destination")

        if destination is None:
            return {
                "status": status,
                "message": (
                    "Destination is unavailable; "
                    "ETA cannot be calculated."
                ),
            }

        try:
            destination = _validate_location(
                destination
            )
        except ValueError:
            return {
                "status": status,
                "message": "Invalid destination coordinates",
            }

        distance = _distance_km(
            asset.location,
            destination,
        )

        average_speed = float(
            metadata.get(
                "average_speed_kmh",
                50.0,
            )
        )

        if average_speed <= 0:
            return {
                "error": "Average speed must be greater than zero"
            }

        eta_hours = distance / average_speed
        eta_minutes = eta_hours * 60

        estimated_arrival = (
            datetime.now()
            + timedelta(hours=eta_hours)
        )

        result = {
            "estimated_arrival": estimated_arrival.isoformat(),
            "confidence": 0.85,
            "distance_remaining": round(
                distance,
                2,
            ),
            "average_speed": round(
                average_speed,
                2,
            ),
            "eta_minutes": round(
                eta_minutes,
                2,
            ),
        }

        self.predictions[
            f"arrival_{asset_id}"
        ] = result

        return result

    def predict_demand(
        self,
        location: Dict[str, float],
        hours: int = 24,
    ) -> Dict[str, Any]:
        """Estimate demand using historical event activity."""

        if hours <= 0:
            raise ValueError(
                "hours must be greater than zero"
            )

        location = _validate_location(location)

        nearby_events = 0

        for event in self.twin.events:
            distance = _distance_km(
                location,
                event.location,
            )

            if distance <= 50:
                nearby_events += 1

        if nearby_events == 0:
            predicted_demand = 10.0
            confidence = 0.25
        else:
            event_rate = (
                nearby_events
                / max(1, hours)
            )

            predicted_demand = max(
                10.0,
                event_rate * 24,
            )

            confidence = min(
                0.95,
                0.25 + nearby_events / 100,
            )

        current_hour = datetime.now().hour

        if 6 <= current_hour < 12:
            peak_time = "morning"
        elif 12 <= current_hour < 18:
            peak_time = "afternoon"
        else:
            peak_time = "evening"

        return {
            "location": location,
            "predicted_demand": round(
                predicted_demand,
                2,
            ),
            "confidence": round(
                confidence,
                2,
            ),
            "peak_time": peak_time,
            "forecast_hours": hours,
            "nearby_historical_events": nearby_events,
        }


# ============================================================
# OPTIMIZER
# ============================================================

class DigitalTwinOptimizer:
    """Optimization engine for the digital twin."""

    def __init__(self, twin: DigitalTwin):
        self.twin = twin

        logger.info(
            "Digital Twin Optimizer initialized"
        )

    def optimize_routes(
        self,
        asset_ids: List[str],
    ) -> Dict[str, Any]:
        """Generate route suggestions for assets."""

        if not isinstance(asset_ids, list):
            raise ValueError(
                "asset_ids must be a list"
            )

        routes: Dict[str, Dict[str, Any]] = {}

        for asset_id in asset_ids:
            asset = self.twin.assets.get(asset_id)

            if asset is None:
                continue

            current_location = dict(
                asset.location
            )

            metadata = asset.metadata or {}

            destination = metadata.get(
                "destination"
            )

            if destination is not None:
                try:
                    destination = _validate_location(
                        destination
                    )

                    distance = _distance_km(
                        current_location,
                        destination,
                    )

                    average_speed = float(
                        metadata.get(
                            "average_speed_kmh",
                            50.0,
                        )
                    )

                    average_speed = max(
                        average_speed,
                        1.0,
                    )

                    estimated_time = (
                        distance
                        / average_speed
                        * 60
                    )

                    next_stop = destination

                except (ValueError, TypeError):
                    next_stop = current_location
                    distance = 0.0
                    estimated_time = 0.0

            else:
                next_stop = current_location
                distance = 0.0
                estimated_time = 0.0

            routes[asset_id] = {
                "asset_id": asset_id,
                "current_location": current_location,
                "next_stop": next_stop,
                "estimated_time": round(
                    estimated_time,
                    2,
                ),
                "distance": round(
                    distance,
                    2,
                ),
            }

        return {
            "routes": routes,
            "optimization_time": datetime.now().isoformat(),
            "assets_considered": len(asset_ids),
            "assets_optimized": len(routes),
        }

    def resource_allocation(
        self,
        resources: Dict[str, Dict[str, Any]],
    ) -> Dict[str, Dict[str, Any]]:
        """Allocate resources based on availability and demand."""

        if not isinstance(resources, dict):
            raise ValueError(
                "resources must be a dictionary"
            )

        allocation: Dict[str, Dict[str, Any]] = {}

        for resource_id, resource_info in resources.items():

            if not isinstance(resource_info, dict):
                resource_info = {}

            available = resource_info.get(
                "available",
                True,
            )

            demand = float(
                resource_info.get(
                    "demand",
                    0,
                )
            )

            capacity = float(
                resource_info.get(
                    "capacity",
                    1,
                )
            )

            capacity = max(
                capacity,
                1.0,
            )

            utilization = _clamp(
                demand / capacity,
                0.0,
                1.0,
            )

            allocation[resource_id] = {
                "allocated": bool(available),
                "efficiency": round(
                    1.0 - utilization * 0.5,
                    4,
                ),
                "utilization": round(
                    utilization,
                    4,
                ),
                "timestamp": datetime.now().isoformat(),
            }

        return allocation
