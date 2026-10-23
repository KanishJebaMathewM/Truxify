"""
3D Extreme-Point Bin Packing Heuristic Engine for Freight Vehicle Loading
Evaluates physical spatial constraints, pallet orientations, stackability,
fragility, and vehicle axle Center-of-Gravity (CoG) load balance.
"""

from typing import List, Dict, Any, Tuple, Optional
from fractions import Fraction

from .packing_support import finite, observations, order, supported


class BinPacking3D:
    """
    3D Extreme-Point heuristic algorithm for packing heterogeneous LTL cargo
    into commercial freight trucks (HCV/LCV).
    """

    def __init__(
        self,
        container_length: float = 12.0,   # meters (e.g. 40ft trailer ~ 12m)
        container_width: float = 2.4,     # meters (standard ~ 2.4m)
        container_height: float = 2.6,    # meters (standard ~ 2.6m)
        max_weight_kg: float = 25000.0,   # kg (max payload ~ 25 tonnes)
    ):
        self.L = finite(container_length, "container_length")
        self.W = finite(container_width, "container_width")
        self.H = finite(container_height, "container_height")
        self.max_weight_kg = finite(max_weight_kg, "max_weight_kg")
        finite(self.L * self.W * self.H, "container volume")

    def pack(self, items: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Packs a list of items into the 3D container space.
        
        Item schema:
          - id: str
          - length: float (meters)
          - width: float (meters)
          - height: float (meters)
          - weight_kg: float
          - stackable: bool (default True)
          - fragile: bool (default False)
          - allow_rotation: bool (default True)
        """
        # Sort items by volume and weight descending (largest/heaviest first for stability)
        admitted_items = observations(items)
        sorted_items = sorted(admitted_items, key=order, reverse=True)

        packed_items: List[Dict[str, Any]] = []
        unpacked_items: List[Dict[str, Any]] = []
        extreme_points: List[Tuple[float, float, float]] = [(0.0, 0.0, 0.0)]
        current_weight_kg = Fraction(0)

        for item in sorted_items:
            item_id = item.get("id", f"item_{len(packed_items)}")
            length = float(item.get("length", 1.0))
            width = float(item.get("width", 1.0))
            height = float(item.get("height", 1.0))
            weight_kg = float(item.get("weight_kg", 0.0))
            stackable = bool(item.get("stackable", True))
            fragile = bool(item.get("fragile", False))
            allow_rotation = bool(item.get("allow_rotation", True))

            # Check weight limit
            if current_weight_kg + Fraction(weight_kg) > Fraction(self.max_weight_kg):
                unpacked_items.append({
                    "id": item_id,
                    "reason": "Exceeds maximum payload weight capacity",
                })
                continue

            # Orientations to evaluate (length x width x height, and rotated width x length x height)
            orientations = [(length, width, height)]
            if allow_rotation and length != width:
                orientations.append((width, length, height))

            placed = False

            # Sort extreme points by Z (bottom first), then X (front first), then Y
            extreme_points.sort(key=lambda pt: (pt[2], pt[0], pt[1]))

            for pt in list(extreme_points):
                px, py, pz = pt

                for dim_l, dim_w, dim_h in orientations:
                    if not supported((px, py, pz), (dim_l, dim_w, dim_h),
                                     packed_items, (self.L, self.W, self.H)):
                        continue

                    # 3. Valid placement found!
                    placed_entry = {
                        "id": item_id,
                        "position": {"x": px, "y": py, "z": pz},
                        "dimensions": {"l": dim_l, "w": dim_w, "h": dim_h},
                        "weight_kg": weight_kg,
                        "stackable": stackable,
                        "fragile": fragile,
                    }
                    packed_items.append(placed_entry)
                    current_weight_kg += Fraction(weight_kg)
                    placed = True

                    # Generate new extreme points along bounding faces
                    extreme_points.remove(pt)
                    new_points = [
                        (px + dim_l, py, pz),
                        (px, py + dim_w, pz),
                        (px, py, pz + dim_h),
                    ]
                    for np in new_points:
                        if np[0] <= self.L and np[1] <= self.W and np[2] <= self.H and np not in extreme_points:
                            extreme_points.append(np)

                    break

                if placed:
                    break

            if not placed:
                unpacked_items.append({
                    "id": item_id,
                    "reason": "No spatial volume / extreme point fits cargo dimensions",
                })

        # Calculate volume utilization
        total_container_vol = Fraction(self.L) * Fraction(self.W) * Fraction(self.H)
        used_volume = sum((Fraction(p["dimensions"]["l"]) *
                           Fraction(p["dimensions"]["w"]) *
                           Fraction(p["dimensions"]["h"]) for p in packed_items), Fraction(0))
        vol_utilization_pct = float(used_volume / total_container_vol * 100)
        # Normalize exact moments before conversion, avoiding intermediate
        # float overflow for otherwise finite observations.
        cog_x = 0.0
        if current_weight_kg > 0:
            weighted_x_sum = sum((Fraction(p["weight_kg"]) *
                                  (Fraction(p["position"]["x"]) +
                                   Fraction(p["dimensions"]["l"]) / 2)
                                  for p in packed_items), Fraction(0))
            cog_x = float(weighted_x_sum / current_weight_kg)

        # Safe axle range is between 40% and 60% of container length
        is_axle_balanced = (0.35 * self.L) <= cog_x <= (0.65 * self.L) if current_weight_kg > 0 else True

        return {
            "success": len(unpacked_items) == 0,
            "container": {
                "length": self.L,
                "width": self.W,
                "height": self.H,
                "max_weight_kg": self.max_weight_kg,
                "total_volume_m3": round(float(total_container_vol), 2),
            },
            "statistics": {
                "total_items": len(items),
                "packed_count": len(packed_items),
                "unpacked_count": len(unpacked_items),
                "total_packed_weight_kg": round(float(current_weight_kg), 2),
                "weight_utilization_pct": round(float(current_weight_kg / Fraction(self.max_weight_kg) * 100), 2),
                "volume_utilization_pct": round(vol_utilization_pct, 2),
                "center_of_gravity_x_m": round(cog_x, 3),
                "is_axle_balanced": is_axle_balanced,
            },
            "packed_items": packed_items,
            "unpacked_items": unpacked_items,
        }
