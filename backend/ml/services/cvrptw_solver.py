"""
Capacitated Vehicle Routing Problem with Time Windows (CVRPTW) & Pickup/Delivery Engine
Calculates optimal stop sequences for consolidated multi-customer LTL freight trips.
"""

from typing import List, Dict, Any, Tuple
import math


def haversine_distance_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Calculates great-circle distance between coordinates in kilometers."""
    R = 6371.0
    d_lat = math.radians(lat2 - lat1)
    d_lng = math.radians(lng2 - lng1)
    a = (
        math.sin(d_lat / 2.0) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(d_lng / 2.0) ** 2
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c


class CvrptwSolver:
    """
    Solves multi-stop Pickup and Delivery Routing with vehicle capacity
    and operational time windows.
    """

    def __init__(self, avg_speed_kmh: float = 45.0, service_time_mins: float = 30.0):
        self.avg_speed_kmh = float(avg_speed_kmh)
        self.service_time_mins = float(service_time_mins)

    def solve(
        self,
        depot: Dict[str, Any],
        consignments: List[Dict[str, Any]],
        max_capacity_kg: float = 25000.0,
    ) -> Dict[str, Any]:
        """
        Solves the CVRPTW stop sequence.

        Consignment schema:
          - id: str
          - pickup: { lat, lng, time_window_start_min, time_window_end_min, name }
          - delivery: { lat, lng, time_window_start_min, time_window_end_min, name }
          - weight_kg: float
        """
        if not consignments:
            return {
                "success": True,
                "total_distance_km": 0.0,
                "total_duration_mins": 0.0,
                "stops": [],
            }

        # Build list of stops with pickup/dropoff dependencies
        stops = []
        for idx, c in enumerate(consignments):
            c_id = c.get("id", f"c_{idx}")
            weight = float(c.get("weight_kg", 0.0))

            p = c.get("pickup", {})
            stops.append({
                "consignment_id": c_id,
                "type": "PICKUP",
                "lat": float(p.get("lat", 0.0)),
                "lng": float(p.get("lng", 0.0)),
                "name": p.get("name", f"Pickup #{c_id}"),
                "tw_start": float(p.get("time_window_start_min", 0.0)),
                "tw_end": float(p.get("time_window_end_min", 1440.0)),
                "weight_delta": weight,
            })

            d = c.get("delivery", {})
            stops.append({
                "consignment_id": c_id,
                "type": "DELIVERY",
                "lat": float(d.get("lat", 0.0)),
                "lng": float(d.get("lng", 0.0)),
                "name": d.get("name", f"Delivery #{c_id}"),
                "tw_start": float(d.get("time_window_start_min", 0.0)),
                "tw_end": float(d.get("time_window_end_min", 1440.0)),
                "weight_delta": -weight,
            })

        # Nearest Insertion with Pickup-before-Delivery precedence heuristic
        depot_lat = float(depot.get("lat", stops[0]["lat"]))
        depot_lng = float(depot.get("lng", stops[0]["lng"]))

        unvisited = list(stops)
        route = []
        picked_up_consignments = set()

        curr_lat, curr_lng = depot_lat, depot_lng
        curr_time_min = float(depot.get("start_time_min", 0.0))
        curr_load_kg = 0.0
        total_dist_km = 0.0

        while unvisited:
            # Candidates are:
            # 1. Any PICKUP stop (if capacity allows)
            # 2. Any DELIVERY stop whose corresponding PICKUP has already occurred
            candidates = []
            for s in unvisited:
                if s["type"] == "PICKUP":
                    if curr_load_kg + s["weight_delta"] <= max_capacity_kg:
                        candidates.append(s)
                elif s["type"] == "DELIVERY":
                    if s["consignment_id"] in picked_up_consignments:
                        candidates.append(s)

            if not candidates:
                # Capacity constraint or cyclic deadlock fallback: force nearest delivery
                delivery_candidates = [
                    s for s in unvisited if s["consignment_id"] in picked_up_consignments
                ]
                candidates = delivery_candidates if delivery_candidates else unvisited

            # Select nearest candidate
            best_stop = None
            best_dist = float("inf")

            for cand in candidates:
                dist = haversine_distance_km(curr_lat, curr_lng, cand["lat"], cand["lng"])
                if dist < best_dist:
                    best_dist = dist
                    best_stop = cand

            if best_stop is None:
                best_stop = unvisited[0]
                best_dist = haversine_distance_km(curr_lat, curr_lng, best_stop["lat"], best_stop["lng"])

            # Advance vehicle state
            travel_time_min = (best_dist / self.avg_speed_kmh) * 60.0
            arrival_time_min = curr_time_min + travel_time_min

            # Wait if arrived earlier than time window start
            start_service_time = max(arrival_time_min, best_stop["tw_start"])
            departure_time_min = start_service_time + self.service_time_mins

            curr_load_kg += best_stop["weight_delta"]
            total_dist_km += best_dist

            if best_stop["type"] == "PICKUP":
                picked_up_consignments.add(best_stop["consignment_id"])

            route_entry = {
                "sequence": len(route) + 1,
                "consignment_id": best_stop["consignment_id"],
                "type": best_stop["type"],
                "name": best_stop["name"],
                "location": {"lat": best_stop["lat"], "lng": best_stop["lng"]},
                "distance_from_prev_km": round(best_dist, 2),
                "arrival_time_min": round(arrival_time_min, 1),
                "departure_time_min": round(departure_time_min, 1),
                "vehicle_load_kg": round(curr_load_kg, 1),
                "is_within_time_window": arrival_time_min <= best_stop["tw_end"],
            }
            route.append(route_entry)

            curr_lat, curr_lng = best_stop["lat"], best_stop["lng"]
            curr_time_min = departure_time_min
            unvisited.remove(best_stop)

        return {
            "success": True,
            "total_distance_km": round(total_dist_km, 2),
            "total_duration_hours": round(curr_time_min / 60.0, 2),
            "total_stops": len(route),
            "consignments_count": len(consignments),
            "max_capacity_kg": max_capacity_kg,
            "itinerary": route,
        }
