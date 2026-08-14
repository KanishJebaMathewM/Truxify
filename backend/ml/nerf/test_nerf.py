import unittest
from nerf_inspector import NerfContainerDamageInspector

class TestNeRFInspector(unittest.TestCase):
    def setUp(self):
        self.inspector = NerfContainerDamageInspector()

    def test_multi_view_3d_inspection(self):
        photos = ["hash_angle_front_001", "hash_angle_side_002", "hash_angle_top_003"]
        report = self.inspector.evaluate_container_damage(photos)
        
        self.assertEqual(report["views_processed"], 3)
        self.assertTrue(report["is_structural_damage_detected"])
        self.assertEqual(report["damage_severity"], "MODERATE")

    def test_insufficient_views_rejection(self):
        with self.assertRaises(ValueError):
            self.inspector.evaluate_container_damage(["single_photo_hash"])

if __name__ == '__main__':
    unittest.main()
