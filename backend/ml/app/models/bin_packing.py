"""Bin Packing & Route Sequencing – packs shipments into a truck and orders stops.

Packing uses a **First-Fit Decreasing** (by volume) shelf-based placement
strategy.  Delivery-stop ordering uses a **nearest-neighbour greedy** heuristic
starting from the first delivery address.

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
        self.row_height = 0.0          # tallest item in current row
        self.row_width = 0.0           # max width used by any row so far
        self.items: List[dict] = []

    def try_place(self, length: float, width: float, height: float) -> dict | None:
        """Attempt to place an item; return position dict or *None*."""
        # Try both orientations (rotate length ↔ width)
        for rotated, l, w in [(False, length, width), (True, width, length)]:
            pos = self._fit(l, w, height, rotated)
            if pos is not None:
                return pos
        return None

    def _fit(self, l: float, w: float, h: float, rotated: bool) -> dict | None:
        # Does it fit in the remaining row?
        if self.cursor_x + l <= self.max_length and self.cursor_y + w <= self.max_width:
            pos = {"x": self.cursor_x, "y": self.cursor_y, "z": self.z_bottom}
            self.cursor_x += l
            self.row_height = max(self.row_height, h)
            self.shelf_height = max(self.shelf_height, h)
            self.items.append({"pos": pos, "rotated": rotated})
            return {**pos, "rotated": rotated}

        # Start a new row inside the same shelf
        new_y = self.cursor_y + self.row_height
        if new_y + w <= self.max_width and l <= self.max_length:
            self.cursor_x = l
            self.cursor_y = new_y
            self.row_height = h
            self.shelf_height = max(self.shelf_height, h)
            pos = {"x": 0.0, "y": new_y, "z": self.z_bottom}
            self.items.append({"pos": pos, "rotated": rotated})
            return {**pos, "rotated": rotated}

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
              "rotated": False, "fits": False} for i in range(len(packages))],
            list(range(len(packages))),
            0.0,
        )

    # Sort by volume descending (First-Fit Decreasing)
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

        # Weight check
        if packed_weight + pkg_weight > max_weight:
            arrangements[idx] = {
                "package_index": idx,
                "position": {"x": 0.0, "y": 0.0, "z": 0.0},
                "rotated": False,
                "fits": False,
            }
            unpacked.append(idx)
            continue

        placed = False
        for shelf in shelves:
            pos = shelf.try_place(pkg_length, pkg_width, pkg_height)
            if pos is not None:
                arrangements[idx] = {
                    "package_index": idx,
                    "position": {"x": round(pos["x"], 4), "y": round(pos["y"], 4), "z": round(pos["z"], 4)},
                    "rotated": pos["rotated"],
                    "fits": True,
                }
                packed_weight += pkg_weight
                packed_volume += pkg_length * pkg_width * pkg_height
                placed = True
                break

        if not placed:
            # Open a new shelf
            z_offset = sum(s.shelf_height for s in shelves)
            if z_offset + pkg_height > truck_h:
                arrangements[idx] = {
                    "package_index": idx,
                    "position": {"x": 0.0, "y": 0.0, "z": 0.0},
                    "rotated": False,
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
                    "fits": False,
                }
                unpacked.append(idx)

    utilization = round((packed_volume / truck_volume) * 100.0, 2) if truck_volume > 0 else 0.0
    return arrangements, sorted(unpacked), utilization


# ---------------------------------------------------------------------------
# Nearest-neighbour stop sequencing
# ---------------------------------------------------------------------------


def _sequence_stops(delivery_addresses: List[Dict[str, float]], packed_indices: List[int]) -> List[int]:
    """Order *packed* delivery stops using nearest-neighbour from the first address.

    Parameters
    ----------
    delivery_addresses : list[dict]
        Each dict has ``lat`` and ``lng``, indexed parallel to packages.
    packed_indices : list[int]
        Indices of packages that were actually packed.

    Returns
    -------
    list[int]
        Package indices in optimised delivery order.
    """
    if not packed_indices:
        return []

    remaining = set(packed_indices)
    # Start from the first packed package's address
    current_idx = packed_indices[0]
    sequence = [current_idx]
    remaining.discard(current_idx)

    while remaining:
        cur = delivery_addresses[current_idx]
        nearest = min(
            remaining,
            key=lambda i: _haversine(cur["lat"], cur["lng"],
                                     delivery_addresses[i]["lat"],
                                     delivery_addresses[i]["lng"]),
        )
        sequence.append(nearest)
        remaining.discard(nearest)
        current_idx = nearest

    return sequence


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def optimise_packing(
    packages: List[Dict[str, Any]],
    truck: Dict[str, Any],
    delivery_addresses: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Pack shipments into a truck and determine delivery stop order.

    Parameters
    ----------
    packages : list[dict]
        Each dict has ``length``, ``width``, ``height``, ``weight`` (floats).
    truck : dict
        ``length``, ``width``, ``height``, ``max_weight`` (floats).
    delivery_addresses : list[dict]
        ``lat``, ``lng`` for each package (same index correspondence).

    Returns
    -------
    dict
        ``packing_arrangement`` – per-package placement info.
        ``unpacked_packages``   – indices that could not fit.
        ``stop_sequence``       – ordered package indices for delivery.
        ``utilization_pct``     – volume utilisation %.
    """
    # Edge cases
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

    arrangements, unpacked, utilization = _pack_packages(packages, truck)

    packed_indices = [a["package_index"] for a in arrangements if a["fits"]]
    stop_sequence = _sequence_stops(delivery_addresses, packed_indices)

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
