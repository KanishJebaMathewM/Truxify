"""Independent exact witnesses for public shelf packing geometry."""

import copy
import itertools
import json
import math
import random
from fractions import Fraction

import pytest
from app.models import bin_packing as packing


def package(scale=1.0, weight=1.0):
    return {"length": scale, "width": scale, "height": scale, "weight": weight}


def run(packages, truck):
    return packing.optimise_packing(
        packages,
        truck,
        [{"lat": 0.0, "lng": 0.0} for _ in packages],
        {"lat": 0.0, "lng": 0.0},
    )


def certify(result, packages, truck):
    """Reconstruct output boxes using original dimensions, never placement code."""
    boxes = []
    mass = Fraction(0)
    occupied = Fraction(0)
    for item in result["packing_arrangement"]:
        if not item["fits"]:
            continue
        p = packages[item["package_index"]]
        axes = [p[k] for k in ("length", "width", "height")]
        sides = [Fraction(axes[i]) for i in item["orientation"]]
        starts = [Fraction(item["position"][k]) for k in ("x", "y", "z")]
        ends = [a + b for a, b in zip(starts, sides)]
        assert all(
            a >= 0 and b <= Fraction(truck[k])
            for a, b, k in zip(starts, ends, ("length", "width", "height"))
        )
        boxes.append((starts, ends))
        mass += Fraction(p["weight"])
        occupied += math.prod(Fraction(v) for v in axes)
    for (a, b), (c, d) in itertools.combinations(boxes, 2):
        assert any(
            right <= other_left or other_right <= left
            for left, right, other_left, other_right in zip(a, b, c, d)
        )
    assert mass <= Fraction(truck["max_weight"])
    ratio = occupied / math.prod(
        Fraction(truck[k]) for k in ("length", "width", "height")
    )
    assert result["utilization_pct"] == round(float(100 * ratio), 2)
    json.dumps(result, allow_nan=False)


@pytest.mark.parametrize("scale", [1e-200, 1e-100, 0.00004, 0.1, 1.0, 1e100, 1e200])
def test_finite_exact_fit_and_emitted_geometry(scale):
    packages = [package(scale)] * 2
    truck = {"length": 2 * scale, "width": scale, "height": scale, "max_weight": 2.0}
    result = run(packages, truck)
    assert all(item["fits"] for item in result["packing_arrangement"])
    assert result["packing_arrangement"][1]["position"]["x"] == scale
    certify(result, packages, truck)


@pytest.mark.parametrize(
    "bad", [math.nan, math.inf, -math.inf, -1.0, True, "1", None, 10**400]
)
@pytest.mark.parametrize("field", ["length", "width", "height", "weight"])
def test_invalid_complete_input_precedes_placement(monkeypatch, bad, field):
    packages = [package(), package()]
    packages[-1][field] = bad

    def forbidden(*args, **kwargs):
        raise AssertionError("No placement before complete admission")

    monkeypatch.setattr(packing._Shelf, "try_place", forbidden)
    with pytest.raises(ValueError):
        run(packages, {"length": 3.0, "width": 3.0, "height": 3.0, "max_weight": 3.0})


@pytest.mark.parametrize("seed", range(20))
def test_random_output_exact_witness_and_input_ownership(seed):
    rng = random.Random(seed)
    packages = [
        dict(
            zip(
                ("length", "width", "height", "weight"),
                [rng.choice([0.00004, 0.1, 0.2, 0.3, 0.5, 1.0]) for _ in range(4)],
            )
        )
        for _ in range(160)
    ]
    truck = {"length": 3.0, "width": 2.0, "height": 5.0, "max_weight": 100.0}
    before = copy.deepcopy(packages)
    result = run(packages, truck)
    certify(result, packages, truck)
    assert packages == before


def test_rounded_weight_cannot_bypass_exact_capacity():
    packages = [package(0.1, 1.0), package(0.1, 1e-17)]
    truck = {"length": 1.0, "width": 1.0, "height": 1.0, "max_weight": 1.0}
    result = run(packages, truck)
    assert result["unpacked_packages"] == [1]
    certify(result, packages, truck)


def test_zero_mass_and_rotation_remain_supported():
    packages = [{"length": 3.0, "width": 1.0, "height": 2.0, "weight": 0.0}]
    truck = {"length": 1.0, "width": 2.0, "height": 3.0, "max_weight": 1.0}
    result = run(packages, truck)
    assert result["packing_arrangement"][0]["fits"]
    certify(result, packages, truck)


@pytest.mark.parametrize("field", ["length", "width", "height", "max_weight"])
@pytest.mark.parametrize("bad", [0.0, -1.0, math.nan, math.inf, True, None])
def test_invalid_truck_observation_precedes_placement(monkeypatch, field, bad):
    truck = {"length": 3.0, "width": 3.0, "height": 3.0, "max_weight": 3.0}
    truck[field] = bad

    def forbidden(*args, **kwargs):
        raise AssertionError("Truck must be admitted before placement")

    monkeypatch.setattr(packing._Shelf, "try_place", forbidden)
    with pytest.raises(ValueError):
        run([package()], truck)


@pytest.mark.parametrize("field", ["length", "width", "height"])
def test_zero_package_dimension_is_rejected(field):
    p = package()
    p[field] = 0.0
    with pytest.raises(ValueError):
        run([p], {"length": 3.0, "width": 3.0, "height": 3.0, "max_weight": 3.0})


def test_positive_tiny_cargo_cannot_round_into_an_occupied_edge():
    shelf = packing._Shelf(0.0, 1.0, 1.0, 1.0)
    assert shelf.try_place(1.0, 1.0, 1.0) is not None
    assert shelf.try_place(1e-17, 1.0, 1.0) is None
