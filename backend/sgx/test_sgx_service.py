"""SGXService suite — AES-GCM round-trips + lifecycle guardrails (env-keyed)."""
import base64
import os

import pytest

os.environ.setdefault('SGX_ENCRYPTION_KEY', base64.b64encode(b'k' * 32).decode())

from sgx_service import SGXService


@pytest.fixture()
def svc():
    s = SGXService()
    s.init_enclave()
    return s


class TestLifecycle:
    def test_init_enclave(self, svc):
        assert svc.enclave_initialized is True
        assert svc.enclave_id.startswith('enclave_')

    def test_encrypt_before_init_fails_closed(self):
        s = SGXService()
        res = s.encrypt_data('secret')
        assert res['success'] is False
        assert 'not initialized' in res['error']

    def test_decrypt_before_init_fails_closed(self):
        s = SGXService()
        res = s.decrypt_data(base64.b64encode(b'x' * 20).decode())
        assert res['success'] is False

    def test_missing_env_key_raises(self, monkeypatch):
        monkeypatch.delenv('SGX_ENCRYPTION_KEY', raising=False)
        with pytest.raises(RuntimeError, match='SGX_ENCRYPTION_KEY'):
            SGXService()


class TestEncryptDecrypt:
    def test_round_trip(self, svc):
        msg = 'driver:DL-1234 earnings:₹50,000'
        enc = svc.encrypt_data(msg)
        assert enc['success'] is True
        dec = svc.decrypt_data(enc['ciphertext'])
        assert dec['success'] is True
        assert dec['plaintext'] == msg

    def test_ciphertext_is_unique_per_encryption(self, svc):
        a = svc.encrypt_data('same plaintext')
        b = svc.encrypt_data('same plaintext')
        assert a['ciphertext'] != b['ciphertext'], 'fresh nonce per encryption'

    def test_tampered_ciphertext_rejected(self, svc):
        enc = svc.encrypt_data('authentic')
        raw = bytearray(base64.b64decode(enc['ciphertext']))
        raw[-1] ^= 0xFF
        dec = svc.decrypt_data(base64.b64encode(bytes(raw)).decode())
        assert dec['success'] is False, 'AES-GCM tag mismatch must fail'

    def test_wrong_key_cannot_decrypt(self, svc, monkeypatch):
        enc = svc.encrypt_data('classified')
        other = SGXService.__new__(SGXService)
        other.enclave_initialized = True
        other.enclave_id = 'enclave_test'
        other._aes_key = b'z' * 32
        dec = other.decrypt_data(enc['ciphertext'])
        assert dec['success'] is False

    def test_store_data_hashes_and_increments_the_secure_counter(self, svc):
        # demo mode: store returns a sha256 commitment + monotonic counter
        a = svc.store_data('payload-42')
        b = svc.store_data('payload-43')
        assert a['success'] is True and b['success'] is True
        assert a['storage_index'] == 0 and b['storage_index'] == 1
        import hashlib
        assert a['data_hash'] == hashlib.sha256(b'payload-42').hexdigest()
        assert a['data_hash'] != b['data_hash']
