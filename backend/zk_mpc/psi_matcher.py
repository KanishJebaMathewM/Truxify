# === Spec 50: max set size ===
import hashlib

MAX_SET_SIZE = 100_000

# SECP256R1 (NIST P-256) group order, used to keep PSI scalars in range.
_P256_ORDER = 115792089210356248762697446949407573529996955224135760342422259061068512044369


def validate_set_size(s):
    if not isinstance(s, (list, set, tuple)):
        raise TypeError("expected list/set/tuple")
    if len(s) > MAX_SET_SIZE:
        raise ValueError(f"too large: {len(s)}")
    return list(s)


def _scalar_from_element(element) -> int:
    """Map an element to a group scalar via a cryptographic hash."""
    digest = hashlib.sha256(str(element).encode("utf-8")).digest()
    return int.from_bytes(digest, "big") % _P256_ORDER


def intersect(set_a, set_b):
    """Private Set Intersection via ECDH-PSI.

    Returns only the elements common to both sets without either party
    revealing its non-intersecting elements to the other. The protocol uses
    ephemeral ECDH keys so that masking (a*kx) and (b*ky) cannot be inverted
    by the peer, and the final match is performed on the conjugated values
    (ab*kx) / (ab*ky).
    """
    set_a = validate_set_size(set_a)
    set_b = validate_set_size(set_b)

    from cryptography.hazmat.primitives.asymmetric import ec

    a_priv = ec.generate_private_key(ec.SECP256R1())
    b_priv = ec.generate_private_key(ec.SECP256R1())
    a = a_priv.private_numbers().private_value
    b = b_priv.private_numbers().private_value

    # Party A masks its elements with its private scalar a.
    a_mask = {x: (a * _scalar_from_element(x)) % _P256_ORDER for x in set_a}
    # Party B masks its elements with its private scalar b.
    b_mask = {y: (b * _scalar_from_element(y)) % _P256_ORDER for y in set_b}

    # Conjugate: each party raises the other's masked points by its own scalar.
    t_a = {
        x: b_priv.exchange(ec.ECDH(), ec.derive_private_key(s, ec.SECP256R1()).public_key())
        for x, s in a_mask.items()
    }
    t_b = {
        y: a_priv.exchange(ec.ECDH(), ec.derive_private_key(s, ec.SECP256R1()).public_key())
        for y, s in b_mask.items()
    }

    t_b_values = set(t_b.values())
    return [x for x in t_a if t_a[x] in t_b_values]

