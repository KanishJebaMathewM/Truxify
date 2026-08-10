import unittest
from kyber_relayer import Kyber1024Relayer

class TestKyber1024Relayer(unittest.TestCase):
    def setUp(self):
        self.relayer = Kyber1024Relayer()

    def test_keypair_generation(self):
        pk, sk = self.relayer.generate_keypair()
        self.toEqual = self.assertEqual(len(pk), self.relayer.public_key_len)
        self.assertEqual(len(sk), self.relayer.secret_key_len)

    def test_encapsulate_decapsulate(self):
        pk, sk = self.relayer.generate_keypair()
        ct, ss1 = self.relayer.encapsulate(pk)
        self.assertEqual(len(ct), self.relayer.ciphertext_len)
        self.assertEqual(len(ss1), 32)
        
        ss2 = self.relayer.decapsulate(ct, sk)
        self.assertEqual(len(ss2), 32)

if __name__ == '__main__':
    unittest.main()
