import pytest

from app.models.bin_packing import optimise_packing


def make_packages(count):
    return [
        {"length": 1.0, "width": 1.0, "height": 1.0, "weight": 1.0}
        for _ in range(count)
    ]


def make_truck():
    return {"length": 10.0, "width": 3.0, "height": 3.0, "max_weight": 100.0}


def make_addresses(count):
    return [{"lat": 12.97 + i * 0.01, "lng": 77.59 + i * 0.01} for i in range(count)]


def test_short_address_list_raises():
    with pytest.raises(ValueError, match="exactly one address per package"):
        optimise_packing(make_packages(2), make_truck(), make_addresses(1))


def test_long_address_list_raises():
    with pytest.raises(ValueError, match="exactly one address per package"):
        optimise_packing(make_packages(1), make_truck(), make_addresses(2))
