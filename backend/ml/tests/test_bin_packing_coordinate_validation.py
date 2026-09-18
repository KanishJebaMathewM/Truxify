import math
import re

import pytest

from app.models.bin_packing import optimise_packing


def _valid_payload():
    return (
        [{
            "length": 1.0,
            "width": 1.0,
            "height": 1.0,
            "weight": 10.0,
        }],
        {
            "length": 6.0,
            "width": 2.5,
            "height": 2.5,
            "max_weight": 100.0,
        },
    )


@pytest.mark.parametrize(
    ("address", "expected_fragment"),
    [
        ({"lng": 72.877}, "delivery_addresses[0].lat"),
        ({"lat": 19.076}, "delivery_addresses[0].lng"),
        ({"lat": math.nan, "lng": 72.877}, "delivery_addresses[0].lat"),
        ({"lat": math.inf, "lng": 72.877}, "delivery_addresses[0].lat"),
        ({"lat": 19.076, "lng": math.inf}, "delivery_addresses[0].lng"),
        ({"lat": 91.0, "lng": 72.877}, "delivery_addresses[0].lat"),
        ({"lat": -91.0, "lng": 72.877}, "delivery_addresses[0].lat"),
        ({"lat": 19.076, "lng": 181.0}, "delivery_addresses[0].lng"),
        ({"lat": 19.076, "lng": -181.0}, "delivery_addresses[0].lng"),
        ({"lat": "invalid", "lng": 72.877}, "delivery_addresses[0].lat"),
    ],
)
def test_invalid_delivery_coordinates_fail_before_sequencing(address, expected_fragment):
    packages, truck = _valid_payload()

    with pytest.raises(ValueError, match=re.escape(expected_fragment)):
        optimise_packing(packages, truck, [address])


def test_boundary_valid_delivery_coordinates_are_accepted():
    packages, truck = _valid_payload()

    result = optimise_packing(
        packages,
        truck,
        [{"lat": 90.0, "lng": -180.0}],
    )

    assert result["stop_sequence"] == [0]
