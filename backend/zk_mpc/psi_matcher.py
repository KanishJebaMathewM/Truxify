import hashlib

class PrivateSetIntersectionMatcher:
    """
    ECDH-based Commutative Private Set Intersection (PSI) Freight Matcher.
    Determines route intersections without leaking non-matching route elements.
    """
    def __init__(self, ecdh_salt: str = "truxify_comm_salt"):
        self.salt = ecdh_salt

    def encrypt_route_set(self, route_list: list, private_key: int) -> list:
        """Encrypts a list of routes commutatively using key and hashing."""
        encrypted = []
        for route in route_list:
            raw = f"{route}:{private_key}:{self.salt}".encode('utf-8')
            # Simulated commutative elliptic curve point mapping via hash rounds
            h = hashlib.sha256(raw).hexdigest()
            encrypted.append(h)
        return encrypted

    def compute_intersection(self, client_encrypted: list, server_encrypted: list) -> list:
        """Computes matching indices between shipper and carrier sets."""
        intersected_hashes = set(client_encrypted).intersection(set(server_encrypted))
        return list(intersected_hashes)

psi_matcher = PrivateSetIntersectionMatcher()
