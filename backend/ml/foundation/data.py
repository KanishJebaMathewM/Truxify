import json
import numpy as np
from typing import List, Dict, Tuple, Optional
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

class LogisticsDataProcessor:
    """Process logistics data for foundation model"""
    
    def __init__(self):
        self.vocab = {}
        self.vocab_size = 0
        self.tokenizer = None
        
        logger.info("✅ Data processor initialized")
    
    def load_data(self, data_path: str) -> List[Dict]:
        """Load logistics data"""
        try:
            with open(data_path, 'r') as f:
                data = json.load(f)
            
            logger.info(f"✅ Loaded {len(data)} samples")
            return data
        except Exception as e:
            logger.error(f"Failed to load data: {e}")
            return []
    
    def prepare_sequence(self, text: str) -> List[int]:
        """Convert text to token IDs"""
        # Simple tokenization
        tokens = text.lower().split()
        token_ids = []
        
        for token in tokens:
            if token not in self.vocab:
                self.vocab[token] = len(self.vocab)
            token_ids.append(self.vocab[token])
        
        return token_ids
    
    def create_pretraining_data(self, data: List[Dict]) -> List[Dict]:
        """Create MLM pretraining data"""
        pretrain_data = []
        
        for item in data:
            # Combine fields
            text = f"{item.get('origin', '')} {item.get('destination', '')} {item.get('cargo_type', '')} {item.get('route', '')}"
            
            # Tokenize
            tokens = self.prepare_sequence(text)
            
            # Create MLM labels (masked tokens)
            labels = tokens.copy()
            for i in range(len(tokens)):
                if np.random.random() < 0.15:  # Mask 15% of tokens
                    tokens[i] = 1  # [MASK] token
                    labels[i] = labels[i]  # Keep original
            
            pretrain_data.append({
                'tokens': tokens,
                'labels': labels,
                'metadata': item
            })
        
        return pretrain_data
    
    def create_finetuning_data(self, data: List[Dict], task: str = 'classification') -> List[Dict]:
        """Create fine-tuning data for specific tasks"""
        finetune_data = []
        
        for item in data:
            text = f"{item.get('origin', '')} {item.get('destination', '')} {item.get('cargo_type', '')}"
            tokens = self.prepare_sequence(text)
            
            # Task-specific labels
            if task == 'classification':
                label = 1 if item.get('is_urgent', False) else 0
            elif task == 'regression':
                label = item.get('price', 0) / 1000  # Normalize
            else:
                label = 0
            
            finetune_data.append({
                'tokens': tokens,
                'label': label,
                'metadata': item
            })
        
        return finetune_data
    
    def get_vocab_size(self) -> int:
        """Get vocabulary size"""
        return len(self.vocab)
    
    def save_vocab(self, path: str = "models/vocab.json"):
        """Save vocabulary"""
        with open(path, 'w') as f:
            json.dump(self.vocab, f)
        logger.info(f"✅ Vocab saved to {path}")
    
    def load_vocab(self, path: str = "models/vocab.json"):
        """Load vocabulary"""
        with open(path, 'r') as f:
            self.vocab = json.load(f)
        logger.info(f"✅ Vocab loaded from {path}")

class LogisticsDatasetGenerator:
    """Generate synthetic logistics dataset"""
    
    @staticmethod
    def generate_samples(num_samples: int = 10000) -> List[Dict]:
        """Generate synthetic logistics samples"""
        origins = ['Delhi', 'Mumbai', 'Bangalore', 'Chennai', 'Kolkata', 'Hyderabad']
        destinations = ['Delhi', 'Mumbai', 'Bangalore', 'Chennai', 'Kolkata', 'Hyderabad']
        cargo_types = ['general', 'perishable', 'fragile', 'hazardous', 'bulk', 'livestock']
        route_types = ['highway', 'city', 'expressway', 'hill']
        weather_conditions = ['clear', 'rain', 'fog', 'storm', 'sunny']
        
        samples = []
        for i in range(num_samples):
            origin = np.random.choice(origins)
            dest = np.random.choice([d for d in destinations if d != origin]) if len(destinations) > 1 else origin
            
            sample = {
                'id': f'sample_{i}',
                'origin': origin,
                'destination': dest,
                'distance': np.random.uniform(50, 2000),
                'cargo_type': np.random.choice(cargo_types),
                'cargo_weight': np.random.uniform(100, 50000),
                'route_type': np.random.choice(route_types),
                'weather': np.random.choice(weather_conditions),
                'traffic_level': np.random.uniform(0, 1),
                'time_of_day': np.random.choice(['morning', 'afternoon', 'evening', 'night']),
                'day_of_week': np.random.choice(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']),
                'price': np.random.uniform(500, 50000),
                'is_urgent': np.random.random() < 0.2,
                'timestamp': datetime.now().isoformat()
            }
            samples.append(sample)
        
        return samples
    
    @staticmethod
    def save_samples(samples: List[Dict], path: str = "data/logistics_data.json"):
        """Save generated samples"""
        import json
        with open(path, 'w') as f:
            json.dump(samples, f, indent=2)
        logger.info(f"✅ {len(samples)} samples saved to {path}")