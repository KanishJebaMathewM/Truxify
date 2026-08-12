import logging
import random
from datetime import datetime
from typing import Dict, Any, Optional
from sqlalchemy import create_engine, Column, String, Float, DateTime, Integer
from sqlalchemy.orm import declarative_base
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

class ABTestVersion(Base):
    """Registry of model versions and their serving status.

    Exactly one row carries status='production' at any time; shadow
    versions and superseded (rolled-back) versions are kept for history.
    """
    __tablename__ = 'ab_test_versions'

    id = Column(Integer, primary_key=True)
    version = Column(String(200))
    file_path = Column(String(500), nullable=True)
    status = Column(String(50), default='shadow')  # production | shadow | superseded
    test_id = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class ABTestModel:
    """A/B Testing with shadow deployment and auto-rollback"""
    
    def __init__(self, db_url: str, threshold: float = 0.95):
        self.engine = create_engine(db_url)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.threshold = threshold  # If new model < threshold% of old, rollback
        self.traffic_split = 0.10  # 10% to new model
        self.rollback_degradation_threshold = 0.15  # degrade > 15% ⇒ rollback
        
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
                
                prod_val = avg_metrics.get('production', None)
                shadow_val = avg_metrics.get('shadow', None)
                lower_is_better_keywords = {'rmse', 'mae', 'mse', 'loss', 'error_rate', 'latency', 'error'}
                higher_is_better = not any(k in metric.lower() for k in lower_is_better_keywords)

                results[metric] = {
                    'production': prod_val,
                    'shadow': shadow_val,
                    'improvement': self.calculate_improvement(
                        prod_val if prod_val is not None else 0.0,
                        shadow_val if shadow_val is not None else 0.0,
                        higher_is_better=higher_is_better
                    )
                }
            
            # Determine if shadow model is better
            is_better = self.is_shadow_better(results)

            improvements = [
                v['improvement'] for v in results.values()
                if isinstance(v.get('improvement'), (int, float))
            ]
            mean_improvement = sum(improvements) / len(improvements) if improvements else 0.0
            degradation = max(0.0, -mean_improvement / 100.0)

            return {
                'test_id': test_id,
                'results': results,
                'metrics': {
                    'degradation': round(degradation, 4),
                    'mean_improvement': round(mean_improvement, 4),
                    'metric_count': len(improvements),
                },
                'shadow_better': is_better,
                'should_rollback': (not is_better) or degradation > self.rollback_degradation_threshold,
                'timestamp': datetime.utcnow().isoformat()
            }
        finally:
            session.close()
    
    def calculate_improvement(
        self, prod_value: float, shadow_value: float, higher_is_better: bool = True
    ) -> float:
        """Calculate percentage improvement taking metric direction into account and handling zero prod_value."""
        if prod_value == 0:
            if shadow_value == 0:
                return 0.0
            diff = shadow_value - prod_value
            pct = diff * 100.0
            return pct if higher_is_better else -pct

        diff = shadow_value - prod_value
        pct = (diff / abs(prod_value)) * 100.0
        return pct if higher_is_better else -pct

    
    
    def is_shadow_better(self, results: Dict) -> bool:
        """Determine if shadow model outperforms production based on metric direction and threshold."""
        better_count = 0
        total_metrics = 0

        lower_is_better_keywords = {'rmse', 'mae', 'mse', 'loss', 'error_rate', 'latency', 'error'}

        for metric, values in results.items():
            prod = values.get('production')
            shadow = values.get('shadow')
            if prod is None or shadow is None:
                continue

            total_metrics += 1
            metric_lower = metric.lower()
            is_lower_better = any(k in metric_lower for k in lower_is_better_keywords)

            if is_lower_better:
                if shadow < prod * self.threshold:
                    better_count += 1
            else:
                if shadow > prod * self.threshold:
                    better_count += 1

        return better_count > (total_metrics / 2) if total_metrics > 0 else False

    
    
    def get_active_test(self) -> Optional[Dict]:
        """Get currently active A/B test from database"""
        session = self.Session()
        try:
            recent = session.query(ABTestMetrics).filter(
                ABTestMetrics.timestamp <= datetime.utcnow()
            ).order_by(ABTestMetrics.timestamp.desc()).first()

            if recent:
                return {
                    'test_id': recent.test_id,
                    'production_version': self.get_production_version(),
                    'shadow_version': recent.model_version,
                    'started_at': recent.timestamp.isoformat(),
                    'status': 'active'
                }
            return None
        except Exception:
            return None
        finally:
            session.close()

    def _current_production_row(self, session) -> Optional[ABTestVersion]:
        """Return the single registry row currently serving production."""
        return session.query(ABTestVersion).filter(
            ABTestVersion.status == 'production'
        ).order_by(ABTestVersion.id.desc()).first()

    def _shadow_versions(self, session, test_id: str) -> list:
        """Return the distinct shadow model versions logged for a test."""
        rows = session.query(ABTestMetrics.model_version).filter(
            ABTestMetrics.test_id == test_id,
            ABTestMetrics.model_version != 'production'
        ).distinct().all()
        return [row[0] for row in rows]

    def get_production_version(self) -> str:
        """Return the currently serving model version from the registry.

        Falls back to 'production' when no version has ever been registered.
        """
        session = self.Session()
        try:
            row = self._current_production_row(session)
            return row.version if row else 'production'
        finally:
            session.close()

    def trigger_rollback(self, test_id: str) -> Dict[str, Any]:
        """Auto-rollback to previous version if shadow model underperforms"""
        evaluation = self.evaluate_test(test_id)

        if evaluation.get('should_rollback', False):
            session = self.Session()
            try:
                current = self._current_production_row(session)
                restored_version = current.version if current else 'production'

                if current:
                    current.status = 'superseded'

                session.add(ABTestVersion(
                    version=restored_version,
                    status='production',
                    test_id=test_id,
                    created_at=datetime.utcnow()
                ))
                session.commit()

                shadow_versions = self._shadow_versions(session, test_id)
                degraded_version = shadow_versions[-1] if shadow_versions else 'shadow'
            finally:
                session.close()

            logger.warning(
                f"Rollback triggered for test {test_id}: "
                f"restored production to '{restored_version}'"
            )

            return {
                'action': 'rollback',
                'test_id': test_id,
                'reason': 'Shadow model underperformed',
                'production_version': restored_version,
                'previous_version': degraded_version,
                'timestamp': datetime.utcnow().isoformat()
            }

        session = self.Session()
        try:
            current = self._current_production_row(session)
            previous_version = current.version if current else 'production'

            shadow_versions = self._shadow_versions(session, test_id)
            promoted_version = shadow_versions[-1] if shadow_versions else previous_version

            if current:
                current.status = 'superseded'

            session.add(ABTestVersion(
                version=promoted_version,
                status='production',
                test_id=test_id,
                created_at=datetime.utcnow()
            ))
            session.commit()
        finally:
            session.close()

        return {
            'action': 'promote',
            'test_id': test_id,
            'reason': 'Shadow model performed well',
            'production_version': promoted_version,
            'previous_version': previous_version,
            'timestamp': datetime.utcnow().isoformat()
        }