from collections import deque
from datetime import datetime, timedelta

import numpy as np

from . import traffic_pipeline as _traffic_pipeline


ETA_TRAINING_HISTORY_DAYS = int(
    _traffic_pipeline.os.getenv("ETA_TRAINING_HISTORY_DAYS", "30")
)
ETA_TRAINING_FETCH_BATCH_SIZE = int(
    _traffic_pipeline.os.getenv("ETA_TRAINING_FETCH_BATCH_SIZE", "1000")
)
ETA_TRAINING_SEQUENCE_BATCH_SIZE = int(
    _traffic_pipeline.os.getenv("ETA_TRAINING_SEQUENCE_BATCH_SIZE", "256")
)


def _iter_training_batches(self, session, cutoff, sequence_batch_size):
    """Yield bounded route-aware training batches from the database."""
    query = (
        session.query(_traffic_pipeline.TrafficData)
        .filter(_traffic_pipeline.TrafficData.timestamp >= cutoff)
        .order_by(
            _traffic_pipeline.TrafficData.route_id.asc(),
            _traffic_pipeline.TrafficData.timestamp.asc(),
        )
        .yield_per(ETA_TRAINING_FETCH_BATCH_SIZE)
    )

    window = deque(maxlen=61)
    current_route = None
    X_batch = []
    y_batch = []
    features = (
        "traffic_speed",
        "free_flow_speed",
        "congestion_level",
        "hour",
        "day_of_week",
    )

    for row in query:
        if row.route_id != current_route:
            window.clear()
            current_route = row.route_id

        window.append([getattr(row, feature) for feature in features])
        if len(window) < 61:
            continue

        sequence = np.asarray(window, dtype=np.float32)
        X_batch.append(sequence[:-1])
        y_batch.append(sequence[-1, 0])

        if len(X_batch) >= sequence_batch_size:
            yield (
                np.asarray(X_batch, dtype=np.float32),
                np.asarray(y_batch, dtype=np.float32),
            )
            X_batch = []
            y_batch = []

    if X_batch:
        yield (
            np.asarray(X_batch, dtype=np.float32),
            np.asarray(y_batch, dtype=np.float32),
        )


def train_model(self, epochs=50, batch_size=32):
    """Train the LSTM from a bounded historical window and streamed batches."""
    if self.model is None:
        _traffic_pipeline.logger.warning(
            "ETA training unavailable because TensorFlow is not installed"
        )
        return

    history_days = max(1, ETA_TRAINING_HISTORY_DAYS)
    sequence_batch_size = max(1, min(batch_size, ETA_TRAINING_SEQUENCE_BATCH_SIZE))
    cutoff = datetime.utcnow() - timedelta(days=history_days)

    session = self.Session()
    try:
        row_count = session.query(_traffic_pipeline.TrafficData).filter(
            _traffic_pipeline.TrafficData.timestamp >= cutoff
        ).count()
        if row_count < 100:
            _traffic_pipeline.logger.warning("Not enough historical data for training")
            return

        trained_batches = 0
        for epoch in range(epochs):
            epoch_batches = 0
            for X_batch, y_batch in self._iter_training_batches(
                session,
                cutoff,
                sequence_batch_size,
            ):
                self.model.fit(
                    X_batch,
                    y_batch,
                    epochs=1,
                    batch_size=min(batch_size, len(X_batch)),
                    verbose=0,
                )
                epoch_batches += 1
                trained_batches += 1

            if epoch_batches == 0:
                _traffic_pipeline.logger.warning(
                    "No complete route sequences available for training"
                )
                return

            if epoch % 10 == 0:
                _traffic_pipeline.logger.info(
                    "Epoch %d: trained on %d streamed batches",
                    epoch,
                    epoch_batches,
                )

        _traffic_pipeline.logger.info(
            "Model trained from %d streamed batches", trained_batches
        )
    finally:
        session.close()

    _traffic_pipeline.os.makedirs(
        _traffic_pipeline.os.path.dirname("models/eta_lstm.h5"),
        exist_ok=True,
    )
    self.model.save("models/eta_lstm.h5")
    _traffic_pipeline.logger.info("Model trained and saved")


_TrafficPipeline = _traffic_pipeline.TrafficPipeline
_TrafficPipeline._iter_training_batches = _iter_training_batches
_TrafficPipeline.train_model = train_model
