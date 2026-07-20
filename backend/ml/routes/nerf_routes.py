from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import torch
import numpy as np
import base64
from PIL import Image
import io
from datetime import datetime
import logging

from nerf.model import NeRFNetwork, NeRFRenderer, NeRFTrainer
from nerf.camera import create_spiral_poses, create_orbital_poses

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
        raise HTTPException(status_code=500, detail=str(e))

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
        raise HTTPException(status_code=500, detail=str(e))

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
                'loss_history': results['losses']
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Training failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/save")
async def save_model(path: str = "models/nerf.pth"):
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
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/load")
async def load_model(path: str = "models/nerf.pth"):
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
        raise HTTPException(status_code=500, detail=str(e))

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
        raise HTTPException(status_code=500, detail=str(e))