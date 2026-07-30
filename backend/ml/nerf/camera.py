import torch
import numpy as np
from typing import Dict, Tuple, List
import cv2

class CameraPose:
    """Camera pose for NeRF rendering"""
    
    def __init__(
        self,
        position: np.ndarray,
        look_at: np.ndarray,
        up: np.ndarray = np.array([0, -1, 0])
    ):
        self.position = position
        self.look_at = look_at
        self.up = up
        
        # Compute camera matrix
        self._compute_camera_matrix()
    
    def _compute_camera_matrix(self):
        """Compute camera matrix from pose"""
        z_axis = self.look_at - self.position
        z_axis = z_axis / np.linalg.norm(z_axis)
        
        x_axis = np.cross(self.up, z_axis)
        x_axis = x_axis / np.linalg.norm(x_axis)
        
        y_axis = np.cross(z_axis, x_axis)
        
        self.rotation = np.array([x_axis, y_axis, z_axis])
        self.translation = self.position
    
    def get_ray_directions(self, fov: float, image_size: Tuple[int, int]) -> np.ndarray:
        """Get ray directions for camera"""
        h, w = image_size
        fov_rad = np.radians(fov)
        
        # Compute focal length
        f = 0.5 * w / np.tan(fov_rad / 2)
        
        # Pixel positions
        x = np.linspace(-w/2, w/2, w) / f
        y = np.linspace(-h/2, h/2, h) / f
        
        xx, yy = np.meshgrid(x, y)
        
        # Directions in camera space
        directions = np.stack([xx, yy, -np.ones_like(xx)], axis=-1)
        directions = directions / np.linalg.norm(directions, axis=-1, keepdims=True)
        
        # Transform to world space
        directions = (directions @ self.rotation.T)
        
        return directions
    
    def get_rays(self, fov: float, image_size: Tuple[int, int]) -> Dict:
        """Get all rays for camera"""
        directions = self.get_ray_directions(fov, image_size)
        
        # Origins are camera position
        origins = np.full_like(directions, self.position)
        
        return {
            'origins': origins.reshape(-1, 3),
            'directions': directions.reshape(-1, 3),
            'camera_matrix': self.rotation,
            'position': self.position
        }

def create_spiral_poses(
    num_poses: int = 30,
    radius: float = 2.0,
    height: float = 1.0,
    center: np.ndarray = np.array([0, 0, 0])
) -> List[CameraPose]:
    """Create spiral camera poses"""
    poses = []
    
    for i in range(num_poses):
        theta = 2 * np.pi * i / num_poses
        
        # Spiral position
        x = center[0] + radius * np.cos(theta)
        z = center[2] + radius * np.sin(theta)
        y = center[1] + height * (i / num_poses - 0.5)
        
        position = np.array([x, y, z])
        look_at = center
        
        pose = CameraPose(position, look_at)
        poses.append(pose)
    
    return poses

def create_orbital_poses(
    num_poses: int = 30,
    radius: float = 2.0,
    center: np.ndarray = np.array([0, 0, 0])
) -> List[CameraPose]:
    """Create orbital camera poses"""
    poses = []
    
    for i in range(num_poses):
        theta = 2 * np.pi * i / num_poses
        
        position = np.array([
            center[0] + radius * np.cos(theta),
            center[1],
            center[2] + radius * np.sin(theta)
        ])
        
        pose = CameraPose(position, center)
        poses.append(pose)
    
    return poses

def create_frontal_poses(
    num_poses: int = 10,
    radius: float = 2.0,
    center: np.ndarray = np.array([0, 0, 0])
) -> List[CameraPose]:
    """Create frontal camera poses"""
    poses = []
    
    for i in range(num_poses):
        x = center[0] + radius * (i / num_poses - 0.5)
        position = np.array([x, center[1], center[2] + radius])
        
        pose = CameraPose(position, center)
        poses.append(pose)
    
    return poses