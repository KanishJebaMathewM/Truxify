from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import json
from datetime import datetime
import logging
from nas.model import NASSearchSpace, NASModel, NASSearcher

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/nas", tags=["Neural Architecture Search"])

# Initialize NAS
search_space = NASSearchSpace()
searcher = NASSearcher(search_space)

class SearchRequest(BaseModel):
    method: str = 'random'  # random, evolutionary
    num_trials: int = 100
    population_size: int = 20
    generations: int = 10

@router.post("/search")
async def search_architecture(request: SearchRequest):
    """Search for optimal architecture"""
    try:
        if request.method == 'random':
            result = searcher.random_search(request.num_trials)
        elif request.method == 'evolutionary':
            result = searcher.evolutionary_search(
                request.population_size,
                request.generations
            )
        else:
            return {
                'success': False,
                'error': 'Invalid method. Choose random or evolutionary'
            }
        
        return {
            'success': True,
            'data': {
                'best_architecture': result['best_architecture'],
                'best_score': result['best_score'],
                'method': result['method'],
                'history': result['history'][-10:]  # Last 10 entries
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Search failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/build-model")
async def build_model(architecture: Dict):
    """Build model from architecture"""
    try:
        model = NASModel(architecture)
        
        return {
            'success': True,
            'data': {
                'architecture': architecture,
                'parameters': model.get_params(),
                'flops': model.get_flops(),
                'layers': len(architecture['layers'])
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Model building failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/sample")
async def sample_architecture():
    """Sample random architecture from search space"""
    try:
        arch = search_space.sample_random_architecture()
        
        return {
            'success': True,
            'data': arch,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Sampling failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/encode")
async def encode_architecture(architecture: Dict):
    """Encode architecture to string"""
    try:
        encoding = search_space.encode_architecture(architecture)
        
        return {
            'success': True,
            'data': {
                'encoding': encoding,
                'architecture': architecture
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Encoding failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/decode")
async def decode_architecture(encoding: str):
    """Decode architecture from string"""
    try:
        architecture = search_space.decode_architecture(encoding)
        
        return {
            'success': True,
            'data': {
                'architecture': architecture,
                'encoding': encoding
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Decoding failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/search-space")
async def get_search_space():
    """Get search space information"""
    try:
        return {
            'success': True,
            'data': {
                'operations': search_space.operations,
                'num_layers_range': search_space.num_layers_range,
                'num_filters_range': search_space.num_filters_range,
                'activation_functions': search_space.activation_functions,
                'total_combinations': len(search_space.operations) * \
                    (search_space.num_layers_range[1] - search_space.num_layers_range[0]) * \
                    (search_space.num_filters_range[1] - search_space.num_filters_range[0]) * \
                    len(search_space.activation_functions)
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Search space fetch failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/history")
async def get_search_history():
    """Get search history"""
    try:
        return {
            'success': True,
            'data': {
                'history': searcher.search_history[-20:],  # Last 20
                'total_trials': len(searcher.search_history),
                'best_architecture': searcher.best_architecture,
                'best_performance': searcher.best_performance
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"History fetch failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))