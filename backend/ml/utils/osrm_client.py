import os
import requests
import logging
from typing import Tuple, List

logger = logging.getLogger(__name__)

# Defaults to the docker-compose internal hostname: http://osrm:5000
OSRM_BASE_URL = os.getenv("OSRM_BASE_URL", "http://osrm:5000")


def get_route_distance(origin: Tuple[float, float], destination: Tuple[float, float]) -> Tuple[float, float]:
    """
    Gets the road route distance (km) and duration (minutes) from OSRM.
    """
    try:
        url = f"{OSRM_BASE_URL}/route/v1/driving/{origin[1]},{origin[0]};{destination[1]},{destination[0]}"
        params = {
            "overview": "false",
            "alternatives": "false",
            "steps": "false"
        }
        response = requests.get(url, params=params, timeout=5)
        if response.status_code == 200:
            data = response.json()
            if data.get("routes"):
                route = data["routes"][0]
                distance_km = route["distance"] / 1000.0
                duration_min = route["duration"] / 60.0
                return distance_km, duration_min

        logger.warning(f"OSRM request failed with status: {response.status_code}")
    except Exception as e:
        logger.error(f"Error fetching route from OSRM: {e}")

    from math import radians, sin, cos, sqrt, atan2
    lat1, lon1 = radians(origin[0]), radians(origin[1])
    lat2, lon2 = radians(destination[0]), radians(destination[1])
    dlon = lon2 - lon1
    dlat = lat2 - lat1
    a = sin(dlat / 2)**2 + cos(lat1) * cos(lat2) * sin(dlon / 2)**2
    c = 2 * atan2(sqrt(a), sqrt(1 - a))
    r = 6371.0
    distance_km = r * c
    duration_min = (distance_km / 40.0) * 60.0
    return distance_km, duration_min


def get_route_matrix(locations: List[Tuple[float, float]]) -> List[List[float]]:
    """Gets a road distance matrix in km for vehicle-routing calculations."""
    distance_matrix, _ = get_route_matrix_with_duration(locations)
    return distance_matrix


def get_route_matrix_with_duration(
    locations: List[Tuple[float, float]],
) -> Tuple[List[List[float]], List[List[float]]]:
    """Get OSRM road distance and travel-duration matrices.

    OSRM durations are used when available, so route feasibility reflects the
    road network instead of converting geometric distance with a fixed speed.
    If OSRM is unavailable, distance falls back to haversine and duration uses
    the existing 40 km/h fallback used by this client.
    """
    try:
        coord_str = ";".join([f"{loc[1]},{loc[0]}" for loc in locations])
        url = f"{OSRM_BASE_URL}/table/v1/driving/{coord_str}"
        params = {"annotations": "distance,duration"}
        response = requests.get(url, params=params, timeout=5)
        if response.status_code == 200:
            data = response.json()
            distances = data.get("distances")
            durations = data.get("durations")
            if distances is not None and durations is not None:
                return (
                    [[float(distance) / 1000.0 for distance in row] for row in distances],
                    [[float(duration) / 60.0 for duration in row] for row in durations],
                )

        logger.warning(f"OSRM table request failed with status: {response.status_code}")
    except Exception as e:
        logger.error(f"Error fetching OSRM distance/duration matrix: {e}")

    from math import radians, sin, cos, sqrt, atan2

    def haversine(loc1: Tuple[float, float], loc2: Tuple[float, float]) -> float:
        lat1, lon1 = radians(loc1[0]), radians(loc1[1])
        lat2, lon2 = radians(loc2[0]), radians(loc2[1])
        dlon = lon2 - lon1
        dlat = lat2 - lat1
        a = sin(dlat / 2)**2 + cos(lat1) * cos(lat2) * sin(dlon / 2)**2
        c = 2 * atan2(sqrt(a), sqrt(1 - a))
        return 6371.0 * c

    n = len(locations)
    distance_matrix = [[0.0] * n for _ in range(n)]
    duration_matrix = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            if i == j:
                continue
            distance_km = haversine(locations[i], locations[j])
            distance_matrix[i][j] = distance_km
            duration_matrix[i][j] = (distance_km / 40.0) * 60.0
    return distance_matrix, duration_matrix
