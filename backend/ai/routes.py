from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import pandas as pd
import json
from datetime import datetime
import logging
from causal_inference import CausalInferenceService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/causal", tags=["Causal Inference"])

# Initialize service
causal_service = CausalInferenceService()

class AnalyzeRequest(BaseModel):
    data: List[Dict[str, Any]]
    target_metric: str

@router.post("/analyze")
async def analyze_causality(request: AnalyzeRequest):
    """Perform causal analysis on logistics data"""
    try:
        # Convert to DataFrame
        data = pd.DataFrame(request.data)
        
        if request.target_metric not in data.columns:
            return {
                'success': False,
                'error': f'Target metric "{request.target_metric}" not found in data'
            }
        
        # Analyze
        result = causal_service.analyze_logistics_data(data, request.target_metric)
        
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Analysis failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/discover-graph")
async def discover_causal_graph(file: UploadFile = File(...)):
    """Discover causal graph from uploaded data"""
    try:
        # Read file
        content = await file.read()
        data = pd.read_csv(io.BytesIO(content))
        
        # Discover graph
        graph = causal_service.causal_discovery.discover_causal_graph(data)
        
        return {
            'success': True,
            'data': {
                'nodes': list(graph.nodes()),
                'edges': list(graph.edges()),
                'edges_count': len(graph.edges()),
                'graph': nx.to_dict_of_lists(graph)
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Graph discovery failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/bottlenecks")
async def identify_bottlenecks(request: AnalyzeRequest):
    """Identify bottlenecks in logistics operations"""
    try:
        data = pd.DataFrame(request.data)
        metrics = [request.target_metric] if request.target_metric else list(data.columns)
        
        bottlenecks = causal_service.bottleneck_analyzer.identify_bottlenecks(data, metrics)
        
        return {
            'success': True,
            'data': {
                'bottlenecks': bottlenecks,
                'total_metrics': len(metrics)
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Bottleneck identification failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/impact")
async def measure_impact(
    pre_data: List[float],
    post_data: List[float],
    intervention_point: int
):
    """Measure causal impact of intervention"""
    try:
        pre_np = np.array(pre_data)
        post_np = np.array(post_data)
        
        impact = causal_service.causal_impact.measure_impact(
            pre_np, post_np, intervention_point
        )
        
        return {
            'success': True,
            'data': impact,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Impact measurement failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/status")
async def get_causal_status():
    """Get causal inference service status"""
    return {
        'status': 'healthy',
        'service': 'causal-inference',
        'version': '1.0.0',
        'components': {
            'causal_discovery': True,
            'do_calculus': True,
            'causal_impact': True,
            'bottleneck_analyzer': True
        },
        'timestamp': datetime.now().isoformat()
    }