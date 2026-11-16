import logging

import numpy as np
from tensorflow import keras
from tensorflow.keras import layers

logger = logging.getLogger(__name__)


class LSTMAutoencoder:
    """LSTM Autoencoder for Anomaly Detection"""

    def __init__(self, input_dim: int, sequence_length: int = 60, latent_dim: int = 32):
        self.input_dim = input_dim
        self.sequence_length = sequence_length
        self.latent_dim = latent_dim
        self.model = None
        self.encoder = None
        self.decoder = None
        self.threshold = None
        # Per-entity ring buffer: entity_id -> deque of recent observations
        self._observation_buffer = {}

    def build_model(self):
        """Build one flat trained graph and shared encoder/decoder views."""
        from numbers import Integral

        for name in ("input_dim", "sequence_length", "latent_dim"):
            value = getattr(self, name)
            if (
                isinstance(value, (bool, np.bool_))
                or not isinstance(value, Integral)
                or value <= 0
            ):
                raise ValueError(f"{name} must be a positive integer")

        encoder_inputs = layers.Input(shape=(self.sequence_length, self.input_dim))
        x = layers.LSTM(64, return_sequences=True, activation="relu")(encoder_inputs)
        x = layers.Dropout(0.2)(x)
        x = layers.LSTM(32, return_sequences=True, activation="relu")(x)
        x = layers.Dropout(0.2)(x)
        latent = layers.LSTM(self.latent_dim, activation="relu")(x)
        encoder = keras.Model(encoder_inputs, latent)

        # Reuse actual layer instances, preserving the old flat weighted-layer
        # topology. Building an independent decoder would leave it untrained.
        decoder_layers = [
            layers.RepeatVector(self.sequence_length),
            layers.LSTM(32, return_sequences=True, activation="relu"),
            layers.Dropout(0.2),
            layers.LSTM(64, return_sequences=True, activation="relu"),
            layers.Dropout(0.2),
            layers.TimeDistributed(layers.Dense(self.input_dim)),
        ]
        x = latent
        for layer in decoder_layers:
            x = layer(x)
        model = keras.Model(encoder_inputs, x)
        model.compile(optimizer=keras.optimizers.Adam(learning_rate=0.001), loss="mse")

        decoder_input = layers.Input(shape=(self.latent_dim,))
        x = decoder_input
        for layer in decoder_layers:
            x = layer(x)
        decoder = keras.Model(decoder_input, x)

        # Publish only after the complete view set builds successfully. A fresh
        # randomly initialized generation must not inherit old calibration.
        self.model, self.encoder, self.decoder = model, encoder, decoder
        self.threshold = None
        self._observation_buffer = {}
        logger.info("LSTM Autoencoder and shared views built")
        return model

    def train(self, X_train, X_val=None, epochs=50, batch_size=32):
        """Train the autoencoder"""
        if self.model is None:
            self.build_model()

        # Training
        history = self.model.fit(
            X_train,
            X_train,
            epochs=epochs,
            batch_size=batch_size,
            validation_data=(X_val, X_val) if X_val is not None else None,
            shuffle=True,
            verbose=1,
        )

        # Calculate reconstruction error threshold
        train_reconstructions = self.model.predict(X_train)
        train_errors = np.mean(np.square(train_reconstructions - X_train), axis=(1, 2))
        self.threshold = np.percentile(train_errors, 95)

        logger.info(f"✅ Model trained. Threshold: {self.threshold:.4f}")
        return history

    def detect_anomalies(self, X_test):
        """Detect anomalies in test data"""
        if self.model is None:
            raise ValueError("Model not trained yet")

        # Get reconstructions
        reconstructions = self.model.predict(X_test)

        # Calculate reconstruction errors
        errors = np.mean(np.square(reconstructions - X_test), axis=(1, 2))

        # Classify anomalies
        anomalies = errors > self.threshold
        anomaly_scores = errors / self.threshold

        return {
            "reconstructions": reconstructions,
            "errors": errors,
            "anomalies": anomalies,
            "anomaly_scores": anomaly_scores,
            "threshold": self.threshold,
        }

    def get_anomaly_score(self, sequence):
        """Get anomaly score for a sequence.

        Expects a genuine (sequence_length, input_dim) window. Tiling a single
        feature vector into a constant 60-step sequence fed the model
        out-of-distribution inputs for a model trained on diverse multi-step
        sequences (issue #11669); callers must supply the real rolling window
        instead, so single-step inputs are rejected rather than silently
        tiled.
        """
        if self.model is None:
            raise ValueError("Model not trained yet")

        sequence = np.array(sequence, dtype=np.float32)
        if sequence.ndim == 1:
            sequence = sequence.reshape(1, -1)
        if sequence.shape[1] != self.input_dim:
            raise ValueError(
                f"Expected {self.input_dim} features per timestep, got {sequence.shape[1]}"
            )
        if sequence.shape[0] < self.sequence_length:
            raise ValueError(
                f"Expected at least {self.sequence_length} timesteps, got {sequence.shape[0]}. "
                "Feed a genuine rolling window (issue #11669)."
            )

        sequence = sequence[: self.sequence_length].reshape(
            1, self.sequence_length, self.input_dim
        )
        reconstruction = self.model.predict(sequence, verbose=0)
        error = np.mean(np.square(reconstruction - sequence))
        score = error / self.threshold if self.threshold else error

        return {
            "reconstruction_error": float(error),
            "anomaly_score": float(score),
            "is_anomaly": score > 1.0 if self.threshold else False,
        }

    def save(self, path: str = "models/anomaly"):
        """Save model and threshold"""
        if self.model is None:
            raise ValueError("Model not built yet")

        self.model.save(f"{path}.h5")

        # Save metadata
        import json

        metadata = {
            "input_dim": self.input_dim,
            "sequence_length": self.sequence_length,
            "latent_dim": self.latent_dim,
            "threshold": float(self.threshold) if self.threshold is not None else None,
        }
        with open(f"{path}_metadata.json", "w") as f:
            json.dump(metadata, f)

        logger.info(f"✅ Model saved to {path}")

    def load(self, path: str = "models/anomaly"):
        """Load model and threshold"""
        import json

        with open(f"{path}_metadata.json", "r") as f:
            metadata = json.load(f)

        self.input_dim = metadata["input_dim"]
        self.sequence_length = metadata["sequence_length"]
        self.latent_dim = metadata["latent_dim"]
        self.build_model()
        self.model.load_weights(f"{path}.h5")
        self.threshold = metadata["threshold"]

        logger.info(f"✅ Model loaded from {path}")
