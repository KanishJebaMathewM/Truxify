import requests
import json
import asyncio
import aiohttp
import hashlib
from datetime import datetime, timedelta
from typing import Dict, List, Optional
import numpy as np
import pandas as pd
from sqlalchemy import create_engine, Column, String, Float, DateTime, Integer, Boolean
from sqlalchemy.orm import declarative_base
from sqlalchemy.orm import sessionmaker
try:
    import tensorflow as tf
    from tensorflow import keras
    from tensorflow.keras import layers, models
    HAS_TF = True
except ImportError:
    tf = None
    keras = None
    layers = None
    models = None
    HAS_TF = False
import redis
import os
import logging
from functools import partial
from collections import deque, OrderedDict

logger = logging.getLogger(__name__)
Base = declarative_base()

DEFAULT_TRAFFIC_SPEED = 50.0
DEFAULT_FREE_FLOW_SPEED = 80.0
DEFAULT_CONGESTION_LEVEL = 0.3


def eta_seconds_from_speed(route_distance_m: float, predicted_speed_mps: float) -> Optional[float]:
    """Convert a predicted traffic speed (m/s) into a travel time (seconds).

    The LSTM is trained on traffic_speed (m/s) (see train_model), so its raw
    output is a speed, not a duration. eta_seconds = distance_m / speed_mps.
    Returns None when either input is missing or non-positive so callers can
    fall back to the routing engine's own duration estimate.
    """
    if not route_distance_m or route_distance_m <= 0:
        return None
    if not predicted_speed_mps or predicted_speed_mps <= 0:
        return None
    return route_distance_m / predicted_speed_mps

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
    MAX_ROUTE_WINDOWS = 1000

    def __init__(self, db_url: str, redis_url: str):
        self.engine = create_engine(db_url)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.redis = redis.Redis.from_url(redis_url)
        self.model = self._load_or_create_model()
        self.gmaps_api_key = os.getenv('GOOGLE_MAPS_API_KEY', '')
        self.osrm_url = os.getenv('OSRM_URL', 'http://localhost:5000')
        self.traffic_connect_timeout = float(
            os.getenv('TRAFFIC_CONNECT_TIMEOUT', '2')
        )
        self.traffic_total_timeout = float(
            os.getenv('TRAFFIC_TOTAL_TIMEOUT', '5')
        )
        self._closed = False
        # Rolling per-route history of recent feature rows, fed to predict_eta
        # as a genuine 60-step sequence instead of a tiled constant row
        # (issue #11666).
        self._route_windows = OrderedDict()
        self._max_route_windows = self.MAX_ROUTE_WINDOWS
        self._last_route_history_metrics = {
            'route_id': None,
            'route_signature': None,
            'route_key': None,
        }
        self._osrm_failure_count = 0
        self._osrm_circuit_open = False

    @staticmethod
    def build_route_signature(destination: Dict) -> str:
        """Build a stable route version from the authoritative destination."""
        payload = f"{float(destination['lat']):.7f},{float(destination['lng']):.7f}"
        return hashlib.sha256(payload.encode('utf-8')).hexdigest()[:16]

    def get_route_history_metrics(self) -> Dict[str, Optional[str]]:
        """Return the route identity used for the most recent prediction."""
        return dict(self._last_route_history_metrics)

    def close(self):
        """Dispose DB connection pool and close Redis connection.

        Safe to call multiple times.
        """
        if self._closed:
            return
        try:
            self.engine.dispose()
        except Exception as e:
            logger.error(f"Error disposing SQLAlchemy engine: {e}")
        try:
            self.redis.close()
        except Exception as e:
            logger.error(f"Error closing Redis connection: {e}")
        self._closed = True
        logger.info("TrafficPipeline resources released")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()

    def __del__(self):
        try:
            if not getattr(self, '_closed', True):
                self.close()
        except Exception:
            pass
        
    def _load_or_create_model(self):
        """Load existing LSTM model or create new, when TensorFlow is available."""
        if not HAS_TF:
            logger.warning("TensorFlow is unavailable; ETA model features are disabled")
            return None

        model_path = 'models/eta_lstm.h5'
        if os.path.exists(model_path):
            logger.info("Loading existing LSTM model")
            return keras.models.load_model(model_path)
        else:
            logger.info("Creating new LSTM model")
            return self._create_lstm_model()

    def _create_lstm_model(self):
        """Create LSTM model for ETA prediction."""
        if not HAS_TF:
            return None

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
            gmaps_data = await self._fetch_gmaps_traffic(source, dest)
            osrm_data = await self._fetch_osrm_data(source, dest)

            observed_at = datetime.utcnow()
            traffic_speed = gmaps_data.get('speed')
            if traffic_speed is None:
                traffic_speed = osrm_data.get('speed', DEFAULT_TRAFFIC_SPEED)
            free_flow_speed = osrm_data.get(
                'free_flow_speed',
                DEFAULT_FREE_FLOW_SPEED
            )
            congestion_level = gmaps_data.get(
                'congestion',
                DEFAULT_CONGESTION_LEVEL
            )

            gmaps_complete = (
                gmaps_data.get('duration') is not None
                and gmaps_data.get('duration') > 0
                and gmaps_data.get('speed') is not None
                and gmaps_data.get('congestion') is not None
            )
            osrm_complete = (
                osrm_data.get('duration') is not None
                and osrm_data.get('duration') > 0
                and osrm_data.get('distance') is not None
                and osrm_data.get('distance') > 0
                and osrm_data.get('speed') is not None
                and osrm_data.get('free_flow_speed') is not None
            )
            is_degraded = not (gmaps_complete and osrm_complete)

            traffic_entry = TrafficData(
                route_id=route_id,
                source_lat=source['lat'],
                source_lng=source['lng'],
                dest_lat=dest['lat'],
                dest_lng=dest['lng'],
                traffic_speed=traffic_speed,
                free_flow_speed=free_flow_speed,
                congestion_level=congestion_level,
                timestamp=observed_at,
                day_of_week=observed_at.weekday(),
                hour=observed_at.hour
            )

            if not is_degraded:
                session = self.Session()
                try:
                    session.add(traffic_entry)
                    session.commit()
                except Exception:
                    session.rollback()
                    raise
                finally:
                    session.close()
            else:
                logger.warning(
                    "Traffic ingestion degraded for route %s; "
                    "fallback values will not be stored for training",
                    route_id,
                )

            await asyncio.get_running_loop().run_in_executor(
                None, partial(self.redis.setex,
                    f"traffic:{route_id}",
                    300,
                    json.dumps({
                        'speed': traffic_entry.traffic_speed,
                        'congestion': traffic_entry.congestion_level,
                        'timestamp': traffic_entry.timestamp.isoformat(),
                        'degraded': is_degraded,
                    })
                )
            )

            return traffic_entry
            
        except Exception as e:
            logger.error(f"Traffic ingestion failed: {e}")
            return None
    
    async def _fetch_gmaps_traffic(self, source: Dict, dest: Dict):
        """Fetch traffic data from Google Maps API with timeout and fallback."""
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

        timeout = aiohttp.ClientTimeout(
        connect=self.traffic_connect_timeout,
        total=self.traffic_total_timeout,
        )

        try:
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(url, params=params) as response:
                    data = await response.json()

                    if data.get('routes'):
                        route = data['routes'][0]['legs'][0]
                        duration = route.get(
                            'duration_in_traffic', {}
                        ).get('value', 0)
                        normal_duration = route.get(
                            'duration', {}
                        ).get('value', 1)

                        return {
                            'duration': duration,
                            'speed': (
                                route.get('distance', {}).get('value', 0) / duration
                                if duration > 0
                                else 50
                            ),
                            'congestion': (
                                duration / normal_duration - 1.0
                                if normal_duration > 0
                                else 0
                            )
                        }
        except (aiohttp.ClientError, asyncio.TimeoutError, TimeoutError):
            pass

        return {}
    
    async def _fetch_osrm_data(self, source: Dict, dest: Dict):
        """Fetch routing data from OSRM with timeout, retries and circuit breaker."""
        if self._osrm_circuit_open:
            return {
                'speed': DEFAULT_TRAFFIC_SPEED,
                'free_flow_speed': DEFAULT_FREE_FLOW_SPEED,
            }

        url = (
            f"{self.osrm_url}/route/v1/driving/"
            f"{source['lng']},{source['lat']};"
            f"{dest['lng']},{dest['lat']}"
        )

        timeout = aiohttp.ClientTimeout(
        connect=self.traffic_connect_timeout,
        total=self.traffic_total_timeout,
        )
        max_attempts = 3

        for attempt in range(max_attempts):
            try:
                async with aiohttp.ClientSession(timeout=timeout) as session:
                    async with session.get(url) as response:
                        data = await response.json()

                        if data.get('routes'):
                            route = data['routes'][0]

                            # Successful request resets the circuit-breaker state.
                            self._osrm_failure_count = 0

                            return {
                                'duration': route['duration'],
                                'distance': route['distance'],
                                'speed': (
                                    route['distance'] / route['duration']
                                    if route['duration'] > 0
                                    else DEFAULT_TRAFFIC_SPEED
                                ),
                                'free_flow_speed': (
                                    route['distance'] / (route['duration'] * 0.8)
                                    if route['duration'] > 0
                                    else DEFAULT_FREE_FLOW_SPEED
                                )
                            }

            except (aiohttp.ClientError, asyncio.TimeoutError, TimeoutError):
                if attempt < max_attempts - 1:
                    await asyncio.sleep(2 ** attempt)
                else:
                    self._osrm_failure_count += 1

                    if self._osrm_failure_count >= 5:
                        self._osrm_circuit_open = True

        return {
            'speed': DEFAULT_TRAFFIC_SPEED,
            'free_flow_speed': DEFAULT_FREE_FLOW_SPEED,
        }
    
    async def get_real_time_traffic(self, route_id: str):
        """Get real-time traffic data for a route"""
        cached = await asyncio.get_running_loop().run_in_executor(None, partial(self.redis.get, f"traffic:{route_id}"))
        if cached:
            return json.loads(cached)
        return None
    
    def predict_eta(
        self,
        route_data: np.ndarray,
        route_id: Optional[str] = None,
        route_signature: Optional[str] = None,
    ) -> float:
        """Predict ETA using an order-specific rolling history."""
        try:
            if self.model is None:
                logger.warning("ETA prediction unavailable because TensorFlow model is not loaded")
                return None
            if route_data.ndim == 1:
                route_data = route_data.reshape(1, -1)
            if route_data.shape[1] != 5:
                logger.error(f"Prediction failed: expected 5 features, got {route_data.shape[1]}")
                return None

            base_route_key = route_id or ""
            route_key = (
                f"{base_route_key}:{route_signature}"
                if route_signature
                else base_route_key
            )
            self._last_route_history_metrics = {
                'route_id': base_route_key or None,
                'route_signature': route_signature,
                'route_key': route_key,
            }

            window = self._route_windows.get(route_key)
            if window is None:
                if len(self._route_windows) >= self._max_route_windows:
                    self._route_windows.popitem(last=False)
                window = deque(maxlen=60)
                self._route_windows[route_key] = window
            else:
                self._route_windows.move_to_end(route_key)

            window.append(route_data[0])

            seq = list(window)
            if len(seq) < 60:
                # Cold start: pad the front with the earliest observation so
                # the model still receives a 60-step input.
                seq = [seq[0]] * (60 - len(seq)) + seq

            model_input = np.array(seq).reshape(1, 60, 5)
            prediction = self.model.predict(model_input, verbose=0)
            return float(prediction[0][0])
        except Exception as e:
            logger.error(f"Prediction failed: {e}")
            return None
    
    def train_model(self, epochs=50, batch_size=32):
        """Train LSTM model on historical data"""
        if self.model is None:
            logger.warning("ETA training unavailable because TensorFlow is not installed")
            return

        session = self.Session()
        try:
            data = session.query(TrafficData).all()
        finally:
            session.close()
        
        if len(data) < 100:
            logger.warning("Not enough data for training")
            return
        
        # Prepare features
        df = pd.DataFrame([{
            'route_id': d.route_id,
            'traffic_speed': d.traffic_speed,
            'free_flow_speed': d.free_flow_speed,
            'congestion_level': d.congestion_level,
            'hour': d.hour,
            'day_of_week': d.day_of_week,
            'timestamp': d.timestamp
        } for d in data])
        
        # Build sequences per route in timestamp order so sliding 60-step
        # windows never span a route boundary or an arbitrary row order; a
        # window concatenated across corridors taught the LSTM spurious
        # transitions and meaningless targets (issue #11666).
        features = ['traffic_speed', 'free_flow_speed', 'congestion_level', 'hour', 'day_of_week']
        df = df.sort_values(['route_id', 'timestamp'])
        X_parts, y_parts = [], []
        for _, group in df.groupby('route_id', sort=False):
            if len(group) < 61:
                continue
            X_route, y_route = self._create_sequences(group[features], 'traffic_speed')
            X_parts.append(X_route)
            y_parts.append(y_route)

        if not X_parts:
            logger.warning("Not enough per-route data for training")
            return

        X_train_parts, y_train_parts = [], []
        X_val_parts, y_val_parts = [], []
        validation_fraction = 0.2

        for X_route, y_route in zip(X_parts, y_parts):
            if len(X_route) < 2:
                continue

            validation_count = max(1, int(np.ceil(len(X_route) * validation_fraction)))
            split_index = len(X_route) - validation_count
            if split_index < 1:
                continue

            X_train_parts.append(X_route[:split_index])
            y_train_parts.append(y_route[:split_index])
            X_val_parts.append(X_route[split_index:])
            y_val_parts.append(y_route[split_index:])

        if not X_train_parts or not X_val_parts:
            logger.warning("Not enough per-route data for deterministic validation")
            return

        X_train = np.concatenate(X_train_parts, axis=0)
        y_train = np.concatenate(y_train_parts, axis=0)
        X_val = np.concatenate(X_val_parts, axis=0)
        y_val = np.concatenate(y_val_parts, axis=0)
        
        # Train with an explicit temporal holdout from every eligible route.
        # This avoids Keras selecting the last 20% of the combined route array,
        # which can make validation depend on route ordering rather than time.
        self.model.fit(
            X_train,
            y_train,
            epochs=epochs,
            batch_size=batch_size,
            validation_data=(X_val, y_val),
            verbose=1
        )
        
        # Save model
        os.makedirs(os.path.dirname('models/eta_lstm.h5'), exist_ok=True)
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
                
                # The LSTM predicts traffic speed in m/s (it is trained on
                # traffic_speed, see _fetch_osrm_data and train_model), so its
                # output is a speed, not a duration. Convert the predicted
                # speed into an ETA in seconds using the route distance so the
                # value is meaningful as a travel time. The rolling window is
                # keyed by the order's route id (issue #11666).
                route_signature = self.build_route_signature(destination)
                predicted_speed_mps = self.predict_eta(
                    features,
                    f"order_{order_id}",
                    route_signature
                )

                if predicted_speed_mps is not None:
                    osrm_data = await self._fetch_osrm_data(current_location, destination)
                    route_distance_m = float(osrm_data.get('distance') or 0)
                    if route_distance_m > 0 and predicted_speed_mps > 0:
                        # Distance (m) / speed (m/s) yields seconds. The speed
                        # is already m/s — do NOT divide by 3.6 as if it were
                        # km/h, that inflated the ETA by 3.6x.
                        eta_seconds = route_distance_m / predicted_speed_mps
                    else:
                        # Fall back to the routing engine's duration estimate.
                        eta_seconds = float(osrm_data.get('duration') or 0)

                    eta_minutes = eta_seconds / 60
                    eta_string = str(timedelta(seconds=int(eta_seconds)))
                    
                    # Update Redis
                    await asyncio.get_running_loop().run_in_executor(
                        None, partial(self.redis.setex,
                            f"eta:order:{order_id}",
                            300,
                            json.dumps({
                                'eta_seconds': eta_seconds,
                                'eta_minutes': eta_minutes,
                                'eta_string': eta_string,
                                'timestamp': datetime.now().isoformat(),
                                'traffic_speed': traffic_data.traffic_speed,
                                'congestion_level': traffic_data.congestion_level
                            })
                        )
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
        try:
            data = session.query(TrafficData).filter(
                TrafficData.route_id == route_id
            ).order_by(TrafficData.timestamp.desc()).limit(24).all()
        finally:
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
