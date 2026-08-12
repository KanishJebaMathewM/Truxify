import unittest
from psi_matcher import PrivateSetIntersectionMatcher

class TestPSI(unittest.TestCase):
    def setUp(self):
        self.matcher = PrivateSetIntersectionMatcher()

    def test_intersection_matching(self):
        shipper_routes = ["DELHI-MUMBAI", "CHENNAI-BANGALORE", "KOLKATA-PATNA"]
        carrier_routes = ["MUMBAI-PUNE", "CHENNAI-BANGALORE", "DELHI-MUMBAI"]

        # Commutative encrypt sets (same simulated key/salt configuration)
        key = 42
        shipper_enc = self.matcher.encrypt_route_set(shipper_routes, key)
        carrier_enc = self.matcher.encrypt_route_set(carrier_routes, key)

        matches = self.matcher.compute_intersection(shipper_enc, carrier_enc)
        
        # Intersections should identify exactly 2 common elements: CHENNAI-BANGALORE & DELHI-MUMBAI
        self.assertEqual(len(matches), 2)

if __name__ == '__main__':
    unittest.main()
