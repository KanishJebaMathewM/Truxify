"""
3D Bin-Packing and Axle Weight Distribution Engine for LTL Freight Bundling.
Framework: Python / FastAPI ML Service
"""

import logging
from typing import List, Dict, Any, Optional

logger = logging.getLogger("truxify.ml.bin_packing")

class Item:
    def __init__(self, item_id: str, length: float, width: float, height: float, weight: float):
        self.item_id = item_id
        self.length = length
        self.width = width
        self.height = height
        self.weight = weight
        self.position = None  # (x, y, z)
        self.rotation = 0

class Container:
    def __init__(self, length: float, width: float, height: float, max_weight: float):
        self.length = length
        self.width = width
        self.height = height
        self.max_weight = max_weight

class BinPackingEngine:
    """
    Combinatorial 3D bin-packing engine with volumetric and axle load verification.
    """
    
    def pack_cargo(self, container: Container, items: List[Item]) -> Dict[str, Any]:
        logger.info(f"Starting 3D bin packing for {len(items)} items in container {container.length}x{container.width}x{container.height}")
        
        sorted_items = sorted(items, key=lambda i: i.length * i.width * i.height, reverse=True)
        
        packed_items = []
        unpacked_items = []
        current_weight = 0.0
        used_volume = 0.0
        container_volume = container.length * container.width * container.height
        
        current_x, current_y, current_z = 0.0, 0.0, 0.0
        max_row_height = 0.0
        
        for item in sorted_items:
            # Check weight limit
            if current_weight + item.weight > container.max_weight:
                unpacked_items.append(item.item_id)
                continue
                
            # Check volumetric bounds (simplified First-Fit Decreasing heuristic)
            if current_x + item.length <= container.length and \
               current_y + item.width <= container.width and \
               current_z + item.height <= container.height:
                
                item.position = (current_x, current_y, current_z)
                packed_items.append(item)
                current_weight += item.weight
                used_volume += (item.length * item.width * item.height)
                
                max_row_height = max(max_row_height, item.height)
                current_x += item.length
            else:
                unpacked_items.append(item.item_id)

        utilization_percentage = round((used_volume / container_volume) * 100, 2)
        axle_distribution = self._calculate_axle_distribution(packed_items, container.length)

        logger.info(f"Bin packing completed. Utilization: {utilization_percentage}%, Packed: {len(packed_items)}")

        return {
            "success": len(unpacked_items) == 0,
            "utilization_percentage": utilization_percentage,
            "total_weight": current_weight,
            "axle_weight_distribution": axle_distribution,
            "packed_items": [i.item_id for i in packed_items],
            "unpacked_items": unpacked_items,
        }

    def _calculate_axle_distribution(self, packed_items: List[Item], container_length: float) -> Dict[str, float]:
        front_weight = 0.0
        rear_weight = 0.0
        midpoint = container_length / 2.0

        for item in packed_items:
            if item.position:
                x_pos = item.position[0]
                if x_pos < midpoint:
                    front_weight += item.weight
                else:
                    rear_weight += item.weight

        return {
            "front_axle_kg": round(front_weight, 2),
            "rear_axle_kg": round(rear_weight, 2),
            "balanced": abs(front_weight - rear_weight) <= (front_weight + rear_weight) * 0.3
        }

    def evaluate_corridor_arbitrage(self, return_route_vector: Dict[str, float], available_consignments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Scans and aggregates small consignments along the driver's homeward vector with minimal route deviation.
        """
        bundling_recommendations = []
        for consignment in available_consignments:
            deviation_km = consignment.get("route_deviation_km", 999.0)
            if deviation_km <= 15.0:  # Maximum 15km detour threshold
                bundling_recommendations.append({
                    "consignment_id": consignment["id"],
                    "deviation_km": deviation_km,
                    "freight_revenue": consignment["revenue"],
                    "recommended": True
                })
        
        logger.info(f"Evaluated {len(available_consignments)} consignments; recommended {len(bundling_recommendations)} for return-trip bundling.")
        return bundling_recommendations
