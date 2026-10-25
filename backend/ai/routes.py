from datetime import datetime, timezone
from io import BytesIO
from typing import Any, Dict, List, NoReturn
import logging

import networkx as nx
import numpy as np
import pandas as pd
from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from causal_inference import CausalInferenceService


# ---------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------

router = APIRouter(
    prefix="/causal",
    tags=["Causal Inference"],
)


# ---------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------

MAX_CSV_SIZE = 10 * 1024 * 1024  # 10 MB
API_VERSION = "1.0.0"


# ---------------------------------------------------------------------
# Initialize Service
# ---------------------------------------------------------------------

causal_service = CausalInferenceService()


# ---------------------------------------------------------------------
# Request Models
# ---------------------------------------------------------------------

class AnalyzeRequest(BaseModel):
    data: List[Dict[str, Any]] = Field(
        ...,
        min_length=1,
        description="Tabular logistics data",
    )

    target_metric: str = Field(
        ...,
        min_length=1,
        description="Metric to analyze",
    )


class ImpactRequest(BaseModel):
    pre_data: List[float] = Field(
        ...,
        min_length=1,
        description="Observations before intervention",
    )

    post_data: List[float] = Field(
        ...,
        min_length=1,
        description="Observations after intervention",
    )

    intervention_point: int = Field(
        ...,
        ge=0,
        description="Intervention index",
    )


# ---------------------------------------------------------------------
# Response Helpers
# ---------------------------------------------------------------------

def timestamp() -> str:
    """
    Return a timezone-aware UTC timestamp.
    """
    return datetime.now(timezone.utc).isoformat()


def success_response(data: Any) -> Dict[str, Any]:
    """
    Return a consistent successful API response.
    """
    return {
        "success": True,
        "data": data,
        "timestamp": timestamp(),
    }


def error_response(
    message: str,
    status_code: int = 400,
) -> NoReturn:
    """
    Raise a consistent API error.
    """
    raise HTTPException(
        status_code=status_code,
        detail={
            "success": False,
            "error": message,
            "timestamp": timestamp(),
        },
    )


def handle_exception(
    message: str,
    exc: Exception,
) -> NoReturn:
    """
    Log unexpected exceptions and return a safe API error.
    """
    logger.exception(
        "%s: %s",
        message,
        exc,
    )

    raise HTTPException(
        status_code=500,
        detail={
            "success": False,
            "error": message,
            "timestamp": timestamp(),
        },
    )


# ---------------------------------------------------------------------
# Validation Helpers
# ---------------------------------------------------------------------

def dataframe_from_request(
    request: AnalyzeRequest,
) -> pd.DataFrame:
    """
    Convert request data into a validated DataFrame.
    """

    if not request.data:
        error_response(
            "Input data cannot be empty.",
            422,
        )

    target_metric = request.target_metric.strip()

    if not target_metric:
        error_response(
            "Target metric cannot be empty.",
            422,
        )

    dataframe = pd.DataFrame(request.data)

    if dataframe.empty:
        error_response(
            "Input data produced an empty dataframe.",
            422,
        )

    # Normalize column names.
    dataframe.columns = [
        str(column).strip()
        for column in dataframe.columns
    ]

    if target_metric not in dataframe.columns:
        error_response(
            f'Target metric "{target_metric}" not found in data.',
            422,
        )

    return dataframe


def validate_numeric_array(
    values: List[float],
    field_name: str,
) -> np.ndarray:
    """
    Convert input values into a finite NumPy array.
    """

    if not values:
        error_response(
            f"{field_name} cannot be empty.",
            422,
        )

    try:
        array = np.asarray(
            values,
            dtype=float,
        )
    except (TypeError, ValueError):
        error_response(
            f"{field_name} must contain only numeric values.",
            422,
        )

    if not np.all(np.isfinite(array)):
        error_response(
            f"{field_name} contains NaN or infinite values.",
            422,
        )

    return array


# ---------------------------------------------------------------------
# Analyze
# ---------------------------------------------------------------------

@router.post("/analyze")
def analyze_causality(
    request: AnalyzeRequest,
):
    """
    Perform causal analysis on logistics data.
    """

    try:
        dataframe = dataframe_from_request(request)

        target_metric = request.target_metric.strip()

        logger.info(
            "Starting causal analysis: rows=%d columns=%d target=%s",
            len(dataframe),
            len(dataframe.columns),
            target_metric,
        )

        result = causal_service.analyze_logistics_data(
            dataframe,
            target_metric,
        )

        logger.info(
            "Causal analysis completed successfully: target=%s",
            target_metric,
        )

        return success_response(result)

    except HTTPException:
        raise

    except Exception as exc:
        handle_exception(
            "Causal analysis failed.",
            exc,
        )


# ---------------------------------------------------------------------
# Graph Discovery
# ---------------------------------------------------------------------

