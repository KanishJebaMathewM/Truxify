"""Backend ML Route: Model #16 Cargo & Payload Multi-Load Optimiser.

Re-exports the core router from ml.routers.load_optimiser and provides
integration with the backend ML service.
"""

from ml.routers.load_optimiser import (
    router,
    LoadItem,
    LoadOptimiserInput,
    RouteStop,
    LoadCombination,
    LoadOptimiserOutput,
    solve_load_optimisation,
    sequence_stops,
    haversine_km,
)

__all__ = [
    "router",
    "LoadItem",
    "LoadOptimiserInput",
    "RouteStop",
    "LoadCombination",
    "LoadOptimiserOutput",
    "solve_load_optimisation",
    "sequence_stops",
    "haversine_km",
]
