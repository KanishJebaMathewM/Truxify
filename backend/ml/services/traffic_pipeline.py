import requests
import json
import asyncio
import aiohttp
from datetime import datetime, timedelta
from typing import Dict, List, Optional
import numpy as np
import pandas as pd
from sqlalchemy import create_engine, Column, String, Float, DateTime, Integer, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers, models
import redis
import os
import logging

logger = logging.getLogger(__name__)
Base = declarative_base()

class TrafficData(Base):
    __tablename__ = 'traffic_data'
    
    id = Column(Integer, primary_key=True)
    route_id = Column(String(100))
    source_lat = Column(Float)
    source_lng = Column(Float)
    dest_lat = Column(Float)
    dest_lng = Column(Float)
    traffic_speed = Column(Float)
    free_flow_speed = Column(Float)
    congestion_level = Column(Float)
    timestamp = Column(DateTime, default=datetime.utcnow)
    day_of_week = Column(Integer)
    hour = Column(Integer)

class TrafficPipeline:
    def __init__(self, db_url: str, redis_url: str):
        self.engine = create_engine(db_url)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.redis = redis.Redis.from_url(redis_url)
        self.model = self._load_or_create_model()
        self.gmaps_api_key = os.getenv('GOOGLE_MAPS_API_KEY', '')
        self.osrm_url = os.getenv('OSRM_URL', 'http://localhost:5000')
        
    def _load_or_create_model(self):
        """Load existing LSTM model or create new"""
        model_path = 'models/eta_lstm.h5'
        if os.path.exists(model_path):
            logger.info("Loading existing LSTM model")
            return keras.models.load_model(model_path)
        else:
            logger.info("Creating new LSTM model")
            return self._create_lstm_model()
    
    def _create_lstm_model(self):
        """Create LSTM model for ETA prediction"""
        model = models.Sequential([
            layers.LSTM(64, input_shape=(60, 5), return_sequences=True),
            layers.Dropout(0.2),
            layers.LSTM(32, return_sequences=True),
            layers.Dropout(0.2),
            layers.LSTM(16),
            layers.Dropout(0.2),
            layers.Dense(8, activation='relu'),
            layers.Dense(1)
        ])
        
        model.compile(
            optimizer=keras.optimizers.Adam(learning_rate=0.001),
            loss='mse',
            metrics=['mae']
        )
        return model
    
    async def ingest_traffic_data(self, route_id: str, source: Dict, dest: Dict):
        """Ingest real-time traffic data from multiple sources"""
        try:
            # Get data from Google Maps
            gmaps_data = await self._fetch_gmaps_traffic(source, dest)
            
            # Get data from OSRM
            osrm_data = await self._fetch_osrm_data(source, dest)
            
            # Combine and store
            traffic_entry = TrafficData(
                route_id=route_id,
                source_lat=source['lat'],
                source_lng=source['lng'],
                dest_lat=dest['lat'],
                dest_lng=dest['lng'],
                traffic_speed=gmaps_data.get('speed', osrm_data.get('speed', 50)),
                free_flow_speed=osrm_data.get('free_flow_speed', 80),
                congestion_level=gmaps_data.get('congestion', 0.3),
                day_of_week=datetime.now().weekday(),
                hour=datetime.now().hour
            )
            
            session = self.Session()
            try:
                session.add(traffic_entry)
                session.commit()
            except Exception:
                session.rollback()
                raise
            finally:
                session.close()
            
            # Cache in Redis
            self.redis.setex(
                f"traffic:{route_id}",
                300,  # 5 minutes
                json.dumps({
                    'speed': traffic_entry.traffic_speed,
                    'congestion': traffic_entry.congestion_level,
                    'timestamp': traffic_entry.timestamp.isoformat()
                })
            )
            
            logger.info(f"Traffic data ingested for route {route_id}")
            return traffic_entry
            
        except Exception as e:
            logger.error(f"Traffic ingestion failed: {e}")
            return None
    
    async def _fetch_gmaps_traffic(self, source: Dict, dest: Dict):
        """Fetch traffic data from Google Maps API"""
        if not self.gmaps_api_key:
            return {}
            
        url = "https://maps.googleapis.com/maps/api/directions/json"
        params = {
            'origin': f"{source['lat']},{source['lng']}",
            'destination': f"{dest['lat']},{dest['lng']}",
            'departure_time': 'now',
            'traffic_model': 'best_guess',
            'key': self.gmaps_api_key
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.get(url, params=params) as response:
                data = await response.json()
                if data.get('routes'):
                    route = data['routes'][0]['legs'][0]
                    duration = route.get('duration_in_traffic', {}).get('value', 0)
                    normal_duration = route.get('duration', {}).get('value', 1)
                    
                    return {
                        'duration': duration,
                        'speed': route.get('distance', {}).get('value', 0) / duration if duration > 0 else 50,
                        'congestion': 1 - (duration / normal_duration) if normal_duration > 0 else 0
                    }
        return {}
    
    async def _fetch_osrm_data(self, source: Dict, dest: Dict):
        """Fetch routing data from OSRM"""
        url = f"{self.osrm_url}/route/v1/driving/{source['lng']},{source['lat']};{dest['lng']},{dest['lat']}"
        
        async with aiohttp.ClientSession() as session:
            async with session.get(url) as response:
                data = await response.json()
                if data.get('routes'):
                    route = data['routes'][0]
                    return {
                        'duration': route['duration'],
                        'distance': route['distance'],
                        'speed': route['distance'] / route['duration'] if route['duration'] > 0 else 50,
                        'free_flow_speed': route['distance'] / (route['duration'] * 0.8) if route['duration'] > 0 else 80
                    }
        return {'speed': 50, 'free_flow_speed': 80}
    
    async def get_real_time_traffic(self, route_id: str):
        """Get real-time traffic data for a route"""
        cached = self.redis.get(f"traffic:{route_id}")
        if cached:
            return json.loads(cached)
        return None
    
    def predict_eta(self, route_data: np.ndarray) -> float:
        """Predict ETA using LSTM model"""
        try:
            # Reshape for LSTM input: (batch, timesteps, features)
            if len(route_data.shape) == 2:
                route_data = route_data.reshape(1, *route_data.shape)
            elif len(route_data.shape) == 1:
                route_data = route_data.reshape(1, 1, -1)
                
            prediction = self.model.predict(route_data, verbose=0)
            return float(prediction[0][0])
        except Exception as e:
            logger.error(f"Prediction failed: {e}")
            return None
    
    def train_model(self, epochs=50, batch_size=32):
        """Train LSTM model on historical data"""
        session = self.Session()
        data = session.query(TrafficData).all()
        session.close()
        
        if len(data) < 100:
            logger.warning("Not enough data for training")
            return
        
        # Prepare features
        df = pd.DataFrame([{
            'traffic_speed': d.traffic_speed,
            'free_flow_speed': d.free_flow_speed,
            'congestion_level': d.congestion_level,
            'hour': d.hour,
            'day_of_week': d.day_of_week,
            'timestamp': d.timestamp
        } for d in data])
        
        # Create sequences
        features = ['traffic_speed', 'free_flow_speed', 'congestion_level', 'hour', 'day_of_week']
        X, y = self._create_sequences(df[features], 'traffic_speed')
        
        # Train
        self.model.fit(
            X, y,
            epochs=epochs,
            batch_size=batch_size,
            validation_split=0.2,
            verbose=1
        )
        
        # Save model
        self.model.save('models/eta_lstm.h5')
        logger.info("Model trained and saved")
    
    def _create_sequences(self, data: pd.DataFrame, target_col: str, seq_length=60):
        """Create sequences for LSTM training"""
        X, y = [], []
        for i in range(len(data) - seq_length):
            X.append(data.iloc[i:i+seq_length].values)
            y.append(data.iloc[i+seq_length][target_col])
        return np.array(X), np.array(y)
    
    async def update_eta_realtime(self, order_id: str, current_location: Dict, destination: Dict):
        """Update ETA in real-time during trip"""
        try:
            # Get current traffic
            traffic_data = await self.ingest_traffic_data(
                f"order_{order_id}",
                current_location,
                destination
            )
            
            if traffic_data:
                # Prepare features for prediction
                features = np.array([[
                    traffic_data.traffic_speed,
                    traffic_data.free_flow_speed,
                    traffic_data.congestion_level,
                    datetime.now().hour,
                    datetime.now().weekday()
                ]])
                
                # Predict ETA
                eta_seconds = self.predict_eta(features)
                
                if eta_seconds:
                    eta_minutes = eta_seconds / 60
                    eta_string = str(timedelta(seconds=int(eta_seconds)))
                    
                    # Update Redis
                    self.redis.setex(
                        f"eta:order:{order_id}",
                        300,  # 5 minutes
                        json.dumps({
                            'eta_seconds': eta_seconds,
                            'eta_minutes': eta_minutes,
                            'eta_string': eta_string,
                            'timestamp': datetime.now().isoformat(),
                            'traffic_speed': traffic_data.traffic_speed,
                            'congestion_level': traffic_data.congestion_level
                        })
                    )
                    
                    logger.info(f"ETA updated for order {order_id}: {eta_string}")
                    return {
                        'eta_seconds': eta_seconds,
                        'eta_minutes': eta_minutes,
                        'eta_string': eta_string,
                        'traffic_speed': traffic_data.traffic_speed,
                        'congestion_level': traffic_data.congestion_level
                    }
            
            return None
            
        except Exception as e:
            logger.error(f"ETA update failed: {e}")
            return None
    
    async def get_route_congestion(self, route_id: str):
        """Get congestion level for a route"""
        traffic = await self.get_real_time_traffic(route_id)
        if traffic:
            return traffic.get('congestion', 0)
        return 0
    
    async def get_traffic_forecast(self, route_id: str, hours: int = 1):
        """Get traffic forecast for next N hours"""
        # Get historical data for this route
        session = self.Session()
        data = session.query(TrafficData).filter(
            TrafficData.route_id == route_id
        ).order_by(TrafficData.timestamp.desc()).limit(24).all()
        session.close()
        
        if len(data) < 10:
            return {'forecast': None, 'confidence': 'low'}
        
        # Simple forecast using historical average
        avg_speed = np.mean([d.traffic_speed for d in data])
        std_speed = np.std([d.traffic_speed for d in data])
        
        return {
            'forecast': avg_speed,
            'std': std_speed,
            'confidence': 'medium' if len(data) > 20 else 'low',
            'historical_data_points': len(data)
        }