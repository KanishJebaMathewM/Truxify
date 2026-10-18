"""Independent exact output witnesses and native extreme-point controls."""

import copy
import json
import math
from fractions import Fraction
from itertools import product

import pytest
from services.bin_packing_3d import BinPacking3D
from services.packing_support import supported


def item(name="box", **fields):
    return dict(id=name, length=1, width=1, height=1, weight_kg=1,
                allow_rotation=False, **fields)


def box(name, x, y, z, l=1, w=1, h=1, stackable=True, fragile=False):
    return {"id": name, "position": {"x": x, "y": y, "z": z}, "dimensions": {"l": l, "w": w, "h": h},
            "stackable": stackable, "fragile": fragile}


def witness(result):
    """Independent Fraction cell-midpoint support oracle, not production sweep."""
    boxes = result["packed_items"]
    capacity = result["container"]
    bounds = []
    for b in boxes:
        lo = tuple(Fraction(b["position"][k]) for k in "xyz")
        hi = tuple(lo[i] + Fraction(b["dimensions"][k]) for i, k in enumerate("lwh"))
        assert all(0 <= lo[i] < hi[i] <= Fraction(capacity[k]) for i, k in enumerate(("length", "width", "height")))
        bounds.append((lo, hi))
    for i, (lo, hi) in enumerate(bounds):
        for other, (a, b) in enumerate(bounds):
            if other != i:
                assert any(hi[d] <= a[d] or lo[d] >= b[d] for d in range(3))
        if not lo[2]:
            continue
        below = [(a, b) for j, (a, b) in enumerate(bounds)
                 if b[2] == lo[2] and boxes[j]["stackable"] and not boxes[j]["fragile"]]
        xs = sorted({lo[0], hi[0], *(v for a, b in below for v in (a[0], b[0]) if lo[0] < v < hi[0])})
        ys = sorted({lo[1], hi[1], *(v for a, b in below for v in (a[1], b[1]) if lo[1] < v < hi[1])})
        for xi, yi in product(range(len(xs)-1), range(len(ys)-1)):
            x, y = (xs[xi]+xs[xi+1])/2, (ys[yi]+ys[yi+1])/2
            assert any(a[0] <= x <= b[0] and a[1] <= y <= b[1] for a, b in below)
    assert sum(Fraction(b["weight_kg"]) for b in boxes) <= Fraction(capacity["max_weight_kg"])
    json.dumps(result, allow_nan=False)


def test_native_overhang_is_rejected():
    result = BinPacking3D(2, 1, 2, 100).pack([
        dict(item("base"), weight_kg=20), dict(item("overhang"), length=2, weight_kg=5)])
    assert not result["success"]
    assert [b["id"] for b in result["packed_items"]] == ["base"]
    witness(result)


def test_positive_submillimeter_geometry_is_preserved():
    result = BinPacking3D(1, 1, 1, 100).pack([dict(item(), length=.0004)])
    assert result["packed_items"][0]["dimensions"]["l"] == .0004
    witness(result)


def test_rounded_output_can_no_longer_create_overlap():
    result = BinPacking3D(1, 1, 1, 100).pack([dict(item(str(i)), length=.3336) for i in range(3)])
    assert result["statistics"]["packed_count"] == 2
    witness(result)


@pytest.mark.parametrize("fragile,stackable", [(True, True), (False, False)])
def test_fragile_or_nonstackable_base_prohibits_upper_cargo(fragile, stackable):
    result = BinPacking3D(1,1,2,100).pack([
        dict(item("base"), weight_kg=20, fragile=fragile, stackable=stackable), item("upper")])
    assert not result["success"]
    witness(result)


def test_floor_contacts_and_rotation_remain_available():
    result = BinPacking3D(2,1,1,10).pack([dict(item(), length=1, width=2, allow_rotation=True)])
    assert result["success"]
    assert result["packed_items"][0]["dimensions"] == {"l": 2., "w": 1., "h": 1.}
    witness(result)


def test_support_union_accepts_joint_tiles_not_single_box_only():
    supports = [box("left",0,0,0), box("right",1,0,0)]
    assert supported((0,0,1),(2,1,1),supports,(2,1,2))


@pytest.mark.parametrize("gap", [.01, 2**-40])
def test_support_union_rejects_tiny_gaps_without_epsilon(gap):
    supports = [box("left",0,0,0,l=1-gap), box("right",1,0,0)]
    assert not supported((0,0,1),(2,1,1),supports,(2,1,2))


def test_support_union_checks_both_axes_and_uneven_planes():
    assert not supported((0,0,1),(1,2,1),[box("base",0,0,0)],(1,2,2))
    assert not supported((0,0,1),(2,1,1),[box("a",0,0,0),box("b",1,0,0,h=.5)],(2,1,2))
    assert supported((0,0,1),(1,2,1),[box("a",0,0,0),box("b",0,1,0)],(1,2,2))


@pytest.mark.parametrize("field", ["length","width","height","weight_kg"])
@pytest.mark.parametrize("bad", [float('nan'), float('inf'), -1, True])
def test_complete_invalid_batch_rejected_before_packing(field, bad):
    packer=BinPacking3D()
    values=[item("valid"), dict(item("invalid"), **{field:bad})]
    with pytest.raises(ValueError):
        packer.pack(values)
    assert packer.pack([item()])["success"]


@pytest.mark.parametrize("field", ["stackable","fragile","allow_rotation"])
def test_flags_cannot_be_truthy_strings(field):
    with pytest.raises(ValueError,match=field):
        BinPacking3D().pack([dict(item(), **{field:"false"})])


@pytest.mark.parametrize("args", [(0,1,1,1),(1,float('inf'),1,1),(1,1,1,0),(1e200,1e200,1,1)])
def test_invalid_container_or_unrepresentable_volume_rejected(args):
    with pytest.raises(ValueError):
        BinPacking3D(*args)


def test_input_ownership_and_stable_default_ids():
    values=[{"length": 2, "width": 1, "height": 1, "weight_kg": 1}, {"length": 1, "width": 1, "height": 1, "weight_kg": 20}]
    before=copy.deepcopy(values)
    result=BinPacking3D(3,1,1,100).pack(values)
    assert values==before
    assert [b['id'] for b in result['packed_items']]==['item_1','item_0']
    witness(result)


def test_native_extreme_point_grid_witnesses():
    for count in range(1,28):
        result=BinPacking3D(3,3,3,100).pack([item(str(i)) for i in range(count)])
        assert result['success']
        assert result['statistics']['packed_count']==count
        witness(result)


def test_huge_finite_weight_and_moments_do_not_overflow():
    result=BinPacking3D(4,1,1,1e308).pack([dict(item('heavy'),weight_kg=9e307)])
    assert result['success']
    assert math.isfinite(result['statistics']['center_of_gravity_x_m'])
    witness(result)


def test_zero_weight_and_empty_batches_are_finite():
    for values in ([],[dict(item(),weight_kg=0)]):
        result=BinPacking3D().pack(values)
        assert result['success']
        witness(result)


def test_independent_integer_support_grid_enumeration():
    tiles=[box(str(i),x,y,0) for i,(x,y) in enumerate(product(range(2),repeat=2))]
    for mask in range(16):
        selected=[tile for i,tile in enumerate(tiles) if mask & (1 << i)]
        assert supported((0,0,1),(2,2,1),selected,(2,2,2)) == (mask == 15)


def test_invalid_represented_decimal_contact_is_rejected_conservatively():
    # Binary .1+.2 is not the exact sum of the two emitted observations.
    assert not supported((0,0,.1+.2),(1,1,.1),[box('base',0,0,.1,h=.2)],(1,1,1))
