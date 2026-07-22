from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime
import logging
from quantum_service import QuantumService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/quantum", tags=["Quantum Computing"])

quantum_service = QuantumService()

class CircuitRequest(BaseModel):
    circuit_type: str = 'basic'
    num_qubits: int = 10

class RouteRequest(BaseModel):
    nodes: List[Dict[str, Any]]
    edges: List[Dict[str, Any]]

class QAOARequest(BaseModel):
    reps: int = 1
    num_qubits: int = 10

@router.post("/circuit/create")
async def create_circuit(request: CircuitRequest):
    """Create and run quantum circuit"""
    try:
        result = quantum_service.create_quantum_circuit(
            request.circuit_type,
            request.num_qubits
        )
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Circuit creation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/route/optimize")
async def optimize_route(request: RouteRequest):
    """Optimize route using quantum computing"""
    try:
        result = quantum_service.solve_route_optimization(
            request.nodes,
            request.edges
        )
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Route optimization failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/qaoa/run")
async def run_qaoa():
    """Run QAOA optimization"""
    try:
        result = quantum_service.run_qaoa()
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"QAOA run failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/hybrid/optimize")
async def hybrid_optimize(problem: Dict):
    """Run hybrid classical-quantum optimization"""
    try:
        result = quantum_service.hybrid_optimize(problem)
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Hybrid optimization failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/stats")
async def get_quantum_stats():
    """Get quantum service statistics"""
    try:
        stats = quantum_service.get_stats()
        return {
            'success': True,
            'data': stats,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Stats failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))