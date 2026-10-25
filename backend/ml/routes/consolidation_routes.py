"""
Consolidation API Routes for Multi-Stop CVRPTW & 3D Bin-Packing
"""

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional

from ..services.bin_packing_3d import BinPacking3D
from ..services.cvrptw_solver import CvrptwSolver

router = APIRouter(prefix="/api/v1/ml", tags=["LTL Load Consolidation"])


class CargoItemSchema(BaseModel):
    id: str
    length: float = Field(..., gt=0, description="Length in meters")
    width: float = Field(..., gt=0, description="Width in meters")
    height: float = Field(..., gt=0, description="Height in meters")
    weight_kg: float = Field(..., ge=0, description="Weight in kg")
    stackable: bool = True
    fragile: bool = False
    allow_rotation: bool = True


class StopLocationSchema(BaseModel):
    lat: float
    lng: float
    name: Optional[str] = "Stop"
    time_window_start_min: Optional[float] = 0.0
    time_window_end_min: Optional[float] = 1440.0


class ConsignmentSchema(BaseModel):
    id: str
    pickup: StopLocationSchema
    delivery: StopLocationSchema
    weight_kg: float = Field(..., ge=0)
    cargo_items: List[CargoItemSchema]


class TruckSpecsSchema(BaseModel):
    length_m: float = 12.0
    width_m: float = 2.4
    height_m: float = 2.6
    max_weight_kg: float = 25000.0
    depot: Optional[StopLocationSchema] = None


class ConsolidationRequest(BaseModel):
    truck_specs: TruckSpecsSchema
    consignments: List[ConsignmentSchema]


@router.post("/consolidate-loads", status_code=status.HTTP_200_OK)
async def consolidate_loads(request: ConsolidationRequest) -> Dict[str, Any]:
    """
    Consolidates candidate LTL consignments:
    1. Runs 3D Extreme-Point Bin Packing to verify spatial feasibility & axle balance.
    2. Runs CVRPTW solver to determine optimal pickup & delivery sequence.
    """
    try:
        truck = request.truck_specs

        # 1. Gather all individual cargo items for 3D packing
        all_items = []
        for c in request.consignments:
            for it in c.cargo_items:
                all_items.append({
                    "id": f"{c.id}_{it.id}",
                    "consignment_id": c.id,
                    "length": it.length,
                    "width": it.width,
                    "height": it.height,
                    "weight_kg": it.weight_kg,
                    "stackable": it.stackable,
                    "fragile": it.fragile,
                    "allow_rotation": it.allow_rotation,
                })

        # Run 3D Bin Packing
        packer = BinPacking3D(
            container_length=truck.length_m,
            container_width=truck.width_m,
            container_height=truck.height_m,
            max_weight_kg=truck.max_weight_kg,
        )
        packing_result = packer.pack(all_items)

        # 2. Run CVRPTW Multi-Stop Route Solver
        depot_dict = {
            "lat": truck.depot.lat if truck.depot else request.consignments[0].pickup.lat,
            "lng": truck.depot.lng if truck.depot else request.consignments[0].pickup.lng,
            "start_time_min": 0.0,
        }

        consignments_dict = []
        for c in request.consignments:
            consignments_dict.append({
                "id": c.id,
                "weight_kg": c.weight_kg,
                "pickup": {
                    "lat": c.pickup.lat,
                    "lng": c.pickup.lng,
                    "name": c.pickup.name,
                    "time_window_start_min": c.pickup.time_window_start_min,
                    "time_window_end_min": c.pickup.time_window_end_min,
                },
                "delivery": {
                    "lat": c.delivery.lat,
                    "lng": c.delivery.lng,
                    "name": c.delivery.name,
                    "time_window_start_min": c.delivery.time_window_start_min,
                    "time_window_end_min": c.delivery.time_window_end_min,
                },
            })

        solver = CvrptwSolver(avg_speed_kmh=45.0, service_time_mins=30.0)
        routing_result = solver.solve(
            depot=depot_dict,
            consignments=consignments_dict,
            max_capacity_kg=truck.max_weight_kg,
        )

        return {
            "success": packing_result["success"] and routing_result["success"],
            "consolidation_feasibility": {
                "is_spatially_feasible": packing_result["success"],
                "is_axle_balanced": packing_result["statistics"]["is_axle_balanced"],
                "total_consignments": len(request.consignments),
            },
            "packing_solution": packing_result,
            "routing_solution": routing_result,
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Consolidation optimization error: {str(e)}",
        )
