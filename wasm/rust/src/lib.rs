use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[wasm_bindgen]
#[derive(Serialize, Deserialize)]
pub struct RouteRequest {
    pub origin: String,
    pub destination: String,
    pub weight: f64,
    pub distance: f64,
}

#[wasm_bindgen]
#[derive(Serialize, Deserialize)]
pub struct RouteResponse {
    pub estimated_price: f64,
    pub estimated_time: f64,
    pub route_id: String,
    pub status: String,
}

#[wasm_bindgen]
#[derive(Serialize, Deserialize)]
pub struct DriverData {
    pub driver_id: String,
    pub lat: f64,
    pub lng: f64,
    pub speed: f64,
    pub status: String,
}

#[wasm_bindgen]
impl RouteRequest {
    pub fn new(origin: String, destination: String, weight: f64, distance: f64) -> RouteRequest {
        RouteRequest {
            origin,
            destination,
            weight,
            distance,
        }
    }
}

// ============ Edge Functions ============

#[wasm_bindgen]
pub fn calculate_route(request: &RouteRequest) -> RouteResponse {
    // Fast edge computation
    let base_price = request.distance * 10.0;
    let weight_factor = request.weight / 1000.0;
    let estimated_price = base_price * (1.0 + weight_factor * 0.5);
    
    let estimated_time = request.distance / 40.0; // Average 40 km/h
    
    RouteResponse {
        estimated_price,
        estimated_time,
        route_id: format!("route_{}", chrono::Utc::now().timestamp()),
        status: "calculated".to_string(),
    }
}

#[wasm_bindgen]
pub fn process_driver_location(drivers: &[DriverData]) -> Vec<DriverData> {
    let mut processed = Vec::new();
    
    for driver in drivers {
        let mut updated = driver.clone();
        
        // Update status based on speed
        if driver.speed > 80.0 {
            updated.status = "fast".to_string();
        } else if driver.speed > 50.0 {
            updated.status = "normal".to_string();
        } else {
            updated.status = "slow".to_string();
        }
        
        processed.push(updated);
    }
    
    processed
}

#[wasm_bindgen]
pub fn optimize_loads(loads: &[f64], capacity: f64) -> Vec<usize> {
    // Simple bin packing at edge
    let mut selected = Vec::new();
    let mut remaining = capacity;
    
    for (i, &weight) in loads.iter().enumerate() {
        if weight <= remaining {
            selected.push(i);
            remaining -= weight;
        }
    }
    
    selected
}

#[wasm_bindgen]
pub fn calculate_eta(distance: f64, speed: f64, traffic_factor: f64) -> f64 {
    // Fast ETA calculation at edge
    let effective_speed = speed * (1.0 - traffic_factor);
    distance / effective_speed
}

#[wasm_bindgen]
pub fn validate_otp(input_otp: &str, correct_otp: &str) -> bool {
    // Fast OTP validation at edge
    input_otp == correct_otp
}

// ============ Data Processing ============

#[wasm_bindgen]
pub fn filter_drivers(drivers: Vec<DriverData>, min_rating: f64) -> Vec<DriverData> {
    drivers
        .into_iter()
        .filter(|d| d.status != "offline")
        .collect()
}

#[wasm_bindgen]
pub fn aggregate_prices(prices: Vec<f64>) -> f64 {
    prices.iter().sum::<f64>() / prices.len() as f64
}

#[wasm_bindgen]
pub fn hash_data(data: &str) -> String {
    use sha2::{Sha256, Digest};
    let mut hasher = Sha256::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}

#[wasm_bindgen]
pub fn compress_data(data: &[u8]) -> Vec<u8> {
    // Simple compression at edge
    let mut compressed = Vec::new();
    let mut count = 1;
    
    for i in 1..data.len() {
        if data[i] == data[i-1] {
            count += 1;
        } else {
            compressed.push(data[i-1]);
            compressed.push(count);
            count = 1;
        }
    }
    compressed.push(data[data.len()-1]);
    compressed.push(count);
    
    compressed
}