@router.post("/discover-graph")
async def discover_causal_graph(
    file: UploadFile = File(...),
):
    """
    Discover a causal graph from an uploaded CSV file.
    """

    try:
        # -------------------------------------------------------------
        # File validation
        # -------------------------------------------------------------

        if not file.filename:
            error_response(
                "A CSV file is required.",
                422,
            )

        if not file.filename.lower().endswith(".csv"):
            error_response(
                "Only CSV files are supported.",
                415,
            )

        content = await file.read()

        if not content:
            error_response(
                "Uploaded file is empty.",
                422,
            )

        if len(content) > MAX_CSV_SIZE:
            error_response(
                "CSV file exceeds the 10 MB size limit.",
                413,
            )

        logger.info(
            "Starting causal graph discovery: file=%s size=%d bytes",
            file.filename,
            len(content),
        )

        # -------------------------------------------------------------
        # Read CSV
        # -------------------------------------------------------------

        dataframe = pd.read_csv(
            BytesIO(content)
        )

        if dataframe.empty:
            error_response(
                "CSV file contains no data.",
                422,
            )

        # Normalize column names.
        dataframe.columns = [
            str(column).strip()
            for column in dataframe.columns
        ]

        # -------------------------------------------------------------
        # Discover causal graph
        # -------------------------------------------------------------

        graph = (
            causal_service
            .causal_discovery
            .discover_causal_graph(
                dataframe
            )
        )

        if graph is None:
            raise RuntimeError(
                "Causal discovery returned no graph."
            )

        # -------------------------------------------------------------
        # Convert graph to JSON-friendly format
        # -------------------------------------------------------------

        nodes = list(graph.nodes())

        edges = [
            {
                "source": source,
                "target": target,
            }
            for source, target in graph.edges()
        ]

        result = {
            "nodes": nodes,
            "edges": edges,
            "nodes_count": len(nodes),
            "edges_count": len(edges),
            "graph": nx.to_dict_of_lists(graph),
        }

        logger.info(
            "Graph discovery completed: nodes=%d edges=%d",
            len(nodes),
            len(edges),
        )

        return success_response(result)

    except HTTPException:
        raise

    except pd.errors.EmptyDataError:
        error_response(
            "The uploaded CSV contains no readable data.",
            422,
        )

    except pd.errors.ParserError as exc:
        logger.warning(
            "CSV parsing failed for file=%s: %s",
            file.filename,
            exc,
        )

        error_response(
            "The uploaded file is not a valid CSV.",
            422,
        )

    except UnicodeDecodeError:
        error_response(
            "The CSV file encoding could not be read.",
            422,
        )

    except Exception as exc:
        handle_exception(
            "Graph discovery failed.",
            exc,
        )


# ---------------------------------------------------------------------
# Bottleneck Analysis
# ---------------------------------------------------------------------

@router.post("/bottlenecks")
def identify_bottlenecks(
    request: AnalyzeRequest,
):
    """
    Identify logistics bottlenecks for the requested metric.
    """

    try:
        dataframe = dataframe_from_request(request)

        target_metric = request.target_metric.strip()

        metrics = [
            target_metric
        ]

        logger.info(
            "Starting bottleneck analysis: target=%s",
            target_metric,
        )

        bottlenecks = (
            causal_service
            .bottleneck_analyzer
            .identify_bottlenecks(
                dataframe,
                metrics,
            )
        )

        logger.info(
            "Bottleneck analysis completed: target=%s",
            target_metric,
        )

        return success_response(
            {
                "bottlenecks": bottlenecks,
                "total_metrics": len(metrics),
            }
        )

    except HTTPException:
        raise

    except Exception as exc:
        handle_exception(
            "Bottleneck identification failed.",
            exc,
        )


# ---------------------------------------------------------------------
# Causal Impact
# ---------------------------------------------------------------------

@router.post("/impact")
def measure_impact(
    request: ImpactRequest,
):
    """
    Measure causal impact of an intervention.
    """

    try:
        pre_np = validate_numeric_array(
            request.pre_data,
            "pre_data",
        )

        post_np = validate_numeric_array(
            request.post_data,
            "post_data",
        )

        # -------------------------------------------------------------
        # Validate intervention point
        #
        # The service receives pre_data and post_data separately.
        # Therefore the intervention index must refer to an available
        # observation in the combined timeline.
        # -------------------------------------------------------------

        total_observations = (
            len(pre_np) + len(post_np)
        )

        if request.intervention_point >= total_observations:
            error_response(
                "intervention_point exceeds the available observations.",
                422,
            )

        logger.info(
            "Starting causal impact analysis: "
            "pre=%d post=%d intervention=%d",
            len(pre_np),
            len(post_np),
            request.intervention_point,
        )

        impact = (
            causal_service
            .causal_impact
            .measure_impact(
                pre_np,
                post_np,
                request.intervention_point,
            )
        )

        logger.info(
            "Causal impact analysis completed successfully."
        )

        return success_response(impact)

    except HTTPException:
        raise

    except Exception as exc:
        handle_exception(
            "Impact measurement failed.",
            exc,
        )


# ---------------------------------------------------------------------
# Service Status
# ---------------------------------------------------------------------

@router.get("/status")
def get_causal_status():
    """
    Get causal inference service status.
    """

    try:
        components = {
            "causal_discovery": hasattr(
                causal_service,
                "causal_discovery",
            ),
            "do_calculus": hasattr(
                causal_service,
                "do_calculus",
            ),
            "causal_impact": hasattr(
                causal_service,
                "causal_impact",
            ),
            "bottleneck_analyzer": hasattr(
                causal_service,
                "bottleneck_analyzer",
            ),
        }

        healthy = all(
            components.values()
        )

        status = {
            "status": (
                "healthy"
                if healthy
                else "degraded"
            ),
            "service": "causal-inference",
            "version": API_VERSION,
            "components": components,
        }

        return success_response(status)

    except Exception as exc:
        handle_exception(
            "Status retrieval failed.",
            exc,
        )
