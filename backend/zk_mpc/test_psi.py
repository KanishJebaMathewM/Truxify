import unittest
from psi_matcher import PrivateSetIntersectionMatcher

class TestPSI(unittest.TestCase):
    def setUp(self):
        self.matcher = PrivateSetIntersectionMatcher()

    def test_intersection_matching(self):
        shipper_routes = ["DELHI-MUMBAI", "CHENNAI-BANGALORE", "KOLKATA-PATNA"]
        carrier_routes = ["MUMBAI-PUNE", "CHENNAI-BANGALORE", "DELHI-MUMBAI"]

        # Independent private keys per party
        shipper_key = self.matcher.generate_key()
        carrier_key = self.matcher.generate_key()

        shipper_enc = self.matcher.encrypt_route_set(shipper_routes, shipper_key)
        carrier_enc = self.matcher.encrypt_route_set(carrier_routes, carrier_key)

        # Double-blinded sets: only shared routes must collide
        shipper_double = self.matcher.encrypt_intersection(shipper_enc, carrier_key)
        carrier_double = self.matcher.encrypt_intersection(carrier_enc, shipper_key)
        common = set(shipper_double).intersection(set(carrier_double))

        # Intersections should identify exactly 2 common elements: CHENNAI-BANGALORE & DELHI-MUMBAI
        self.assertEqual(len(common), 2)

        matches = self.matcher.compute_intersection(
            shipper_enc, carrier_enc, shipper_key, carrier_key
        )
        self.assertEqual(len(matches), 2)

    def test_double_encryption_commutes_for_shared_elements(self):
        route = "DELHI-MUMBAI"
        key_a = self.matcher.generate_key()
        key_b = self.matcher.generate_key()

        enc_a = self.matcher.encrypt_route_set([route], key_a)
        enc_b = self.matcher.encrypt_route_set([route], key_b)

        ab = self.matcher.encrypt_intersection(enc_a, key_b)
        ba = self.matcher.encrypt_intersection(enc_b, key_a)

        # E_b(E_a(route)) == E_a(E_b(route))
        self.assertEqual(ab, ba)

    def test_non_matching_routes_do_not_collide(self):
        key = self.matcher.generate_key()
        a = self.matcher.encrypt_route_set(["MUMBAI-PUNE"], key)
        b = self.matcher.encrypt_route_set(["CHENNAI-BANGALORE"], key)
        self.assertNotEqual(a, b)

if __name__ == '__main__':
    unittest.main()
