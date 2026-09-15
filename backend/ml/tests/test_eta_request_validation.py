import pytest
from pydantic import ValidationError

from routes.eta_routes import ETARequest


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("source_lat", 90.000001),
        ("source_lat", -90.000001),
        ("source_lng", 180.000001),
        ("source_lng", -180.000001),
        ("dest_lat", 90.000001),
        ("dest_lat", -90.000001),
        ("dest_lng", 180.000001),
        ("dest_lng", -180.000001),
        ("source_lat", float("inf")),
        ("source_lng", float("-inf")),
        ("dest_lat", float("nan")),
        ("dest_lng", float("nan")),
    ],
)
def test_eta_request_rejects_invalid_geographic_coordinates(field, value):
    payload = {
        "order_id": "ORDER-123",
        "source_lat": 28.6139,
        "source_lng": 77.2090,
        "dest_lat": 28.7041,
        "dest_lng": 77.1025,
    }
    payload[field] = value

    with pytest.raises(ValidationError):
        ETARequest.model_validate(payload)


def test_eta_request_accepts_coordinates_at_valid_boundaries():
    request = ETARequest(
        order_id="ORDER-123",
        source_lat=-90,
        source_lng=-180,
        dest_lat=90,
        dest_lng=180,
    )

    assert request.source_lat == -90
    assert request.source_lng == -180
    assert request.dest_lat == 90
    assert request.dest_lng == 180
