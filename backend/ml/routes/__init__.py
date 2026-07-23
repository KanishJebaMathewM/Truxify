import importlib
import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from fastapi import FastAPI

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Registry of ML route modules to attempt loading.
# Each entry: (module_name, description)
#
# To add a new ML route module, simply append an entry here.  The
# registration function will attempt to import it and include its
# ``router`` attribute on the FastAPI application.
# ---------------------------------------------------------------------------
ML_ROUTE_MODULES: list[tuple[str, str]] = [
    ("ab_testing", "A/B Testing"),
    ("anomaly_routes", "Anomaly Detection"),
    ("diffusion_routes", "Diffusion Models"),
    ("federated_routes", "Federated Learning"),
    ("foundation_routes", "Foundation Model"),
    ("gat_routes", "Graph Attention Networks"),
    ("gnn_routes", "Graph Neural Networks"),
    ("imitation_routes", "Imitation Learning"),
    ("meta_routes", "Meta-Learning (MAML)"),
    ("mtl_routes", "Multi-Task Learning"),
    ("nas_routes", "Neural Architecture Search"),
    ("nerf_routes", "Neural Radiance Fields"),
    ("pinns_routes", "Physics-Informed Neural Networks"),
    ("safety_routes", "Driver Safety Monitoring"),
    ("ssl_routes", "Self-Supervised Learning"),
    ("transformer_routes", "Time Series Transformers"),
]

# Intentionally excluded:
# - "eta_routes": Duplicate of the /eta/* endpoints already defined inline
#   in main.py (predict_traffic_eta, update_eta_realtime, get_traffic_data,
#   get_traffic_forecast, train_traffic_model).


def register_ml_routers(app: "FastAPI") -> list[str]:
    """Dynamically import and register ML route modules on *app*.

    For every module listed in :data:`ML_ROUTE_MODULES` the function
    attempts a dynamic import.  If the import succeeds and the module
    exposes a ``router`` attribute, that router is included on the app.
    If the import fails due to a missing optional dependency the module
    is silently skipped and a warning is logged.

    Returns
    -------
    list[str]
        Names of the modules that were successfully registered.
    """
    registered: list[str] = []

    for module_name, description in ML_ROUTE_MODULES:
        try:
            module = importlib.import_module(f"routes.{module_name}")
        except ImportError as exc:
            logger.warning(
                "Skipping ML router '%s' (%s): optional dependency missing — %s",
                module_name, description, exc,
            )
            continue
        except Exception as exc:
            logger.error(
                "Unexpected error loading ML router '%s' (%s): %s",
                module_name, description, exc,
            )
            continue

        router = getattr(module, "router", None)
        if router is None:
            logger.warning(
                "Route module '%s' has no 'router' attribute — skipping",
                module_name,
            )
            continue

        try:
            app.include_router(router)
        except Exception as exc:
            logger.warning(
                "Skipping ML router '%s' (%s): failed to register routes — %s",
                module_name, description, exc,
            )
            continue

        registered.append(module_name)
        logger.info("Registered ML router: %s [%s]", description, module_name)

    return registered
