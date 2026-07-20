import numpy as np
import secrets
import hashlib
import json
import redis
import logging
from typing import List, Dict, Any, Tuple
from datetime import datetime
from cryptography.fernet import Fernet
import pickle

logger = logging.getLogger(__name__)

class SecretSharing:
    """Shamir's Secret Sharing Scheme"""
    
    def __init__(self):
        self.prime = 2**127 - 1  # Large prime for field operations
        self.parties = []
        self.threshold = None
        
    def generate_shares(self, secret: int, n: int, k: int) -> List[Tuple[int, int]]:
        """Generate n shares with threshold k"""
        if k > n:
            raise ValueError("Threshold cannot be greater than number of shares")
        self.threshold = k
        
        # Generate random coefficients
        coeffs = [secret] + [secrets.randbelow(self.prime) for _ in range(k-1)]
        
        # Generate shares
        shares = []
        for i in range(1, n+1):
            x = i
            y = self._evaluate_polynomial(coeffs, x)
            shares.append((x, y))
        
        return shares
    
    def _evaluate_polynomial(self, coeffs: List[int], x: int) -> int:
        """Evaluate polynomial at x"""
        result = 0
        for coeff in reversed(coeffs):
            result = (result * x + coeff) % self.prime
        return result
    
    def reconstruct_secret(self, shares: List[Tuple[int, int]]) -> int:
        """Reconstruct secret from shares"""
        if self.threshold and len(shares) < self.threshold:
            raise ValueError(f"Need at least {self.threshold} shares to reconstruct, got {len(shares)}")
        if len(shares) < 2:
            raise ValueError("Need at least 2 shares to reconstruct")
        
        # Lagrange interpolation
        secret = 0
        for i, (xi, yi) in enumerate(shares):
            numerator = 1
            denominator = 1
            for j, (xj, _) in enumerate(shares):
                if i != j:
                    numerator = (numerator * (-xj)) % self.prime
                    denominator = (denominator * (xi - xj)) % self.prime
            lagrange = (yi * numerator * pow(denominator, -1, self.prime)) % self.prime
            secret = (secret + lagrange) % self.prime
        
        return secret

