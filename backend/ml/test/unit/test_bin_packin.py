import pytest
from backend.ml.models.bin_packing import BinPackingEngine, Container, Item

def test_bin_packing_successful_fit():
    engine = BinPackingEngine()
    container = Container(length=500, width=200, height=200, max_weight=5000)
    items = [
        Item("box-1", length=100, width=100, height=100, weight=500),
        Item("box-2", length=150, width=100, height=100, weight=800)
    ]
    
    result = engine.pack_cargo(container, items)
    
    assert result["success"] is True
    assert len(result["packed_items"]) == 2
    assert result["utilization_percentage"] > 0
    assert "axle_weight_distribution" in result

def test_bin_packing_weight_overflow():
    engine = BinPackingEngine()
    container = Container(length=500, width=200, height=200, max_weight=1000)
    items = [
        Item("heavy-box", length=100, width=100, height=100, weight=1200)
    ]
    
    result = engine.pack_cargo(container, items)
    
    assert result["success"] is False
    assert "heavy-box" in result["unpacked_items"]

def test_corridor_arbitrage_filtering():
    engine = BinPackingEngine()
    consignments = [
        {"id": "c1", "route_deviation_km": 5.2, "revenue": 1200},
        {"id": "c2", "route_deviation_km": 25.0, "revenue": 3000}, # Exceeds 15km threshold
    ]
    
    recommendations = engine.evaluate_corridor_arbitrage({"lat": 13.0, "lng": 80.0}, consignments)
    
    assert len(recommendations) == 1
    assert recommendations[0]["consignment_id"] == "c1"111111
