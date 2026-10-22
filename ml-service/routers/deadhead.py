# ml-service/routers/deadhead.py (Excerpt)
from fastapi import APIRouter, Query, HTTPException

router = APIRouter(prefix="/ml", tags=["Deadhead & En-Route Optimization"])

@router.get("/en-route-loads")
def get_en_route_loads(
    driverId: str = Query(...),
    currentLat: float = Query(...),
    currentLng: float = Query(...)
):
    try:
        # Query active available loads and compute detour metrics (max 30km detour)
        mock_matching_loads = [
            {
                "loadId": "load_901",
                "pickup": {"lat": currentLat + 0.05, "lng": currentLng + 0.05, "address": "Guindy Industrial Estate, Chennai"},
                "dropoff": {"lat": currentLat + 0.25, "lng": currentLng + 0.25, "address": "Sriperumbudur Hub"},
                "detourKm": 4.5,
                "extraEarnings": 1450.00,
                "estimatedMinutes": 35
            },
            {
                "loadId": "load_902",
                "pickup": {"lat": currentLat + 0.10, "lng": currentLng - 0.05, "address": "Porur Junction"},
                "dropoff": {"lat": currentLat + 0.30, "lng": currentLng - 0.15, "address": "Oragadam Industrial Corridor"},
                "detourKm": 12.0,
                "extraEarnings": 3200.00,
                "estimatedMinutes": 55
            }
        ]
        return {
            "success": True,
            "driverId": driverId,
            "loads": mock_matching_loads
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
