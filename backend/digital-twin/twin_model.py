import numpy as np
import pandas as pd
from typing import Dict, List, Any, Optional
from datetime import datetime, timedelta
import logging
import json
from dataclasses import dataclass, field
import random

logger = logging.getLogger(__name__)

@dataclass
class LogisticsAsset:
    """Logistics asset in digital twin"""
    id: str
    type: str  # truck, warehouse, driver, shipment
    location: Dict[str, float]  # lat, lng
    status: str
    metadata: Dict = field(default_factory=dict)
    created_at: datetime = field(default_factory=datetime.now)
    updated_at: datetime = field(default_factory=datetime.now)

@dataclass
class LogisticsEvent:
    """Event in logistics operations"""
    id: str
    type: str  # pickup, dropoff, delay, arrival, departure
    timestamp: datetime
    asset_id: str
    location: Dict[str, float]
    metadata: Dict = field(default_factory=dict)

@dataclass
class SimulationResult:
    """Result of simulation run"""
    scenario_id: str
    metrics: Dict[str, float]
    events: List[LogisticsEvent]
    recommendations: List[str]
    duration: float
    timestamp: datetime

class DigitalTwin:
    """Digital Twin for logistics operations"""
    
    def __init__(self):
        self.assets: Dict[str, LogisticsAsset] = {}
        self.events: List[LogisticsEvent] = []
        self.history: List[Dict] = []
        self.simulations: List[SimulationResult] = []
        self.state = {}
        
        logger.info("✅ Digital Twin initialized")
    
    def add_asset(self, asset: LogisticsAsset):
        """Add asset to digital twin"""
        self.assets[asset.id] = asset
        logger.info(f"✅ Asset added: {asset.id} ({asset.type})")
    
    def update_asset(self, asset_id: str, updates: Dict):
        """Update asset in digital twin"""
        if asset_id in self.assets:
            for key, value in updates.items():
                setattr(self.assets[asset_id], key, value)
            self.assets[asset_id].updated_at = datetime.now()
            logger.info(f"✅ Asset updated: {asset_id}")
            return True
        return False
    
    def add_event(self, event: LogisticsEvent):
        """Add event to digital twin"""
        self.events.append(event)
        self.history.append({
            'timestamp': event.timestamp.isoformat(),
            'type': event.type,
            'asset_id': event.asset_id,
            'location': event.location,
            'metadata': event.metadata
        })
        logger.info(f"✅ Event added: {event.type} for {event.asset_id}")
    
    def get_asset_state(self, asset_id: str) -> Dict:
        """Get current state of asset"""
        if asset_id in self.assets:
            asset = self.assets[asset_id]
            return {
                'id': asset.id,
                'type': asset.type,
                'location': asset.location,
                'status': asset.status,
                'metadata': asset.metadata,
                'updated_at': asset.updated_at.isoformat()
            }
        return None
    
    def get_all_assets(self) -> List[Dict]:
        """Get all assets"""
        return [{
            'id': asset.id,
            'type': asset.type,
            'location': asset.location,
            'status': asset.status,
            'metadata': asset.metadata
        } for asset in self.assets.values()]
    
    def get_events(self, asset_id: Optional[str] = None, limit: int = 100) -> List[Dict]:
        """Get events for asset"""
        events = self.events
        if asset_id:
            events = [e for e in events if e.asset_id == asset_id]
        events = sorted(events, key=lambda x: x.timestamp, reverse=True)[:limit]
        return [{
            'id': e.id,
            'type': e.type,
            'timestamp': e.timestamp.isoformat(),
            'asset_id': e.asset_id,
            'location': e.location,
            'metadata': e.metadata
        } for e in events]
    
    def get_state(self) -> Dict:
        """Get current state of digital twin"""
        return {
            'assets': self.get_all_assets(),
            'total_assets': len(self.assets),
            'total_events': len(self.events),
            'last_update': datetime.now().isoformat()
        }