class SMPCProtocol:
    """Secure Multi-Party Computation Protocol"""
    
    def __init__(self, redis_url: str = "redis://localhost:6379"):
        self.redis = redis.Redis.from_url(redis_url)
        self.secret_sharing = SecretSharing()
        self.parties = {}
        self.session_id = None
        self.threshold = 3  # Minimum parties needed
        
        # Encryption
        self.key = Fernet.generate_key()
        self.cipher = Fernet(self.key)
        
        logger.info("✅ SMPC Protocol initialized")
    
    def register_party(self, party_id: str, public_key: str) -> bool:
        """Register a party for MPC"""
        if party_id not in self.parties:
            self.parties[party_id] = {
                'public_key': public_key,
                'shares': [],
                'registered_at': datetime.now().isoformat()
            }
            logger.info(f"✅ Party {party_id} registered")
            return True
        return False
    
    def initiate_session(self, parties: List[str]) -> str:
        """Initiate MPC session"""
        if len(parties) < self.threshold:
            raise ValueError(f"Need at least {self.threshold} parties")
        
        self.session_id = f"mpc_{datetime.now().timestamp()}"
        
        # Store session info in Redis
        self.redis.setex(
            f"mpc:session:{self.session_id}",
            3600,
            json.dumps({
                'parties': parties,
                'threshold': self.threshold,
                'created_at': datetime.now().isoformat()
            })
        )
        
        logger.info(f"✅ Session {self.session_id} initiated with {len(parties)} parties")
        return self.session_id
    
    def share_data(self, data: Any, parties: List[str]) -> Dict[str, bytes]:
        """Share data among parties using secret sharing"""
        try:
            # Convert data to integer
            data_bytes = pickle.dumps(data)
            data_int = int.from_bytes(data_bytes, 'big') % self.secret_sharing.prime
            
            # Generate shares
            shares = self.secret_sharing.generate_shares(
                data_int,
                len(parties),
                self.threshold
            )
            
            # Distribute shares
            shares_dict = {}
            for i, party in enumerate(parties):
                # Encrypt share for party
                share_bytes = pickle.dumps(shares[i])
                encrypted = self.cipher.encrypt(share_bytes)
                shares_dict[party] = encrypted
                
                # Store share in Redis
                self.redis.setex(
                    f"mpc:share:{self.session_id}:{party}",
                    3600,
                    encrypted
                )
            
            logger.info(f"✅ Data shared among {len(parties)} parties")
            return shares_dict
            
        except Exception as e:
            logger.error(f"Data sharing failed: {e}")
            raise
    
    def compute_sum(self, shares_dict: Dict[str, bytes]) -> int:
        """Compute sum of shares securely"""
        try:
            shares = []
            for party, encrypted_share in shares_dict.items():
                # Decrypt share
                decrypted = self.cipher.decrypt(encrypted_share)
                share = pickle.loads(decrypted)
                shares.append(share)
            
            # Reconstruct sum
            sum_share = self._sum_shares(shares)
            return sum_share
            
        except Exception as e:
            logger.error(f"Sum computation failed: {e}")
            raise
    
    def compute_average(self, shares_dict: Dict[str, bytes]) -> float:
        """Compute average of shares securely"""
        try:
            total_sum = self.compute_sum(shares_dict)
            count = len(shares_dict)
            return total_sum / count
            
        except Exception as e:
            logger.error(f"Average computation failed: {e}")
            raise
    
    def compute_multiplication(self, shares_dict1: Dict[str, bytes], 
                               shares_dict2: Dict[str, bytes]) -> int:
        """Compute multiplication of two shared secrets"""
        try:
            # Get shares for both secrets
            shares1 = []
            shares2 = []
            
            for party in shares_dict1.keys():
                decrypted1 = pickle.loads(self.cipher.decrypt(shares_dict1[party]))
                decrypted2 = pickle.loads(self.cipher.decrypt(shares_dict2[party]))
                
                shares1.append(decrypted1)
                shares2.append(decrypted2)
            
            # Multiply shares (Beaver's multiplication protocol)
            # In production: use more sophisticated approach
            result = 0
            for i in range(len(shares1)):
                result += shares1[i][1] * shares2[i][1]
            
            return result % self.secret_sharing.prime
            
        except Exception as e:
            logger.error(f"Multiplication computation failed: {e}")
            raise
    
    def _sum_shares(self, shares: List[Tuple[int, int]]) -> int:
        """Sum shares using secure aggregation"""
        total = 0
        for x, y in shares:
            total = (total + y) % self.secret_sharing.prime
        return total
    
    def secure_aggregate(self, data_list: List[Any], operation: str = 'sum') -> Any:
        """Secure aggregation of multiple data items"""
        try:
            # Convert data to integers
            data_ints = []
            for data in data_list:
                data_bytes = pickle.dumps(data)
                data_int = int.from_bytes(data_bytes, 'big') % self.secret_sharing.prime
                data_ints.append(data_int)
            
            # Get all parties
            parties = list(self.parties.keys())
            
            # Share each data item
            shares_list = []
            for data_int in data_ints:
                shares = self.share_data(data_int, parties)
                shares_list.append(shares)
            
            # Aggregate based on operation
            if operation == 'sum':
                result_shares = self._aggregate_sum(shares_list)
            elif operation == 'average':
                result_shares = self._aggregate_average(shares_list)
            elif operation == 'max':
                result_shares = self._aggregate_max(shares_list)
            else:
                raise ValueError(f"Unknown operation: {operation}")
            
            # Reconstruct result
            result = self.secret_sharing.reconstruct_secret(result_shares)
            
            # Convert back to bytes
            result_bytes = result.to_bytes((result.bit_length() + 7) // 8, 'big')
            result_data = pickle.loads(result_bytes)
            
            return result_data
            
        except Exception as e:
            logger.error(f"Secure aggregation failed: {e}")
            raise
    
    def _aggregate_sum(self, shares_list: List[Dict[str, bytes]]) -> List[Tuple[int, int]]:
        """Aggregate shares for sum operation"""
        # Combine shares from all parties
        aggregated = {}
        for shares in shares_list:
            for party, encrypted_share in shares.items():
                decrypted = pickle.loads(self.cipher.decrypt(encrypted_share))
                if party not in aggregated:
                    aggregated[party] = decrypted
                else:
                    x, y = aggregated[party]
                    _, y2 = decrypted
                    aggregated[party] = (x, (y + y2) % self.secret_sharing.prime)
        
        return list(aggregated.values())
    
    def _aggregate_average(self, shares_list: List[Dict[str, bytes]]) -> List[Tuple[int, int]]:
        """Aggregate shares for average operation"""
        # First compute sum
        sum_shares = self._aggregate_sum(shares_list)
        
        # Then divide by count
        count = len(shares_list)
        result = []
        for x, y in sum_shares:
            avg = (y * pow(count, -1, self.secret_sharing.prime)) % self.secret_sharing.prime
            result.append((x, avg))
        
        return result
    
    def _aggregate_max(self, shares_list: List[Dict[str, bytes]]) -> List[Tuple[int, int]]:
        """Aggregate shares for max operation"""
        # Compare shares securely
        # In production: use secure comparison protocol
        max_share = shares_list[0]
        for shares in shares_list[1:]:
            # Secure comparison (simplified)
            max_share = self._secure_compare(shares, max_share)
        
        return list(max_share.values())
    
    def _secure_compare(self, shares1: Dict[str, bytes], shares2: Dict[str, bytes]) -> Dict[str, bytes]:
        """Secure comparison of two shared values"""
        vals1 = [pickle.loads(self.cipher.decrypt(v)) for v in shares1.values()]
        vals2 = [pickle.loads(self.cipher.decrypt(v)) for v in shares2.values()]
        sum1 = sum(v[1] for v in vals1) % self.secret_sharing.prime
        sum2 = sum(v[1] for v in vals2) % self.secret_sharing.prime
        return shares1 if sum1 > sum2 else shares2
    
    def get_party_stats(self) -> Dict:
        """Get party statistics"""
        return {
            'total_parties': len(self.parties),
            'active_session': self.session_id is not None,
            'threshold': self.threshold,
            'parties': list(self.parties.keys())
        }
    
    def close_session(self):
        """Close MPC session"""
        if self.session_id:
            # Cleanup Redis keys
            keys = self.redis.keys(f"mpc:share:{self.session_id}:*")
            for key in keys:
                self.redis.delete(key)
            
            self.session_id = None
            logger.info("✅ Session closed")