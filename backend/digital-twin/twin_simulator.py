import time

class TruckDigitalTwinSimulator:
    """
    Physical Digital Twin Simulator updating virtual component states (engine heat, brake pad wear, tire pressure).
    """
    def __init__(self, truck_id: str):
        self.truck_id = truck_id
        self.engine_temp_c = 85.0
        self.brake_pad_wear_pct = 12.5
        self.tire_pressure_psi = 110.0

    def update_telemetry(self, speed_kmh: float, engine_rpm: float, ambient_temp_c: float):
        # Update virtual physical parameters based on continuous operating dynamics
        self.engine_temp_c += (engine_rpm / 3000.0) * 0.5 + (ambient_temp_c * 0.05)
        self.brake_pad_wear_pct += (speed_kmh / 100.0) * 0.02
        self.tire_pressure_psi -= 0.01

        failure_risk_pct = max(0.0, min(100.0, (self.engine_temp_c - 90.0) * 2.0 + self.brake_pad_wear_pct * 0.5))

        return {
            "truck_id": self.truck_id,
            "engine_temp_c": round(self.engine_temp_c, 2),
            "brake_pad_wear_pct": round(self.brake_pad_wear_pct, 2),
            "tire_pressure_psi": round(self.tire_pressure_psi, 2),
            "failure_risk_pct": round(failure_risk_pct, 2),
            "requires_maintenance": failure_risk_pct > 80.0
        }

twin_engine = TruckDigitalTwinSimulator("TRUCK_SIM_101")
