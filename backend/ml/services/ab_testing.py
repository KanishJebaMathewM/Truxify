import logging
import random
from datetime import datetime
from typing import Dict, Any, Optional
from sqlalchemy import create_engine, Column, String, Float, DateTime, Integer
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import pandas as pd
import json

logger = logging.getLogger(__name__)
Base = declarative_base()

class ABTestMetrics(Base):
    __tablename__ = 'ab_test_metrics'
    
    id = Column(Integer, primary_key=True)
    model_version = Column(String(50))
    test_id = Column(String(100))
    metric_name = Column(String(50))
    metric_value = Column(Float)
    sample_size = Column(Integer)
    timestamp = Column(DateTime, default=datetime.utcnow)
    request_id = Column(String(100))

class ABTestModel:
    """A/B Testing with shadow deployment and auto-rollback"""
    
    def __init__(self, db_url: str, threshold: float = 0.95):
        self.engine = create_engine(db_url)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.threshold = threshold  # If new model < threshold% of old, rollback
        self.traffic_split = 0.10  # 10% to new model
        
    def get_model_for_request(self, request_id: str) -> Dict[str, Any]:
        """Route request to production or shadow model based on A/B split"""
        
        # Get current test configuration
        test_config = self.get_active_test()
        
        if not test_config:
            return {
                'model': 'production',
                'version': self.get_production_version(),
                'test_id': None
            }
        
        # A/B Split: 90% production, 10% shadow
        is_shadow = random.random() < self.traffic_split
        
        return {
            'model': 'shadow' if is_shadow else 'production',
            'version': test_config['shadow_version'] if is_shadow else test_config['production_version'],
            'test_id': test_config['test_id'],
            'is_shadow': is_shadow
        }
    
    def log_metrics(self, test_id: str, model_version: str, metrics: Dict[str, float], request_id: str):
        """Log performance metrics for analysis"""
        session = self.Session()
        
        for metric_name, value in metrics.items():
            metric = ABTestMetrics(
                model_version=model_version,
                test_id=test_id,
                metric_name=metric_name,
                metric_value=value,
                sample_size=1,
                request_id=request_id,
                timestamp=datetime.utcnow()
            )
            session.add(metric)
        
        session.commit()
        session.close()
    
    def evaluate_test(self, test_id: str) -> Dict[str, Any]:
        """Compare performance of production vs shadow model"""
        session = self.Session()
        
        try:
            # Get metrics for both models
            metrics = session.query(ABTestMetrics).filter(
                ABTestMetrics.test_id == test_id
            ).all()
            
            df = pd.DataFrame([{
                'model_version': m.model_version,
                'metric_name': m.metric_name,
                'metric_value': m.metric_value
            } for m in metrics])
            
            if df.empty:
                return {'error': 'No metrics found'}
            
            # Calculate average metrics per model
            results = {}
            for metric in df['metric_name'].unique():
                metric_df = df[df['metric_name'] == metric]
                avg_metrics = metric_df.groupby('model_version')['metric_value'].mean()
                
                results[metric] = {
                    'production': avg_metrics.get('production', None),
                    'shadow': avg_metrics.get('shadow', None),
                    'improvement': self.calculate_improvement(
                        avg_metrics.get('production', 0),
                        avg_metrics.get('shadow', 0)
                    )
                }
            
            # Determine if shadow model is better
            is_better = self.is_shadow_better(results)
            
            return {
                'test_id': test_id,
                'results': results,
                'shadow_better': is_better,
                'should_rollback': not is_better,
                'timestamp': datetime.utcnow().isoformat()
            }
        finally:
            session.close()
    
    def calculate_improvement(self, prod_value: float, shadow_value: float) -> float:
        """Calculate percentage improvement"""
        if prod_value == 0:
            return 0
        return ((shadow_value - prod_value) / prod_value) * 100
    
    def is_shadow_better(self, results: Dict) -> bool:
        """Determine if shadow model outperforms production"""
        # For regression: lower RMSE is better
        # For classification: higher accuracy is better
        
        better_count = 0
        total_metrics = 0
        
        for metric, values in results.items():
            if values['production'] is None or values['shadow'] is None:
                continue
                
            total_metrics += 1
            if metric in ['rmse', 'mae', 'mse']:
                if values['shadow'] < values['production'] * self.threshold:
                    better_count += 1
            else:  # Higher is better (accuracy, f1, precision, recall)
                if values['shadow'] > values['production'] * self.threshold:
                    better_count += 1
        
        # Require majority of metrics to be better
        return better_count > (total_metrics / 2) if total_metrics > 0 else False
    
    def get_active_test(self) -> Optional[Dict]:
        """Get currently active A/B test"""
        # In production, this would query the database
        # For demo, return sample config
        return {
            'test_id': 'test_001',
            'production_version': '1.2.0',
            'shadow_version': '2.0.0',
            'started_at': datetime.utcnow().isoformat(),
            'status': 'active'
        }
    
    def get_production_version(self) -> str:
        """Get current production model version"""
        return '1.2.0'
    
    def trigger_rollback(self, test_id: str) -> Dict[str, Any]:
        """Auto-rollback to previous version if shadow model underperforms"""
        evaluation = self.evaluate_test(test_id)
        
        if evaluation.get('should_rollback', False):
            # Trigger rollback via n8n webhook
            logger.warning(f"⚠️ Rollback triggered for test {test_id}")
            
            # Return rollback instructions
            return {
                'action': 'rollback',
                'test_id': test_id,
                'reason': 'Shadow model underperformed',
                'production_version': '1.2.0',
                'previous_version': '1.1.0',
                'timestamp': datetime.utcnow().isoformat()
            }
        
        return {
            'action': 'promote',
            'test_id': test_id,
            'reason': 'Shadow model performed well',
            'timestamp': datetime.utcnow().isoformat()
        }