"""Differential placement and scaling regressions for ordered shelf search.

The linear oracle below is the unchanged _pack_packages body from main
06da794fd3369ee86e3d062056ec8ecc2ebc121a. It uses the unchanged shelf
placement authority; no index/search implementation is shared with the oracle.
"""

import math
import random
from types import SimpleNamespace

import pytest
from app.models import bin_packing as packing


def _linear_pack(
    packages: list[dict],
    truck: dict[str, float],
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

    shelves: list[packing._Shelf] = []
    arrangements = [None] * len(packages)
    unpacked: list[int] = []
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

            new_shelf = packing._Shelf(z_offset, truck_l, truck_w, truck_h - z_offset)
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


def _packages(count, seed):
    """Build repeatable mixed, rotated, overweight and floating-point cases."""
    rng = random.Random(seed)
    dimensions = [0.01, 0.1, 0.3, 0.5, 1.0, 1.5, 2.0, 3.0]
    return [
        dict(zip(("length", "width", "height", "weight"),
                 [rng.choice(dimensions) for _ in range(3)] + [rng.choice([1.0, 3.0, 25.0])]))
        for _ in range(count)
    ]


@pytest.mark.parametrize("seed", range(30))
def test_complete_outputs_match_frozen_linear_oracle(seed):
    """Retain arrangement, orientation, unpacked order and utilization exactly."""
    packages = _packages(180 + seed, seed)
    truck = {"length": 3.0, "width": 2.0, "height": 8.0 + seed, "max_weight": 300.0 + seed * 10}
    assert packing._pack_packages(packages, truck) == _linear_pack(packages, truck)


@pytest.mark.parametrize("count", [200, 400, 800, 1600])
def test_exhausted_shelves_have_linear_placement_attempts(monkeypatch, count):
    """Count actual placement work independently of wall-clock measurements."""
    calls = 0
    original = packing._Shelf.try_place

    def counted(*args, **kwargs):
        """Count calls to the original placement authority."""
        nonlocal calls
        calls += 1
        return original(*args, **kwargs)

    monkeypatch.setattr(packing._Shelf, "try_place", counted)
    packages = [{"length": 1.0, "width": 1.0, "height": 1.0, "weight": 1.0}] * count
    truck = {"length": 1.0, "width": 1.0, "height": float(count), "max_weight": float(count)}
    result = packing._pack_packages(packages, truck)
    assert result[1] == []
    assert result[2] == 100.0
    assert calls <= 2 * count


@pytest.mark.parametrize("dimension", [0.001, 0.1, 0.3, 1.0, math.nextafter(1.0, 0.0)])
def test_many_shelf_z_positions_keep_original_summation(dimension):
    """Do not reassociate height sums or change rounded z positions."""
    packages = [{"length": 1.0, "width": 1.0, "height": dimension, "weight": 1.0}] * 220
    truck = {"length": 1.0, "width": 1.0, "height": 240 * dimension, "max_weight": 220.0}
    assert packing._pack_packages(packages, truck) == _linear_pack(packages, truck)


@pytest.mark.parametrize("value", [0.0, -1.0, math.inf])
def test_unsupported_inputs_keep_linear_scan(monkeypatch, value):
    """Keep legacy arithmetic/fit behavior rather than applying index bounds."""
    def forbidden(*args, **kwargs):
        """Fail if unsupported input creates a feasibility index."""
        raise AssertionError("legacy input must retain scan")

    monkeypatch.setattr(packing, "ShelfFitIndex", forbidden)
    packages = [{"length": 1.0, "width": 1.0, "height": 1.0, "weight": value}] * 128
    truck = {"length": 2.0, "width": 2.0, "height": 32.0, "max_weight": 256.0}
    assert packing._pack_packages(packages, truck) == _linear_pack(packages, truck)


def test_small_inputs_do_not_allocate_index(monkeypatch):
    """Avoid data-structure overhead for typical short input lists."""
    def forbidden(*args, **kwargs):
        """Fail if small input creates a feasibility index."""
        raise AssertionError("small input must retain scan")

    monkeypatch.setattr(packing, "ShelfFitIndex", forbidden)
    packages = _packages(127, 42)
    truck = {"length": 3.0, "width": 2.0, "height": 8.0, "max_weight": 300.0}
    assert packing._pack_packages(packages, truck) == _linear_pack(packages, truck)


def test_rounding_accepted_tiny_item_remains_a_candidate():
    """Raw subtraction would prune a fit whose addition rounds to the limit."""
    from app.models._shelf_fit_index import ShelfFitIndex

    shelf = packing._Shelf(0.0, 1.0, 1.0, 1.0)
    shelf.cursor_x = 1.0
    shelf.row_height = 1.0
    index = ShelfFitIndex(1, 1.0)
    index.update(0, shelf, 1.0)
    dimensions = (1e-17, 1.0, 1.0)
    assert index.find_first(dimensions) == 0
    assert shelf.try_place(*dimensions) is not None


def test_false_positive_does_not_hide_later_shelf():
    """Independent subtree maxima must preserve ordered leaf enumeration."""
    from app.models._shelf_fit_index import ShelfFitIndex

    index = ShelfFitIndex(4, 4.0)
    for i, (x, y) in enumerate([(3.5, 0.0), (0.0, 3.5), (0.0, 0.0)]):
        shelf = SimpleNamespace(max_length=4.0, max_width=4.0, cursor_x=x,
                                cursor_y=y, row_height=4.0, shelf_height=1.0)
        index.update(i, shelf, 1.0)
    assert index.find_first((2.0, 2.0, 1.0)) == 2
    assert index.find_first((2.0, 2.0, 1.0), start=3) is None


def test_freezing_previous_clearance_revokes_height_candidate():
    """Appending above a shelf must exclude orientations that would overlap it."""
    from app.models._shelf_fit_index import ShelfFitIndex

    shelf = packing._Shelf(0.0, 3.0, 3.0, 10.0)
    shelf.shelf_height = 1.0
    index = ShelfFitIndex(2, 3.0)
    index.update(0, shelf, 10.0)
    assert index.find_first((2.0, 2.0, 2.0)) == 0
    index.update(0, shelf, 1.0)
    assert index.find_first((2.0, 2.0, 2.0)) is None


@pytest.mark.parametrize("seed", range(20))
def test_fragmented_roomy_trucks_match_linear_oracle(seed):
    """Exercise sustained shelf reuse rather than mostly weight rejection."""
    packages = _packages(350, seed + 100)
    truck = {"length": 1.5 + (seed % 4), "width": 1.0 + (seed % 3),
             "height": 80.0, "max_weight": 100000.0}
    assert packing._pack_packages(packages, truck) == _linear_pack(packages, truck)
