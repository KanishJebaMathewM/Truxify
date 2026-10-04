import logging
import os
from math import atan2, cos, radians, sin, sqrt
from typing import List, Tuple

import requests

logger = logging.getLogger(__name__)

# Docker Compose service hostname.
# Override with OSRM_BASE_URL when running outside Docker.
OSRM_BASE_URL = os.getenv("OSRM_BASE_URL", "http://osrm:5000")
OSRM_TIMEOUT = float(os.getenv("OSRM_TIMEOUT", "5"))


def _haversine_distance(
    origin: Tuple[float, float],
    destination: Tuple[float, float],
) -> float:
    """Calculate straight-line distance between two coordinates in km."""
    lat1, lon1 = radians(origin[0]), radians(origin[1])
    lat2, lon2 = radians(destination[0]), radians(destination[1])

    dlat = lat2 - lat1
    dlon = lon2 - lon1

    a = (
        sin(dlat / 2) ** 2
        + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    )
    c = 2 * atan2(sqrt(a), sqrt(1 - a))

    return 6371.0 * c


def get_route_distance(
    origin: Tuple[float, float],
    destination: Tuple[float, float],
) -> Tuple[float, float]:
    """
    Get road route distance and duration from OSRM.

    Coordinates must be provided as:
        (latitude, longitude)

    Returns:
        (distance_km, duration_min)
    """
    url = (
        f"{OSRM_BASE_URL}/route/v1/driving/"
        f"{origin[1]},{origin[0]};"
        f"{destination[1]},{destination[0]}"
    )

    params = {
        "overview": "false",
        "alternatives": "false",
        "steps": "false",
    }

    try:
        response = requests.get(
            url,
            params=params,
            timeout=OSRM_TIMEOUT,
        )
        response.raise_for_status()

        data = response.json()
        routes = data.get("routes", [])

        if routes:
            route = routes[0]

            distance_km = float(route["distance"]) / 1000.0
            duration_min = float(route["duration"]) / 60.0

            return distance_km, duration_min

        logger.warning("OSRM returned no routes.")

    except requests.RequestException as exc:
        logger.warning("OSRM route request failed: %s", exc)
    except (KeyError, TypeError, ValueError) as exc:
        logger.warning("Invalid OSRM route response: %s", exc)

    # Fallback when OSRM is unavailable.
    distance_km = _haversine_distance(origin, destination)
    duration_min = (distance_km / 40.0) * 60.0

    logger.warning(
        "Using Haversine fallback for route %.2f km.",
        distance_km,
    )

    return distance_km, duration_min


def get_route_matrix(
    locations: List[Tuple[float, float]],
) -> List[List[float]]:
    """
    Get an OSRM road-distance matrix in kilometres.

    Args:
        locations: List of (latitude, longitude) coordinates.

    Returns:
        NxN distance matrix in kilometres.
    """
    distance_matrix, _ = get_route_matrix_with_duration(locations)
    return distance_matrix


def get_route_matrix_with_duration(
    locations: List[Tuple[float, float]],
) -> Tuple[List[List[float]], List[List[float]]]:
    """
    Get OSRM road-distance and travel-duration matrices.

    Returns:
        (
            distance_matrix_km,
            duration_matrix_min,
        )
    """
    if not locations:
        return [], []

    coordinates = ";".join(
        f"{longitude},{latitude}"
        for latitude, longitude in locations
    )

    url = f"{OSRM_BASE_URL}/table/v1/driving/{coordinates}"

    params = {
        "annotations": "distance,duration",
    }

    try:
        response = requests.get(
            url,
            params=params,
            timeout=OSRM_TIMEOUT,
        )
        response.raise_for_status()

        data = response.json()

        distances = data.get("distances")
        durations = data.get("durations")

        if distances is not None and durations is not None:
            distance_matrix = [
                [
                    float(distance) / 1000.0
                    if distance is not None
                    else float("inf")
                    for distance in row
                ]
                for row in distances
            ]

            duration_matrix = [
                [
                    float(duration) / 60.0
                    if duration is not None
                    else float("inf")
                    for duration in row
                ]
                for row in durations
            ]

            return distance_matrix, duration_matrix

        logger.warning("OSRM table response missing distances or durations.")

    except requests.RequestException as exc:
        logger.warning("OSRM table request failed: %s", exc)
    except (TypeError, ValueError) as exc:
        logger.warning("Invalid OSRM table response: %s", exc)

    # Fallback to Haversine distance + 40 km/h estimated duration.
    n = len(locations)

    distance_matrix = [
        [0.0 for _ in range(n)]
        for _ in range(n)
    ]

    duration_matrix = [
        [0.0 for _ in range(n)]
        for _ in range(n)
    ]

    for i in range(n):
        for j in range(n):
            if i == j:
                continue

            distance_km = _haversine_distance(
                locations[i],
                locations[j],
            )

            distance_matrix[i][j] = distance_km
            duration_matrix[i][j] = (
                distance_km / 40.0
            ) * 60.0

    logger.warning(
        "OSRM unavailable. Using Haversine fallback for %d locations.",
        n,
    )

    return distance_matrix, duration_matrix
