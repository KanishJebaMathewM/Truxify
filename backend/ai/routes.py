from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel
from typing import List, Dict, Any
from datetime import datetime
import logging
import io

import networkx as nx
import numpy as np
import pandas as pd

from causal_inference import CausalInferenceService

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/causal",
    tags=["Causal Inference"],
)

# ---------------------------------------------------------------------
# Initialize Service
# ---------------------------------------------------------------------

causal_service = CausalInferenceService()

# ---------------------------------------------------------------------
# Request Models
# ---------------------------------------------------------------------

class AnalyzeRequest(BaseModel):
    data: List[Dict[str, Any]]
    target_metric: str


class ImpactRequest(BaseModel):
    pre_data: List[float]
    post_data: List[float]
    intervention_point: int


# ---------------------------------------------------------------------
# Response Helpers
# ---------------------------------------------------------------------

def success_response(data: Any) -> Dict[str, Any]:
    return {
        "success": True,
        "data": data,
        "timestamp": datetime.now().isoformat(),
    }


def error_response(message: str) -> Dict[str, Any]:
    return {
        "success": False,
        "error": message,
        "timestamp": datetime.now().isoformat(),
    }


def handle_exception(message: str, exc: Exception) -> None:
    logger.exception("%s: %s", message, exc)
    raise HTTPException(status_code=500, detail=str(exc))


# ---------------------------------------------------------------------
# Analyze
# ---------------------------------------------------------------------

@router.post("/analyze")
async def analyze_causality(request: AnalyzeRequest):
    """Perform causal analysis on logistics data."""
    try:
        dataframe = pd.DataFrame(request.data)

        if request.target_metric not in dataframe.columns:
            return error_response(
                f'Target metric "{request.target_metric}" not found in data'
            )

        result = causal_service.analyze_logistics_data(
            dataframe,
            request.target_metric,
        )

        return success_response(result)

    except Exception as exc:
        handle_exception("Causal analysis failed", exc)


# ---------------------------------------------------------------------
# Graph Discovery
# ---------------------------------------------------------------------

@router.post("/discover-graph")
async def discover_causal_graph(
    file: UploadFile = File(...)
):
    """Discover causal graph from uploaded CSV."""
    try:
        content = await file.read()

        dataframe = pd.read_csv(
            io.BytesIO(content)
        )

        graph = (
            causal_service
            .causal_discovery
            .discover_causal_graph(dataframe)
        )

        return success_response(
            {
                "nodes": list(graph.nodes()),
                "edges": list(graph.edges()),
                "edges_count": len(graph.edges()),
                "graph": nx.to_dict_of_lists(graph),
            }
        )

    except Exception as exc:
        handle_exception("Graph discovery failed", exc)




# ---------------------------------------------------------------------
# Bottleneck Analysis
# ---------------------------------------------------------------------

@router.post("/bottlenecks")
async def identify_bottlenecks(request: AnalyzeRequest):
    """Identify logistics bottlenecks."""
    try:
        dataframe = pd.DataFrame(request.data)

        metrics = (
            [request.target_metric]
            if request.target_metric
            else list(dataframe.columns)
        )

        bottlenecks = (
            causal_service
            .bottleneck_analyzer
            .identify_bottlenecks(
                dataframe,
                metrics,
            )
        )

        return success_response(
            {
                "bottlenecks": bottlenecks,
                "total_metrics": len(metrics),
            }
        )

    except Exception as exc:
        handle_exception(
            "Bottleneck identification failed",
            exc,
        )


# ---------------------------------------------------------------------
# Causal Impact
# ---------------------------------------------------------------------

@router.post("/impact")
async def measure_impact(request: ImpactRequest):
    """Measure causal impact of an intervention."""
    try:
        pre_np = np.array(request.pre_data)
        post_np = np.array(request.post_data)

        impact = (
            causal_service
            .causal_impact
            .measure_impact(
                pre_np,
                post_np,
                request.intervention_point,
            )
        )

        return success_response(impact)

    except Exception as exc:
        handle_exception(
            "Impact measurement failed",
            exc,
        )


# ---------------------------------------------------------------------
# Service Status
# ---------------------------------------------------------------------

@router.get("/status")
async def get_causal_status():
    """Get causal inference service status."""
    try:
        status = {
            "status": "healthy",
            "service": "causal-inference",
            "version": "1.0.0",
            "components": {
                "causal_discovery": True,
                "do_calculus": True,
                "causal_impact": True,
                "bottleneck_analyzer": True,
            },
        }

        return success_response(status)

    except Exception as exc:
        handle_exception(
            "Status retrieval failed",
            exc,
        )