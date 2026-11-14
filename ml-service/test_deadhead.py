from fastapi import FastAPI
from fastapi.testclient import TestClient
from routers.deadhead import router

app = FastAPI()
app.include_router(router)
client = TestClient(app)

def test_get_en_route_loads_success():
    response = client.get("/ml/en-route-loads?driverId=driver_123&currentLat=13.0827&currentLng=80.2707")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["driverId"] == "driver_123"
    assert len(data["loads"]) == 2
    first_load = data["loads"][0]
    assert first_load["loadId"] == "load_901"
    assert "detourKm" in first_load
    assert "extraEarnings" in first_load

def test_get_en_route_loads_missing_parameters():
    response = client.get("/ml/en-route-loads")
    assert response.status_code == 422

def test_get_en_route_loads_invalid_coordinates():
    response = client.get("/ml/en-route-loads?driverId=driver_123&currentLat=invalid&currentLng=80.2707")
    assert response.status_code == 422
