"""Unit tests for Model #16 Cargo & Payload Multi-Load Optimiser."""

import unittest
from ml.routers.load_optimiser import (
    LoadItem,
    LoadOptimiserInput,
    solve_load_optimisation,
    sequence_stops,
    haversine_km,
)


class TestLoadOptimiser(unittest.TestCase):
    def setUp(self):
        self.driver_location = (19.0760, 72.8777)  # Mumbai
        self.loads = [
            LoadItem(
                load_id="L1",
                weight_kg=3000,
                volume_m3=12,
                origin=[19.0760, 72.8777],      # Mumbai
                destination=[18.5204, 73.8567], # Pune
                freight_amount=8000,
            ),
            LoadItem(
                load_id="L2",
                weight_kg=4000,
                volume_m3=15,
                origin=[19.0330, 73.0297],      # Navi Mumbai
                destination=[18.5204, 73.8567], # Pune
                freight_amount=10000,
            ),
            LoadItem(
                load_id="L3",
                weight_kg=2000,
                volume_m3=8,
                origin=[19.2183, 72.9781],      # Thane
                destination=[18.6279, 73.7997], # Pimpri-Chinchwad
                freight_amount=6000,
            ),
            LoadItem(
                load_id="L4_oversized",
                weight_kg=15000,                # Exceeds 10,000kg
                volume_m3=50,                   # Exceeds 40m3
                origin=[19.0760, 72.8777],
                destination=[18.5204, 73.8567],
                freight_amount=30000,
            ),
        ]

    def test_haversine_distance(self):
        # Distance between Mumbai and Pune is approx 120-150 km
        dist = haversine_km(19.0760, 72.8777, 18.5204, 73.8567)
        self.assertGreater(dist, 100)
        self.assertLess(dist, 150)

    def test_multi_load_packing_and_ranking(self):
        truck_payload = 10000
        truck_volume = 40

        combinations = solve_load_optimisation(
            truck_payload_kg=truck_payload,
            truck_volume_m3=truck_volume,
            available_loads=self.loads,
            driver_location=self.driver_location,
            top_k=5,
        )

        self.assertGreater(len(combinations), 0)
        top_combo = combinations[0]

        # Verify oversized load is excluded
        self.assertNotIn("L4_oversized", top_combo.load_ids)

        # L1 (3000kg) + L2 (4000kg) + L3 (2000kg) = 9000kg <= 10000kg
        # Volumes: 12 + 15 + 8 = 35m3 <= 40m3
        # Freight: 8000 + 10000 + 6000 = 24000
        self.assertLessEqual(top_combo.total_weight_kg, truck_payload)
        self.assertLessEqual(top_combo.total_volume_m3, truck_volume)
        self.assertGreaterEqual(top_combo.total_freight_amount, 10000)
        self.assertGreater(top_combo.payload_fill_percent, 0)
        self.assertLessEqual(top_combo.payload_fill_percent, 100)

        # Verify route stops sequencing
        self.assertGreater(len(top_combo.route_sequence), 2)
        self.assertEqual(top_combo.route_sequence[0].type, "start")

        # Ensure for every load, pickup precedes delivery
        seen_pickups = set()
        for stop in top_combo.route_sequence:
            if stop.type == "pickup":
                seen_pickups.add(stop.load_id)
            elif stop.type == "destination":
                self.assertIn(
                    stop.load_id,
                    seen_pickups,
                    f"Destination for {stop.load_id} appeared before its pickup!",
                )

    def test_empty_available_loads(self):
        combinations = solve_load_optimisation(
            truck_payload_kg=10000,
            truck_volume_m3=40,
            available_loads=[],
            driver_location=self.driver_location,
        )
        self.assertEqual(len(combinations), 0)

    def test_all_loads_oversized(self):
        combinations = solve_load_optimisation(
            truck_payload_kg=1000,  # Very small truck
            truck_volume_m3=5,
            available_loads=self.loads,
            driver_location=self.driver_location,
        )
        self.assertEqual(len(combinations), 0)


if __name__ == "__main__":
    unittest.main()
