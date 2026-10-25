import logging
import os
from math import atan2, cos, isfinite, radians, sin, sqrt
from numbers import Real

import requests

logger = logging.getLogger(__name__)

# Docker Compose service hostname.
# Override with OSRM_BASE_URL when running outside Docker.
OSRM_BASE_URL = os.getenv("OSRM_BASE_URL", "http://osrm:5000")
OSRM_TIMEOUT = float(os.getenv("OSRM_TIMEOUT", "5"))
# Bound both the provider query and the public quadratic result/fallback.
MAX_TABLE_LOCATIONS = 100


def _coordinate(value):
    """Own one complete finite (latitude, longitude) coordinate."""
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        raise ValueError("Coordinates must be latitude/longitude pairs")
    result = []
    for component, limit in zip(value, (90, 180)):
        if isinstance(component, bool) or not isinstance(component, Real):
            raise TypeError("Coordinate components must be real numbers")
        try:
            number = float(component)
        except OverflowError as exc:
            raise ValueError("Coordinate exceeds numeric range") from exc
        if not isfinite(number) or abs(number) > limit:
            raise ValueError("Coordinate component is outside geographic bounds")
        result.append(number)
    return tuple(result)


def _service_object(data):
    """Admit a successful OSRM response before interpreting any result."""
    if not isinstance(data, dict) or data.get("code") != "Ok":
        raise ValueError("OSRM response must be an object with code Ok")
    return data


def _metric(value, divisor):
    """Decode one finite, nonnegative JSON road metric in public units."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError("Road metrics must be JSON numbers")
    try:
        number = float(value)
    except OverflowError as exc:
        raise ValueError("Road metric exceeds numeric range") from exc
    if not isfinite(number) or number < 0:
        raise ValueError("Road metrics must be finite and nonnegative")
    return number / divisor


def _matrix(value, size, divisor):
    """Own and admit the entire directed matrix before publication."""
    if not isinstance(value, list) or len(value) != size:
        raise ValueError("OSRM table must contain exactly N rows")
    result = []
    for row in value:
        if not isinstance(row, list) or len(row) != size:
            raise ValueError("OSRM table must contain exactly N columns")
        result.append(
            [float("inf") if cell is None else _metric(cell, divisor) for cell in row]
        )
    return result


def _haversine_distance(
    origin: tuple[float, float],
    destination: tuple[float, float],
) -> float:
    """Calculate straight-line distance between two coordinates in km."""
    lat1, lon1 = radians(origin[0]), radians(origin[1])
    lat2, lon2 = radians(destination[0]), radians(destination[1])

    dlat = lat2 - lat1
    dlon = lon2 - lon1

    a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    a = min(1.0, max(0.0, a))
    c = 2 * atan2(sqrt(a), sqrt(1 - a))

    return 6371.0 * c


def get_route_distance(
    origin: tuple[float, float],
    destination: tuple[float, float],
) -> tuple[float, float]:
    """
    Get road route distance and duration from OSRM.

    Coordinates must be provided as:
        (latitude, longitude)

    Returns:
        (distance_km, duration_min)
    """
    origin, destination = _coordinate(origin), _coordinate(destination)
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

        data = _service_object(response.json())
        routes = data.get("routes", [])

        if not isinstance(routes, list):
            raise TypeError("OSRM routes must be a list")
        if routes:
            route = routes[0]

            if not isinstance(route, dict):
                raise ValueError("OSRM routes must be a list of objects")
            distance_km = _metric(route["distance"], 1000.0)
            duration_min = _metric(route["duration"], 60.0)

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
    locations: list[tuple[float, float]],
) -> list[list[float]]:
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
    locations: list[tuple[float, float]],
) -> tuple[list[list[float]], list[list[float]]]:
    """
    Get OSRM road-distance and travel-duration matrices.

    Returns:
        (
            distance_matrix_km,
            duration_matrix_min,
        )
    """
    if not isinstance(locations, (list, tuple)):
        raise TypeError("Locations must be a list or tuple")
    if len(locations) > MAX_TABLE_LOCATIONS:
        raise ValueError("OSRM table supports at most 100 locations")
    locations = tuple(_coordinate(location) for location in locations)
    if not locations:
        return [], []

    coordinates = ";".join(
        f"{longitude},{latitude}" for latitude, longitude in locations
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

        data = _service_object(response.json())

        distances = data.get("distances")
        durations = data.get("durations")

        if distances is not None and durations is not None:
            distance_matrix = _matrix(distances, len(locations), 1000.0)
            duration_matrix = _matrix(durations, len(locations), 60.0)

            return distance_matrix, duration_matrix

        logger.warning("OSRM table response missing distances or durations.")

    except requests.RequestException as exc:
        logger.warning("OSRM table request failed: %s", exc)
    except (TypeError, ValueError) as exc:
        logger.warning("Invalid OSRM table response: %s", exc)

    # Fallback to Haversine distance + 40 km/h estimated duration.
    n = len(locations)

    distance_matrix = [[0.0 for _ in range(n)] for _ in range(n)]

    duration_matrix = [[0.0 for _ in range(n)] for _ in range(n)]

    for i in range(n):
        for j in range(n):
            if i == j:
                continue

            distance_km = _haversine_distance(
                locations[i],
                locations[j],
            )

            distance_matrix[i][j] = distance_km
            duration_matrix[i][j] = (distance_km / 40.0) * 60.0

    logger.warning(
        "OSRM unavailable. Using Haversine fallback for %d locations.",
        n,
    )

    return distance_matrix, duration_matrix
