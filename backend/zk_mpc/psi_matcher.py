import hashlib
import random

from cryptography.hazmat.primitives.asymmetric import ec

# secp256k1 parameters (the curve used by the rest of the Truxify stack).
# p == 3 (mod 4), so a square root modulo p is computable as a^((p+1)/4).
SECP256K1_P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F
SECP256K1_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
SECP256K1_B = 7


def _mod_sqrt(v: int) -> int:
    """Square root of v modulo p via Euler's criterion (p == 3 mod 4)."""
    return pow(v, (SECP256K1_P + 1) // 4, SECP256K1_P)


def _is_quadratic_residue(v: int) -> bool:
    return pow(v, (SECP256K1_P - 1) // 2, SECP256K1_P) == 1


def _point_from_x(x: int):
    """Deterministically lift an x-coordinate to an even-y point on secp256k1."""
    y_sq = (pow(x, 3, SECP256K1_P) + SECP256K1_B) % SECP256K1_P
    if not _is_quadratic_residue(y_sq):
        raise ValueError(f"no point on secp256k1 has x-coordinate {x}")
    y = _mod_sqrt(y_sq)
    if y & 1:
        y = SECP256K1_P - y
    return (x, y)


def _scalar_multiply(point, scalar: int) -> int:
    """Return the x-coordinate of `scalar * point` (even-y convention)."""
    n = scalar % (SECP256K1_N - 1) + 1
    public_numbers = ec.EllipticCurvePublicNumbers(point[0], point[1], ec.SECP256K1())
    public_key = public_numbers.public_key()
    private_key = ec.derive_private_key(n, ec.SECP256K1())
    x_bytes = private_key.exchange(ec.ECDH(), public_key)
    return _point_from_x(int.from_bytes(x_bytes, "big"))[0]


class PrivateSetIntersectionMatcher:
    """
    ECDH-based Commutative Private Set Intersection (PSI) Freight Matcher.

    Elements are mapped deterministically onto secp256k1 points via a
    try-and-increment hash. Each party "encrypts" a route by multiplying its
    point by that party's private scalar. Because scalar multiplication on the
    curve commutes (a*(b*P) == b*(a*P)), two parties that double-encrypt each
    other's blinded sets arrive at identical values exactly for the routes they
    share, while non-matching routes remain unlinkable. The previous
    implementation just hashed "route:key:salt", which never commutes and
    leaked the raw private key through the hash input.
    """

    def __init__(self, ecdh_salt: str = "truxify_comm_salt"):
        self.salt = ecdh_salt

    def generate_key(self) -> int:
        """Generate a fresh random private scalar in [1, N-1]."""
        return random.randrange(1, SECP256K1_N)

    def _hash_to_point(self, route: str):
        """Deterministic try-and-increment mapping of a route to a secp256k1 point."""
        counter = 0
        while True:
            digest = hashlib.sha256(
                f"{self.salt}:{route}:{counter}".encode("utf-8")
            ).digest()
            x = int.from_bytes(digest, "big") % SECP256K1_P
            y_sq = (pow(x, 3, SECP256K1_P) + SECP256K1_B) % SECP256K1_P
            if _is_quadratic_residue(y_sq):
                y = _mod_sqrt(y_sq)
                if y & 1:
                    y = SECP256K1_P - y
                return (x, y)
            counter += 1

    def _encrypt_point(self, point, private_key: int) -> str:
        return format(_scalar_multiply(point, private_key), "064x")

    def _point_from_hex(self, encrypted: str):
        return _point_from_x(int(encrypted, 16))

    def encrypt_route_set(self, route_list: list, private_key: int) -> list:
        """First-round encryption: E_key(route) = private_key * H(route)."""
        encrypted = []
        for route in route_list:
            point = self._hash_to_point(route)
            encrypted.append(self._encrypt_point(point, private_key))
        return encrypted

    def encrypt_intersection(self, encrypted_set: list, private_key: int) -> list:
        """
        Second-round blinding: apply `private_key` to a partner's encrypted set.
        Because E_b(E_a(x)) == E_a(E_b(x)) for every shared x, intersecting the
        two double-blinded lists recovers exactly the common routes.
        """
        return [self._encrypt_point(self._point_from_hex(x), private_key) for x in encrypted_set]

    def compute_intersection(
        self,
        client_encrypted: list,
        server_encrypted: list,
        client_private_key: int,
        server_private_key: int,
    ) -> list:
        """
        Completes both sides of the double-blinding and returns the common
        elements. `client_encrypted` is the shipper's first-round output
        (E_client(S_client)) and `server_encrypted` the carrier's
        (E_server(S_server)); each is blinded a second time with the *other*
        party's key.
        """
        client_double = self.encrypt_intersection(client_encrypted, server_private_key)
        server_double = self.encrypt_intersection(server_encrypted, client_private_key)
        return list(set(client_double).intersection(set(server_double)))


psi_matcher = PrivateSetIntersectionMatcher()
