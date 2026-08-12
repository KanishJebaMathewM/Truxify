import os
import sys
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from main import app

client = TestClient(app, headers={'X-API-Key': 'test_key'})


def packing_payload():
    return {
        "packages": [
            {"length": 1.0, "width": 1.0, "height": 1.0, "weight": 100.0},
            {"length": 0.5, "width": 0.5, "height": 0.5, "weight": 50.0},
        ],
        "truck": {"length": 6.0, "width": 2.5, "height": 2.5, "max_weight": 10000.0},
        "delivery_addresses": [
            {"lat": 19.076, "lng": 72.877},
            {"lat": 28.614, "lng": 77.209},
        ],
    }


def test_packing_valid():
    response = client.post("/optimise/packing", json=packing_payload())
    assert response.status_code == 200
    data = response.json()
    assert "packing_arrangement" in data
    assert "unpacked_packages" in data
    assert "stop_sequence" in data
    assert "utilization_pct" in data


def test_packing_single_package():
    payload = packing_payload()
    payload["packages"] = payload["packages"][:1]
    payload["delivery_addresses"] = payload["delivery_addresses"][:1]
    response = client.post("/optimise/packing", json=payload)
    assert response.status_code == 200


def test_packing_oversized_package():
    payload = packing_payload()
    # Add an oversized package
    payload["packages"].append(
        {"length": 10.0, "width": 3.0, "height": 3.0, "weight": 500.0}
    )
    payload["delivery_addresses"].append({"lat": 12.971, "lng": 77.594})
    response = client.post("/optimise/packing", json=payload)
    assert response.status_code == 200
    data = response.json()
    # The oversized package should be unpacked because it exceeds truck dimensions
    assert len(data["unpacked_packages"]) > 0


def test_packing_invalid_zero_dimension():
    payload = packing_payload()
    payload["packages"][0]["length"] = 0
    response = client.post("/optimise/packing", json=payload)
    assert response.status_code == 422


def test_packing_auth_missing(monkeypatch):
    monkeypatch.setenv("ML_API_KEY", "test-secret-key")
    response = client.post("/optimise/packing", json=packing_payload())
    assert response.status_code == 401


def test_packing_auth_valid(monkeypatch):
    monkeypatch.setenv("ML_API_KEY", "test-secret-key")
    response = client.post(
        "/optimise/packing",
        json=packing_payload(),
        headers={"X-API-Key": "test-secret-key"},
    )
    assert response.status_code == 200


def test_packing_no_3d_shelf_height_overlaps():
    """Verify that lower shelves never retroactively expand vertically past upper shelves' z_bottom."""
    payload = {
        "packages": [
            {"length": 8.0, "width": 8.0, "height": 4.0, "weight": 10.0},
            {"length": 8.0, "width": 8.0, "height": 2.0, "weight": 10.0},
            {"length": 1.0, "width": 1.0, "height": 5.0, "weight": 10.0},
        ],
        "truck": {"length": 10.0, "width": 10.0, "height": 10.0, "max_weight": 1000.0},
        "delivery_addresses": [
            {"lat": 19.0, "lng": 72.0},
            {"lat": 19.1, "lng": 72.1},
            {"lat": 19.2, "lng": 72.2},
        ],
    }
    response = client.post("/optimise/packing", json=payload)
    assert response.status_code == 200
    data = response.json()
    arrangements = data["packing_arrangement"]

    def is_3d_overlap(b1, b2):
        x_overlap = not (b1["x_max"] <= b2["x_min"] or b2["x_max"] <= b1["x_min"])
        y_overlap = not (b1["y_max"] <= b2["y_min"] or b2["y_max"] <= b1["y_min"])
        z_overlap = not (b1["z_max"] <= b2["z_min"] or b2["z_max"] <= b1["z_min"])
        return x_overlap and y_overlap and z_overlap

    boxes = []
    for item in arrangements:
        if item["fits"]:
            pkg = payload["packages"][item["package_index"]]
            l, w, h = (pkg["width"], pkg["length"], pkg["height"]) if item["rotated"] else (pkg["length"], pkg["width"], pkg["height"])
            pos = item["position"]
            boxes.append({
                "index": item["package_index"],
                "x_min": pos["x"], "x_max": pos["x"] + l,
                "y_min": pos["y"], "y_max": pos["y"] + w,
                "z_min": pos["z"], "z_max": pos["z"] + h,
            })

    overlaps_3d = []
    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            if is_3d_overlap(boxes[i], boxes[j]):
                overlaps_3d.append((boxes[i]["index"], boxes[j]["index"]))

    assert len(overlaps_3d) == 0, f"Found 3D overlaps: {overlaps_3d}"