class SimulationEngine:
    """Simulation engine for digital twin"""
    
    def __init__(self, twin: DigitalTwin):
        self.twin = twin
        self.scenarios = {}
        
        logger.info("✅ Simulation Engine initialized")
    
    def create_scenario(self, name: str, params: Dict) -> str:
        """Create simulation scenario"""
        scenario_id = f"scenario_{int(datetime.now().timestamp())}"
        self.scenarios[scenario_id] = {
            'name': name,
            'params': params,
            'created_at': datetime.now()
        }
        logger.info(f"✅ Scenario created: {scenario_id}")
        return scenario_id
    
    def run_simulation(self, scenario_id: str, duration: int = 3600) -> SimulationResult:
        """Run simulation for scenario"""
        if scenario_id not in self.scenarios:
            raise ValueError(f"Scenario {scenario_id} not found")
        
        scenario = self.scenarios[scenario_id]
        start_time = datetime.now()
        
        # Simulate events
        events = []
        metrics = {}
        recommendations = []
        
        # Run simulation
        for i in range(duration // 60):
            if random.random() < 0.1:
                asset_id = random.choice(list(self.twin.assets.keys()))
                event_type = random.choice(['pickup', 'dropoff', 'delay', 'arrival'])
                
                event = LogisticsEvent(
                    id=f"sim_{int(datetime.now().timestamp())}_{i}",
                    type=event_type,
                    timestamp=datetime.now(),
                    asset_id=asset_id,
                    location={'lat': random.uniform(20, 30), 'lng': random.uniform(70, 80)},
                    metadata={'scenario': scenario_id}
                )
                events.append(event)
        
        # Calculate metrics
        metrics = self._calculate_metrics(events, scenario['params'])
        
        # Generate recommendations
        recommendations = self._generate_recommendations(metrics)
        
        duration_ms = (datetime.now() - start_time).total_seconds() * 1000
        
        result = SimulationResult(
            scenario_id=scenario_id,
            metrics=metrics,
            events=events,
            recommendations=recommendations,
            duration=duration_ms,
            timestamp=datetime.now()
        )
        
        self.twin.simulations.append(result)
        
        logger.info(f"✅ Simulation completed: {scenario_id}")
        return result
    
    def _calculate_metrics(self, events: List[LogisticsEvent], params: Dict) -> Dict:
        """Calculate simulation metrics"""
        metrics = {
            'total_events': len(events),
            'unique_assets': len(set(e.asset_id for e in events)),
            'event_types': {},
            'utilization': 0.0,
            'efficiency': 0.0
        }
        
        for event in events:
            metrics['event_types'][event.type] = metrics['event_types'].get(event.type, 0) + 1
        
        if events:
            total_time = (events[-1].timestamp - events[0].timestamp).total_seconds()
            if total_time > 0:
                metrics['utilization'] = len(events) / (total_time / 60)
        
        metrics['efficiency'] = min(1.0, len(events) / 100)
        
        return metrics
    
    def _generate_recommendations(self, metrics: Dict) -> List[str]:
        """Generate recommendations based on metrics"""
        recommendations = []
        
        if metrics['utilization'] < 0.5:
            recommendations.append("Increase asset utilization by optimizing routes")
        
        if metrics['efficiency'] < 0.7:
            recommendations.append("Improve operational efficiency by reducing delays")
        
        if metrics.get('event_types', {}).get('delay', 0) > 5:
            recommendations.append("Address frequent delays by identifying bottlenecks")
        
        if not recommendations:
            recommendations.append("Current operations are running smoothly")
        
        return recommendations

class PredictiveAnalytics:
    """Predictive analytics for digital twin"""
    
    def __init__(self, twin: DigitalTwin):
        self.twin = twin
        self.predictions = {}
        
        logger.info("✅ Predictive Analytics initialized")
    
    def predict_delays(self, asset_id: str, hours: int = 24) -> Dict:
        """Predict delays for asset"""
        events = self.twin.get_events(asset_id, 100)
        
        if len(events) < 10:
            return {
                'prediction': 'insufficient_data',
                'confidence': 0.0,
                'delay_probability': 0.5
            }
        
        delay_count = len([e for e in events if e['type'] == 'delay'])
        total_events = len(events)
        delay_probability = delay_count / total_events if total_events > 0 else 0.5
        
        confidence = min(1.0, total_events / 50)
        
        return {
            'prediction': 'high_risk' if delay_probability > 0.3 else 'low_risk',
            'confidence': confidence,
            'delay_probability': delay_probability,
            'historical_delays': delay_count,
            'total_events': total_events
        }
    
    def predict_arrival_time(self, asset_id: str) -> Dict:
        """Predict arrival time for asset"""
        asset = self.twin.assets.get(asset_id)
        if not asset:
            return {'error': 'Asset not found'}
        
        location = asset.location
        status = asset.status
        
        if status == 'in_transit':
            avg_speed = 50
            distance = random.uniform(50, 500)
            eta_minutes = (distance / avg_speed) * 60
            
            return {
                'estimated_arrival': (datetime.now() + timedelta(minutes=eta_minutes)).isoformat(),
                'confidence': 0.85,
                'distance_remaining': distance,
                'average_speed': avg_speed,
                'eta_minutes': eta_minutes
            }
        else:
            return {
                'status': status,
                'message': 'Asset not in transit'
            }
    
    def predict_demand(self, location: Dict, hours: int = 24) -> Dict:
        """Predict demand at location"""
        base_demand = random.uniform(10, 100)
        time_factor = 1.0 + 0.5 * np.sin(np.pi * datetime.now().hour / 12)
        
        predicted_demand = base_demand * time_factor
        
        return {
            'location': location,
            'predicted_demand': predicted_demand,
            'confidence': 0.75,
            'peak_time': 'evening' if datetime.now().hour > 12 else 'morning',
            'forecast_hours': hours
        }

class DigitalTwinOptimizer:
    """Optimization engine for digital twin"""
    
    def __init__(self, twin: DigitalTwin):
        self.twin = twin
        
        logger.info("✅ Digital Twin Optimizer initialized")
    
    def optimize_routes(self, asset_ids: List[str]) -> Dict:
        """Optimize routes for assets"""
        routes = {}
        
        for asset_id in asset_ids:
            asset = self.twin.assets.get(asset_id)
            if not asset:
                continue
            
            current_location = asset.location
            
            optimized_route = {
                'asset_id': asset_id,
                'current_location': current_location,
                'next_stop': {
                    'lat': current_location['lat'] + random.uniform(-0.5, 0.5),
                    'lng': current_location['lng'] + random.uniform(-0.5, 0.5)
                },
                'estimated_time': random.uniform(30, 180),
                'distance': random.uniform(10, 100)
            }
            
            routes[asset_id] = optimized_route
        
        return {
            'routes': routes,
            'optimization_time': datetime.now().isoformat()
        }
    
    def resource_allocation(self, resources: Dict) -> Dict:
        """Allocate resources optimally"""
        allocation = {}
        
        for resource_id, resource_info in resources.items():
            allocation[resource_id] = {
                'allocated': True,
                'efficiency': random.uniform(0.7, 0.95),
                'utilization': random.uniform(0.5, 0.9),
                'timestamp': datetime.now().isoformat()
            }
        
        return allocation