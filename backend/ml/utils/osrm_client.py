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
    
    :param origin: Tuple of (lat, lng)
    :param destination: Tuple of (lat, lng)
    :return: Tuple of (distance_km, duration_min)
    """
    try:
        # OSRM expects coordinates in lng,lat format
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
    
    # Fallback to straight-line distance if OSRM fails
    from math import radians, sin, cos, sqrt, atan2
    lat1, lon1 = radians(origin[0]), radians(origin[1])
    lat2, lon2 = radians(destination[0]), radians(destination[1])
    dlon = lon2 - lon1
    dlat = lat2 - lat1
    a = sin(dlat / 2)**2 + cos(lat1) * cos(lat2) * sin(dlon / 2)**2
    c = 2 * atan2(sqrt(a), sqrt(1 - a))
    r = 6371.0  # Radius of earth in km
    distance_km = r * c
    
    # Assume average speed of 40 km/h for duration fallback
    duration_min = (distance_km / 40.0) * 60.0
    return distance_km, duration_min


def get_route_matrix(locations: List[Tuple[float, float]]) -> List[List[float]]:
    """
    Gets a distance matrix in km for Vehicle Routing Problem (VRP).
    
    :param locations: List of (lat, lng) coordinates
    :return: 2D list representing the distance matrix in km
    """
    try:
        # OSRM table service expects coordinates in lng,lat separated by semicolon
        coord_str = ";".join([f"{loc[1]},{loc[0]}" for loc in locations])
        url = f"{OSRM_BASE_URL}/table/v1/driving/{coord_str}"
        params = {
            "annotations": "distance"
        }
        response = requests.get(url, params=params, timeout=5)
        if response.status_code == 200:
            data = response.json()
            if "distances" in data:
                # OSRM returns distances in meters, convert to km
                return [[d / 1000.0 for d in row] for row in data["distances"]]
        
        logger.warning(f"OSRM table request failed with status: {response.status_code}")
    except Exception as e:
        logger.error(f"Error fetching distance matrix from OSRM: {e}")
    
    # Fallback to straight-line distance matrix
    from math import radians, sin, cos, sqrt, atan2
    n = len(locations)
    matrix = [[0.0] * n for _ in range(n)]
    
    def haversine(loc1, loc2):
        lat1, lon1 = radians(loc1[0]), radians(loc1[1])
        lat2, lon2 = radians(loc2[0]), radians(loc2[1])
        dlon = lon2 - lon1
        dlat = lat2 - lat1
        a = sin(dlat / 2)**2 + cos(lat1) * cos(lat2) * sin(dlon / 2)**2
        c = 2 * atan2(sqrt(a), sqrt(1 - a))
        return 6371.0 * c

    for i in range(n):
        for j in range(n):
            if i != j:
                matrix[i][j] = haversine(locations[i], locations[j])
    return matrix
