use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct Coordinate {
    pub lat: f64,
    pub lng: f64,
}

#[derive(Serialize, Deserialize)]
pub struct RouteMatrixResult {
    pub distance_km: f64,
    pub estimated_duration_mins: f64,
    pub estimated_fuel_liters: f64,
}

/// Computes offline distance matrix using Haversine algorithm and road friction coefficients
#[wasm_bindgen]
pub fn compute_offline_route_matrix(origin_lat: f64, origin_lng: f64, dest_lat: f64, dest_lng: f64) -> String {
    let r = 6371.0; // Earth radius in km
    let d_lat = (dest_lat - origin_lat).to_radians();
    let d_lng = (dest_lng - origin_lng).to_radians();

    let a = (d_lat / 2.0).sin().powi(2)
        + origin_lat.to_radians().cos() * dest_lat.to_radians().cos() * (d_lng / 2.0).sin().powi(2);
    let c = 2.0 * a.sqrt().atan2((1.0 - a).sqrt());
    
    // Straight-line distance multiplied by road tortuosity factor (1.25 for highways)
    let distance_km = r * c * 1.25;
    let avg_speed_kmh = 55.0; // Standard truck highway speed in India
    let duration_mins = (distance_km / avg_speed_kmh) * 60.0;
    let fuel_liters = distance_km * 0.32; // ~3.1 km/liter for medium trucks

    let result = RouteMatrixResult {
        distance_km: (distance_km * 100.0).round() / 100.0,
        estimated_duration_mins: duration_mins.round(),
        estimated_fuel_liters: (fuel_liters * 100.0).round() / 100.0,
    };

    serde_json::to_string(&result).unwrap_or_default()
}
