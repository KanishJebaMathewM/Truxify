"""
3D Bin-Packing and Axle Weight Distribution Engine for LTL Freight Bundling.
Framework: Python / FastAPI ML Service
"""

import logging
import math
from itertools import permutations
from numbers import Real
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
        self.placed_dimensions = None

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
    
    @staticmethod
    def _finite(value, *, positive=False):
        if isinstance(value, bool) or not isinstance(value, Real):
            raise ValueError("geometry and weights must be real numbers")
        try:
            result = float(value)
        except (OverflowError, ValueError):
            raise ValueError("geometry and weights must be finite") from None
        if not math.isfinite(result) or (result <= 0 if positive else result < 0):
            raise ValueError("dimensions must be positive; weights nonnegative and finite")
        return result

    @staticmethod
    def _supported(position, dimensions, placements):
        """Cover every footprint strip with a union of coplanar supporting tops."""
        x, y, z = position
        if z == 0:
            return True
        length, width, _ = dimensions
        rectangles = []
        for _, origin, size, _ in placements:
            if origin[2] + size[2] != z:
                continue
            left, right = max(x, origin[0]), min(x + length, origin[0] + size[0])
            bottom, top = max(y, origin[1]), min(y + width, origin[1] + size[1])
            if left < right and bottom < top:
                rectangles.append((left, right, bottom, top))
        boundaries = sorted({x, x + length} | {v for rect in rectangles for v in rect[:2]})
        for left, right in zip(boundaries, boundaries[1:]):
            intervals = sorted((bottom, top) for a, b, bottom, top in rectangles
                               if a <= left and b >= right)
            covered = y
            for bottom, top in intervals:
                if bottom > covered:
                    break
                covered = max(covered, top)
            if covered < y + width:
                return False
        return True

    def pack_cargo(self, container: Container, items: List[Item]) -> Dict[str, Any]:
        """Deterministic feasible 3D heuristic; no global optimality guarantee."""
        bounds = tuple(self._finite(v, positive=True) for v in
                       (container.length, container.width, container.height))
        capacity = self._finite(container.max_weight)
        container_volume = math.prod(bounds)
        if not math.isfinite(container_volume) or container_volume == 0:
            raise ValueError("container volume must be finite and representable")
        admitted, seen = [], set()
        for item in items:
            if not isinstance(item, Item) or not isinstance(item.item_id, str) or not item.item_id:
                raise ValueError("items must have nonempty string IDs")
            if item.item_id in seen:
                raise ValueError("item IDs must be unique")
            seen.add(item.item_id)
            dimensions = tuple(self._finite(v, positive=True) for v in
                               (item.length, item.width, item.height))
            weight = self._finite(item.weight)
            volume = math.prod(dimensions)
            if not math.isfinite(volume) or volume == 0:
                raise ValueError("item volume must be finite and representable")
            admitted.append((item, dimensions, weight, volume))

        # Work on a private plan; invalid input never partially changes Items.
        placements, unpacked = [], []
        candidates = {(0.0, 0.0, 0.0)}
        current_weight = used_volume = 0.0
        for item, dimensions, weight, volume in sorted(admitted, key=lambda entry: -entry[3]):
            chosen = None
            if current_weight + weight <= capacity:
                orientations = list(permutations(dimensions))
                for position in sorted(candidates, key=lambda point: (point[2], point[1], point[0])):
                    for rotation, size in enumerate(orientations):
                        if any(position[axis] + size[axis] > bounds[axis] for axis in range(3)):
                            continue
                        overlaps = any(all(position[axis] < origin[axis] + old_size[axis]
                                           and origin[axis] < position[axis] + size[axis]
                                           for axis in range(3))
                                       for _, origin, old_size, _ in placements)
                        if not overlaps and self._supported(position, size, placements):
                            chosen = (item, position, size, rotation)
                            break
                    if chosen is not None:
                        break
            if chosen is None:
                unpacked.append(item.item_id)
                continue
            placements.append(chosen)
            current_weight += weight
            used_volume += volume
            _, position, size, _ = chosen
            candidates.discard(position)
            for axis in range(3):
                point = list(position)
                point[axis] += size[axis]
                if all(point[k] < bounds[k] for k in range(3)):
                    candidates.add(tuple(point))

        for item, _, _, _ in admitted:
            item.position, item.rotation, item.placed_dimensions = None, 0, None
        for item, position, size, rotation in placements:
            item.position, item.rotation, item.placed_dimensions = position, rotation, size
        return {
            "success": len(unpacked) == 0,
            "utilization_percentage": round(used_volume / container_volume * 100, 2),
            "total_weight": current_weight,
            "axle_weight_distribution": self._calculate_axle_distribution(
                [entry[0] for entry in placements], bounds[0]),
            "packed_items": [entry[0].item_id for entry in placements],
            "unpacked_items": unpacked,
            "placements": [{"item_id": item.item_id, "position": position,
                            "dimensions": size, "rotation": rotation}
                           for item, position, size, rotation in placements],
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
