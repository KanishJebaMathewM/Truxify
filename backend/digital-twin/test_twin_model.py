```python
from dataclasses import dataclass
from datetime import datetime
from typing import Dict, List, Any


@dataclass
class DigitalTwin:
    assets: Dict[str, Any] = None

    def __post_init__(self):
        if self.assets is None:
            self.assets = {}


@dataclass
class LogisticsEvent:
    id: str
    type: str
    timestamp: datetime
    asset_id: str
    location: Dict[str, float]


class SimulationEngine:

    def __init__(self, digital_twin: DigitalTwin):
        self.digital_twin = digital_twin

    def _calculate_metrics(
        self,
        events: List[LogisticsEvent],
        data: Dict[str, Any]
    ) -> Dict[str, Any]:

        if not events:
            return {
                "utilization": 0.0,
                "efficiency": 0.0,
                "event_types": {}
            }

        events = sorted(events, key=lambda e: e.timestamp)

        # Count event types
        event_types = {}

        for event in events:
            event_types[event.type] = event_types.get(event.type, 0) + 1

        # ---------------------------------------------------------
        # UTILIZATION
        # ---------------------------------------------------------
        start_time = events[0].timestamp
        end_time = events[-1].timestamp

        total_window = (end_time - start_time).total_seconds()

        if total_window <= 0:
            utilization = 0.0
        else:
            asset_events = {}

            for event in events:
                asset_events.setdefault(event.asset_id, []).append(event)

            total_busy_time = 0.0
            asset_count = len(asset_events)

            for asset_id, asset_event_list in asset_events.items():

                asset_event_list.sort(key=lambda e: e.timestamp)

                busy_start = None

                for event in asset_event_list:

                    if event.type == "pickup":
                        if busy_start is None:
                            busy_start = event.timestamp

                    elif event.type == "dropoff":
                        if busy_start is not None:
                            busy_time = (
                                event.timestamp - busy_start
                            ).total_seconds()

                            if busy_time > 0:
                                total_busy_time += busy_time

                            busy_start = None

            total_available_time = total_window * asset_count

            if total_available_time > 0:
                utilization = (
                    total_busy_time / total_available_time
                )
            else:
                utilization = 0.0

            utilization = max(0.0, min(1.0, utilization))

        # ---------------------------------------------------------
        # EFFICIENCY
        # ---------------------------------------------------------
        total_events = len(events)
        delay_events = event_types.get("delay", 0)

        if total_events == 0:
            efficiency = 0.0
        else:
            efficiency = (
                total_events - delay_events
            ) / total_events

        efficiency = max(0.0, min(1.0, efficiency))

        return {
            "utilization": utilization,
            "efficiency": efficiency,
            "event_types": event_types
        }

    def _generate_recommendations(
        self,
        metrics: Dict[str, Any]
    ) -> List[str]:

        utilization = metrics.get("utilization", 0.0)
        efficiency = metrics.get("efficiency", 0.0)

        recommendations = []

        if utilization < 0.5:
            recommendations.append(
                "Increase asset utilization by optimizing routes"
            )

        if efficiency < 0.5:
            recommendations.append(
                "Improve operational efficiency by reducing delays"
            )

        if not recommendations:
            recommendations.append(
                "Current operations are running smoothly"
            )

        return recommendations

    def simulate(
        self,
        events: List[LogisticsEvent],
        data: Dict[str, Any] = None
    ) -> Dict[str, Any]:

        if data is None:
            data = {}

        metrics = self._calculate_metrics(events, data)

        recommendations = self._generate_recommendations(metrics)

        return {
            "metrics": metrics,
            "recommendations": recommendations
        }
```

### Why this fixes the bug

The important correction is this calculation:

```python
total_available_time = total_window * asset_count

utilization = total_busy_time / total_available_time
```

For your second test:

```text
Time window = 110 seconds
Assets = 2
Available time = 110 × 2 = 220 seconds

Truck 1 busy = 10 seconds
Truck 2 busy = 10 seconds

Total busy = 20 seconds

Utilization = 20 / 220
             = 0.0909
```

So:

```python
self.assertAlmostEqual(
    metrics["utilization"],
    20.0 / 220.0,
    places=4
)
```

passes.

It also handles the edge case:

```python
events = [pickup]
```

where the time window is zero, so:

```python
utilization = 0.0
```

And for no events:

```python
utilization = 0.0
efficiency = 0.0
```

### Run the tests

Put the code above in:

```text
twin_model.py
```

Keep your test file alongside it, then run:

```bash
python -m unittest -v
```

You should get **9 tests passing**.
