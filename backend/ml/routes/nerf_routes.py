import base64
import io
import logging
import os
from datetime import datetime
from typing import Annotated, List

import numpy as np
import torch
import torch.nn.functional as F
from fastapi import APIRouter, HTTPException
from nerf.camera import create_orbital_poses, create_spiral_poses
from nerf.model import NeRFNetwork, NeRFRenderer, NeRFTrainer
from nerf.ray_training import RayAdmissionError, policy
from PIL import Image
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/nerf", tags=["Neural Radiance Fields"])

# Initialize model
model = NeRFNetwork()
renderer = NeRFRenderer(model)
trainer = NeRFTrainer(model)

class RenderRequest(BaseModel):
    num_poses: int = 30
    radius: float = 2.0
    height: float = 1.0
    image_size: List[int] = [256, 256]

@router.post("/render/spiral")
async def render_spiral(request: RenderRequest):
    """Render spiral video of scene"""
    try:
        # Create spiral poses
        poses = create_spiral_poses(
            request.num_poses,
            request.radius,
            request.height
        )
        
        # Render frames
        frames = []
        for pose in poses:
            rays = pose.get_rays(60, tuple(request.image_size))
            rays_tensor = {
                'origins': torch.tensor(rays['origins'], dtype=torch.float32),
                'directions': torch.tensor(rays['directions'], dtype=torch.float32)
            }
            
            frame = renderer.render_image(rays_tensor, tuple(request.image_size))
            
            # Convert to image
            rgb = frame['rgb'].cpu().numpy()
            rgb = (rgb * 255).astype(np.uint8)
            
            # Convert to base64
            img = Image.fromarray(rgb)
            buffer = io.BytesIO()
            img.save(buffer, format='JPEG')
            img_base64 = base64.b64encode(buffer.getvalue()).decode()
            
            frames.append({
                'image': img_base64,
                'depth': frame['depth'].cpu().numpy().tolist()
            })
        
        return {
            'success': True,
            'data': {
                'frames': frames,
                'count': len(frames)
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Spiral render failed: {e}")
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/render/orbital")
async def render_orbital(request: RenderRequest):
    """Render orbital video of scene"""
    try:
        poses = create_orbital_poses(request.num_poses, request.radius)
        
        frames = []
        for pose in poses:
            rays = pose.get_rays(60, tuple(request.image_size))
            rays_tensor = {
                'origins': torch.tensor(rays['origins'], dtype=torch.float32),
                'directions': torch.tensor(rays['directions'], dtype=torch.float32)
            }
            
            frame = renderer.render_image(rays_tensor, tuple(request.image_size))
            
            rgb = frame['rgb'].cpu().numpy()
            rgb = (rgb * 255).astype(np.uint8)
            
            img = Image.fromarray(rgb)
            buffer = io.BytesIO()
            img.save(buffer, format='JPEG')
            img_base64 = base64.b64encode(buffer.getvalue()).decode()
            
            frames.append({
                'image': img_base64,
                'depth': frame['depth'].cpu().numpy().tolist()
            })
        
        return {
            'success': True,
            'data': {
                'frames': frames,
                'count': len(frames)
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Orbital render failed: {e}")
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

RayVector = Annotated[List[float], Field(min_length=3, max_length=3)]


class RayTrainingRequest(BaseModel):
    origins: List[RayVector] = Field(min_length=1, max_length=10000)
    directions: List[RayVector] = Field(min_length=1, max_length=10000)
    rgb: List[RayVector] = Field(min_length=1, max_length=10000)
    epochs: int = Field(default=100, strict=True, ge=1, le=100)
    batch_size: int = Field(default=256, strict=True, ge=1, le=4096)
    num_samples: int = Field(default=64, strict=True, ge=2, le=256)
    near: float = 0.1
    far: float = 10.0


@router.post('/train/rays')
async def train_observed_rays(request: RayTrainingRequest):
    """Fit explicit observed ray RGB, without inventing target scene telemetry."""
    try:
        policy(len(request.origins), request.epochs, request.batch_size,
               request.num_samples, request.near, request.far)
        parameter = next(trainer.model.parameters())
        try:
            ray_data = {name: torch.tensor(getattr(request, name), dtype=parameter.dtype,
                                          device=parameter.device)
                        for name in ('origins', 'directions', 'rgb')}
        except (ValueError, TypeError, RuntimeError) as exc:
            raise RayAdmissionError('ray observations require rectangular numeric rows') from exc
        result = trainer.train_rays(ray_data, request.epochs, request.batch_size,
                                    request.num_samples, request.near, request.far)
        return {'success': True, 'data': result, 'timestamp': datetime.now().isoformat()}
    except RayAdmissionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        logger.error('Native ray fitting failed: %s', exc)
        raise HTTPException(status_code=500, detail='Internal server error') from exc


@router.post("/train")
async def train_nerf(
    epochs: int = 100,
    batch_size: int = 4096,
    learning_rate: float = 5e-4
):
    """Train NeRF model"""
    try:
        # Generate synthetic training data
        num_points = 10000
        
        # Random points in 3D
        points = torch.randn(num_points, 3) * 2
        
        # Random directions
        directions = F.normalize(torch.randn(num_points, 3), dim=-1)
        
        # Target RGB values
        rgb = torch.sigmoid(torch.randn(num_points, 3))
        
        train_data = {
            'points': points,
            'directions': directions,
            'rgb': rgb
        }
        
        trainer.optimizer.param_groups[0]['lr'] = learning_rate
        results = trainer.train(train_data, epochs, batch_size)
        
        return {
            'success': True,
            'data': {
                'final_loss': results['final_loss'],
                'epochs': epochs,
                'loss_history': results['losses'],
                'objective': results['objective'],
                'density_gradient_path': results['density_gradient_path']
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Training failed: {e}")
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/save")
async def save_model(path: str = "models/nerf.pth"):
    path = os.path.join("models", os.path.basename(path))
    """Save NeRF model"""
    try:
        trainer.save(path)
        return {
            'success': True,
            'message': f'Model saved to {path}',
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Save failed: {e}")
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/load")
async def load_model(path: str = "models/nerf.pth"):
    path = os.path.join("models", os.path.basename(path))
    """Load NeRF model"""
    try:
        trainer.load(path)
        return {
            'success': True,
            'message': f'Model loaded from {path}',
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Load failed: {e}")
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/model-info")
async def get_model_info():
    """Get model information"""
    try:
        return {
            'success': True,
            'data': {
                'parameters': sum(p.numel() for p in model.parameters()),
                'trainable': sum(p.numel() for p in model.parameters() if p.requires_grad),
                'num_frequencies': model.num_frequencies,
                'num_dir_frequencies': model.num_dir_frequencies,
                'device': str(renderer.device)
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Model info failed: {e}")
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")