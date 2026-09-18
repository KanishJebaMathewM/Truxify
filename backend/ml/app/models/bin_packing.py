"""Bin Packing & Route Sequencing – packs shipments into a truck and orders stops.

Packing uses a **First-Fit Decreasing** (by volume) shelf-based placement
strategy. Delivery-stop ordering uses a **nearest-neighbour greedy** heuristic
starting from the supplied route start location.

This module is purely algorithmic – no ML model or training is required.
"""

import logging
import math
from typing import List, Dict, Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_EARTH_RADIUS_KM = 6_371.0


def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Return the great-circle distance in **km** between two points."""
    lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    )
    return 2 * _EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def _validate_route_start(route_start: Dict[str, Any]) -> None:
    """Validate the route start coordinates before route sequencing."""
    if not isinstance(route_start, dict):
        raise ValueError("route_start must be a mapping with lat and lng")

    lat = route_start.get("lat")
    lng = route_start.get("lng")
    if not isinstance(lat, (int, float)) or not math.isfinite(lat) or not -90 <= lat <= 90:
        raise ValueError("route_start.lat must be a finite value between -90 and 90")
    if not isinstance(lng, (int, float)) or not math.isfinite(lng) or not -180 <= lng <= 180:
        raise ValueError("route_start.lng must be a finite value between -180 and 180")


# ---------------------------------------------------------------------------
# Shelf-based First-Fit Decreasing 3-D packer
# ---------------------------------------------------------------------------


class _Shelf:
    """A horizontal shelf inside the truck at a fixed z-offset."""

    def __init__(self, z_bottom: float, max_length: float, max_width: float, max_height: float):
        self.z_bottom = z_bottom
        self.max_length = max_length
        self.max_width = max_width
        self.max_height = max_height
        self.shelf_height = 0.0        # tallest item placed so far
        self.cursor_x = 0.0            # next free x position
        self.cursor_y = 0.0            # next free y position (row within shelf)
        self.row_height = 0.0          # max item depth (w) in current row
        self.row_width = 0.0           # max width used by any row so far
        self.items: List[dict] = []

    def try_place(
        self,
        length: float,
        width: float,
        height: float,
        max_height_limit: float | None = None,
    ) -> dict | None:
        """Attempt to place an item; return position dict or *None*."""
        orientations = [
            # orientation values are original dimension axes in L/W/H order:
            # 0=length, 1=width, 2=height.
            ([0, 1, 2], False, length, width, height),
            ([1, 0, 2], True, width, length, height),
            ([0, 2, 1], True, length, height, width),
            ([2, 1, 0], True, height, width, length),
            ([1, 2, 0], True, width, height, length),
            ([2, 0, 1], True, height, length, width),
        ]
        for orientation, rotated, l, w, h in orientations:
            pos = self._fit(
                l, w, h, rotated, orientation, max_height_limit
            )
            if pos is not None:
                return pos
        return None

    def _fit(
        self,
        l: float,
        w: float,
        h: float,
        rotated: bool,
        orientation: List[int] | None,
        max_height_limit: float | None = None,
    ) -> dict | None:
        effective_max_height = (
            max_height_limit if max_height_limit is not None else self.max_height
        )

        if h > effective_max_height or max(self.shelf_height, h) > effective_max_height:
            return None

        if self.cursor_x + l <= self.max_length and self.cursor_y + w <= self.max_width:
            pos = {"x": self.cursor_x, "y": self.cursor_y, "z": self.z_bottom}
            self.cursor_x += l
            self.row_height = max(self.row_height, w)
            self.shelf_height = max(self.shelf_height, h)
            self.items.append({"pos": pos, "rotated": rotated, "orientation": orientation})
            return {**pos, "rotated": rotated, "orientation": orientation}

        new_y = self.cursor_y + self.row_height
        if new_y + w <= self.max_width and l <= self.max_length:
            self.cursor_x = l
            self.cursor_y = new_y
            self.row_height = w
            self.shelf_height = max(self.shelf_height, h)
            pos = {"x": 0.0, "y": new_y, "z": self.z_bottom}
            self.items.append({"pos": pos, "rotated": rotated, "orientation": orientation})
            return {**pos, "rotated": rotated, "orientation": orientation}

        return None


def _pack_packages(
    packages: List[Dict[str, float]],
    truck: Dict[str, float],
) -> tuple:
    """Pack packages into the truck using First-Fit Decreasing shelves.

    Returns ``(arrangements, unpacked_indices, utilization_pct)``.
    """
    truck_l = truck["length"]
    truck_w = truck["width"]
    truck_h = truck["height"]
    max_weight = truck["max_weight"]
    truck_volume = truck_l * truck_w * truck_h

    if truck_volume <= 0 or max_weight <= 0:
        return (
            [{"package_index": i, "position": {"x": 0, "y": 0, "z": 0},
              "rotated": False, "orientation": None, "fits": False} for i in range(len(packages))],
            list(range(len(packages))),
            0.0,
        )

    indexed = [(i, p) for i, p in enumerate(packages)]
    indexed.sort(key=lambda t: t[1]["length"] * t[1]["width"] * t[1]["height"], reverse=True)

    shelves: List[_Shelf] = []
    arrangements = [None] * len(packages)
    unpacked: List[int] = []
    packed_weight = 0.0
    packed_volume = 0.0

    for idx, pkg in indexed:
        pkg_length, pkg_width, pkg_height = pkg["length"], pkg["width"], pkg["height"]
        pkg_weight = pkg["weight"]

        if packed_weight + pkg_weight > max_weight:
            arrangements[idx] = {
                "package_index": idx,
                "position": {"x": 0.0, "y": 0.0, "z": 0.0},
                "rotated": False,
                "orientation": None,
                "fits": False,
            }
            unpacked.append(idx)
            continue

        placed = False
        for i, shelf in enumerate(shelves):
            if i + 1 < len(shelves):
                clearance = shelves[i + 1].z_bottom - shelf.z_bottom
            else:
                clearance = truck_h - shelf.z_bottom

            pos = shelf.try_place(pkg_length, pkg_width, pkg_height, max_height_limit=clearance)
            if pos is not None:
                arrangements[idx] = {
                    "package_index": idx,
                    "position": {"x": round(pos["x"], 4), "y": round(pos["y"], 4), "z": round(pos["z"], 4)},
                    "rotated": pos["rotated"],
                    "orientation": pos["orientation"],
                    "fits": True,
                }
                packed_weight += pkg_weight
                packed_volume += pkg_length * pkg_width * pkg_height
                placed = True
                break

        if not placed:
            z_offset = sum(s.shelf_height for s in shelves)
            if z_offset >= truck_h:
                arrangements[idx] = {
                    "package_index": idx,
                    "position": {"x": 0.0, "y": 0.0, "z": 0.0},
                    "rotated": False,
                    "orientation": None,
                    "fits": False,
                }
                unpacked.append(idx)
                continue

            new_shelf = _Shelf(z_offset, truck_l, truck_w, truck_h - z_offset)
            pos = new_shelf.try_place(pkg_length, pkg_width, pkg_height)
            if pos is not None:
                arrangements[idx] = {
                    "package_index": idx,
                    "position": {"x": round(pos["x"], 4), "y": round(pos["y"], 4), "z": round(pos["z"], 4)},
                    "rotated": pos["rotated"],
                    "orientation": pos["orientation"],
                    "fits": True,
                }
                packed_weight += pkg_weight
                packed_volume += pkg_length * pkg_width * pkg_height
                shelves.append(new_shelf)
            else:
                arrangements[idx] = {
                    "package_index": idx,
                    "position": {"x": 0.0, "y": 0.0, "z": 0.0},
                    "rotated": False,
                    "orientation": None,
                    "fits": False,
                }
                unpacked.append(idx)

    utilization = round((packed_volume / truck_volume) * 100.0, 2) if truck_volume > 0 else 0.0
    return arrangements, sorted(unpacked), utilization


def _validate_delivery_addresses(
    delivery_addresses: List[Dict[str, float]],
) -> None:
    """Validate delivery coordinates before any distance calculations."""
    for index, address in enumerate(delivery_addresses):
        for axis, lower, upper in (
            ("lat", -90.0, 90.0),
            ("lng", -180.0, 180.0),
        ):
            if axis not in address:
                raise ValueError(
                    f"delivery_addresses[{index}].{axis} is required"
                )

            value = address[axis]
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ValueError(
                    f"delivery_addresses[{index}].{axis} must be a finite number"
                )

            value = float(value)
            if not math.isfinite(value):
                raise ValueError(
                    f"delivery_addresses[{index}].{axis} must be a finite number"
                )
            if not lower <= value <= upper:
                raise ValueError(
                    f"delivery_addresses[{index}].{axis} must be between "
                    f"{lower} and {upper}"
                )


# ---------------------------------------------------------------------------
# Nearest-neighbour stop sequencing
# ---------------------------------------------------------------------------


def _sequence_stops(
    delivery_addresses: List[Dict[str, float]],
    packed_indices: List[int],
    route_start: Dict[str, float],
) -> List[int]:
    """Order packed delivery stops using nearest-neighbour from the route start."""
    if not packed_indices:
        return []

    _validate_route_start(route_start)
    if any(index < 0 or index >= len(delivery_addresses) for index in packed_indices):
        raise ValueError("packed_indices contains an address index outside delivery_addresses")

    current_lat = route_start["lat"]
    current_lng = route_start["lng"]
    remaining = set(packed_indices)
    sequence: List[int] = []

    while remaining:
        nearest = min(
            remaining,
            key=lambda i: (
                _haversine(
                    current_lat,
                    current_lng,
                    delivery_addresses[i]["lat"],
                    delivery_addresses[i]["lng"],
                ),
                i,
            ),
        )
        sequence.append(nearest)
        remaining.remove(nearest)
        current_lat = delivery_addresses[nearest]["lat"]
        current_lng = delivery_addresses[nearest]["lng"]

    return sequence


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def optimise_packing(
    packages: List[Dict[str, Any]],
    truck: Dict[str, Any],
    delivery_addresses: List[Dict[str, Any]],
    route_start: Dict[str, Any],
) -> Dict[str, Any]:
    """Pack shipments into a truck and determine delivery stop order from a depot.

    Parameters
    ----------
    packages : list[dict]
        Each dict has ``length``, ``width``, ``height``, ``weight`` (floats).
    truck : dict
        ``length``, ``width``, ``height``, ``max_weight`` (floats).
    delivery_addresses : list[dict]
        ``lat``, ``lng`` for each package (same index correspondence).
    route_start : dict
        ``lat``, ``lng`` for the truck's current route/depot start.

    Returns
    -------
    dict
        ``packing_arrangement`` – per-package placement info.
        ``unpacked_packages``   – indices that could not fit.
        ``stop_sequence``       – ordered package indices for delivery.
        ``utilization_pct``     – volume utilisation %.
    """
    _validate_route_start(route_start)

    if not packages:
        return {
            "packing_arrangement": [],
            "unpacked_packages": [],
            "stop_sequence": [],
            "utilization_pct": 0.0,
        }

    if not delivery_addresses and packages:
        raise ValueError(
            "delivery_addresses must contain at least one address when packages are provided"
        )
    if len(delivery_addresses) < len(packages):
        logger.warning(
            "Fewer delivery addresses (%d) than packages (%d); "
            "padding with first address.",
            len(delivery_addresses),
            len(packages),
        )
        while len(delivery_addresses) < len(packages):
            delivery_addresses.append(delivery_addresses[0])

    _validate_delivery_addresses(delivery_addresses)

    arrangements, unpacked, utilization = _pack_packages(packages, truck)

    packed_indices = [a["package_index"] for a in arrangements if a["fits"]]
    stop_sequence = _sequence_stops(delivery_addresses, packed_indices, route_start)

    logger.info(
        "Packing complete: %d packed, %d unpacked, %.1f%% utilisation",
        len(packed_indices),
        len(unpacked),
        utilization,
    )

    return {
        "packing_arrangement": arrangements,
        "unpacked_packages": unpacked,
        "stop_sequence": stop_sequence,
        "utilization_pct": utilization,
    }
