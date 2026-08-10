import json
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives import hashes
import base64

from hybrid_crypto import HybridCrypto


@pytest.fixture
def hybrid():
    return HybridCrypto()


@pytest.fixture
def hybrid_key(hybrid):
    return hybrid.generate_hybrid_keypair()


def test_normal_plaintext_roundtrip(hybrid, hybrid_key):
    """Verify normal plaintext encrypt -> decrypt returns exact byte-for-byte match without trailing secret."""
    original_plaintext = b"Hello World! This is a test message for PQC hybrid encryption."
    
    ciphertext = hybrid.hybrid_encrypt(original_plaintext, hybrid_key)
    decrypted_result = hybrid.hybrid_decrypt(ciphertext, hybrid_key)
    
    assert decrypted_result == original_plaintext
    assert len(decrypted_result) == len(original_plaintext)


def test_decrypted_result_excludes_quantum_secret(hybrid, hybrid_key):
    """Verify decrypted payload length is exactly equal to plaintext length (not +32 bytes)."""
    plaintext = b"Short payload"
    ciphertext = hybrid.hybrid_encrypt(plaintext, hybrid_key)
    decrypted_result = hybrid.hybrid_decrypt(ciphertext, hybrid_key)
    
    assert len(decrypted_result) == len(plaintext)
    assert not decrypted_result.endswith(b"0" * 32)


def test_json_text_data_decryption_and_parsing(hybrid, hybrid_key):
    """Verify JSON/text payload can be decrypted and deserialized cleanly."""
    json_data = {"user": "alice", "amount": 1000, "status": "CONFIRMED"}
    plaintext = json.dumps(json_data).encode("utf-8")
    
    ciphertext = hybrid.hybrid_encrypt(plaintext, hybrid_key)
    decrypted_result = hybrid.hybrid_decrypt(ciphertext, hybrid_key)
    
    parsed = json.loads(decrypted_result.decode("utf-8"))
    assert parsed == json_data


def test_binary_payload_preservation(hybrid, hybrid_key):
    """Verify binary payloads containing arbitrary byte values are preserved byte-for-byte."""
    binary_data = bytes(range(100))
    
    ciphertext = hybrid.hybrid_encrypt(binary_data, hybrid_key)
    decrypted_result = hybrid.hybrid_decrypt(ciphertext, hybrid_key)
    
    assert decrypted_result == binary_data
    assert len(decrypted_result) == 100


def test_minimum_valid_length_empty_bytes(hybrid, hybrid_key):
    """Verify an empty byte string payload is handled correctly."""
    empty_plaintext = b""
    
    ciphertext = hybrid.hybrid_encrypt(empty_plaintext, hybrid_key)
    decrypted_result = hybrid.hybrid_decrypt(ciphertext, hybrid_key)
    
    assert decrypted_result == b""
    assert len(decrypted_result) == 0


def test_exactly_32_byte_plaintext(hybrid, hybrid_key):
    """Verify a plaintext of exactly 32 bytes (matching quantum secret length) is decrypted cleanly."""
    plaintext_32_bytes = b"A" * 32
    
    ciphertext = hybrid.hybrid_encrypt(plaintext_32_bytes, hybrid_key)
    decrypted_result = hybrid.hybrid_decrypt(ciphertext, hybrid_key)
    
    assert decrypted_result == plaintext_32_bytes
    assert len(decrypted_result) == 32


def test_too_short_decrypted_payload_raises_error(hybrid, hybrid_key):
    """Verify a payload shorter than 32 bytes (quantum secret size) raises a ValueError."""
    # Fabricate an encrypted RSA payload containing only 10 bytes instead of 32+ bytes
    short_data = b"1234567890"
    encrypted_short = hybrid_key['classical']['public'].encrypt(
        short_data,
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None
        )
    )
    
    # Encapsulate to get valid quantum_ciphertext format
    quantum_ciphertext, _ = hybrid.kyber.encapsulate(hybrid_key['quantum']['public'])
    
    malformed_ciphertext = {
        'quantum_ciphertext': hybrid._serialize_kyber_ciphertext(quantum_ciphertext),
        'encrypted_data': base64.b64encode(encrypted_short).decode(),
        'hybrid_id': hybrid_key.get('hybrid_id', 'unknown')
    }
    
    with pytest.raises(ValueError, match="is shorter than quantum secret size"):
        hybrid.hybrid_decrypt(malformed_ciphertext, hybrid_key)


def test_tampered_quantum_secret_suffix_raises_error(hybrid, hybrid_key):
    """Verify a payload whose suffix does not match the recovered quantum secret raises a ValueError."""
    # Encrypt data with fake quantum secret appended (e.g. wrong 32 bytes)
    wrong_secret = b"X" * 32
    plaintext = b"Valid Payload"
    
    encrypted_tampered = hybrid_key['classical']['public'].encrypt(
        plaintext + wrong_secret,
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None
        )
    )
    
    quantum_ciphertext, _ = hybrid.kyber.encapsulate(hybrid_key['quantum']['public'])
    
    tampered_ciphertext = {
        'quantum_ciphertext': hybrid._serialize_kyber_ciphertext(quantum_ciphertext),
        'encrypted_data': base64.b64encode(encrypted_tampered).decode(),
        'hybrid_id': hybrid_key.get('hybrid_id', 'unknown')
    }
    
    with pytest.raises(ValueError, match="Quantum secret suffix verification failed"):
        hybrid.hybrid_decrypt(tampered_ciphertext, hybrid_key)


def test_hybrid_sign_verify_and_metrics(hybrid, hybrid_key):
    """Verify existing signing, verification, and key metrics functionality."""
    message = b"Sign this message"
    sig = hybrid.hybrid_sign(message, hybrid_key)
    assert hybrid.hybrid_verify(message, sig, hybrid_key) is True
    assert hybrid.hybrid_verify(b"Tampered", sig, hybrid_key) is False
    
    metrics = hybrid.get_key_metrics(hybrid_key)
    assert metrics['classical_key_size'] == 2048
    assert metrics['algorithm'] == 'RSA-2048 + Kyber-768 + Dilithium'
