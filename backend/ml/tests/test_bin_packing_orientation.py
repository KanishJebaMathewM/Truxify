from itertools import permutations

from app.models.bin_packing import optimise_packing


def test_packing_reports_selected_axis_orientation_for_all_six_permutations():
    package = {
        "length": 1.0,
        "width": 2.0,
        "height": 3.0,
        "weight": 10.0,
    }
    original_dims = (
        package["length"],
        package["width"],
        package["height"],
    )

    for truck_dims in permutations(original_dims):
        truck = {
            "length": truck_dims[0],
            "width": truck_dims[1],
            "height": truck_dims[2],
            "max_weight": 100.0,
        }
        result = optimise_packing(
            [package.copy()],
            truck,
            [{"lat": 19.076, "lng": 72.877}],
        )

        arrangement = result["packing_arrangement"][0]
        assert arrangement["fits"] is True
        assert len(arrangement["orientation"]) == 3
        assert sorted(arrangement["orientation"]) == [0, 1, 2]

        selected_dims = tuple(original_dims[i] for i in arrangement["orientation"])
        assert selected_dims == truck_dims
        assert arrangement["rotated"] == (
            arrangement["orientation"] != [0, 1, 2]
        )


def test_unpacked_package_reports_no_selected_orientation():
    result = optimise_packing(
        [{
            "length": 4.0,
            "width": 4.0,
            "height": 4.0,
            "weight": 10.0,
        }],
        {
            "length": 1.0,
            "width": 1.0,
            "height": 1.0,
            "max_weight": 100.0,
        },
        [{"lat": 19.076, "lng": 72.877}],
    )

    arrangement = result["packing_arrangement"][0]
    assert arrangement["fits"] is False
    assert arrangement["orientation"] is None
