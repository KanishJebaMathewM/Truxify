import numpy as np

class WganGpAnomalyGenerator:
    """
    Wasserstein GAN with Gradient Penalty (WGAN-GP) telemetry anomaly generator.
    Synthesizes adversarial GPS location jumps to stress-test fraud classifiers.
    """
    def __init__(self, latent_dim: int = 16, telemetry_dim: int = 4):
        self.latent_dim = latent_dim
        self.telemetry_dim = telemetry_dim
        # Simulated generator parameters mapping random normal coordinates
        self.projection_weights = np.ones((latent_dim, telemetry_dim)) * 0.5

    def generate_adversarial_telemetry(self, batch_size: int = 3) -> dict:
        noise = np.random.normal(0, 1.0, size=(batch_size, self.latent_dim))
        
        # Generator projection map
        generated_raw = np.dot(noise, self.projection_weights)
        
        # Apply non-linear coordinate anomaly bounds (e.g. sharp simulated lat/lng jumps)
        anomalies = []
        for row in generated_raw:
            anomalies.append({
                "latitude_jump_cm": round(float(row[0]) * 100.0, 2),
                "longitude_jump_cm": round(float(row[1]) * 100.0, 2),
                "speed_anomaly_kmh": round(float(row[2]) * 35.0, 1),
                "adversarial_score": round(float(np.exp(-np.abs(row[3]))), 4)
            })

        return {
            "batch_size": batch_size,
            "anomalous_records": anomalies,
            "stress_test_mode": "ACTIVE"
        }

wgan_anomaly_generator = WganGpAnomalyGenerator()
