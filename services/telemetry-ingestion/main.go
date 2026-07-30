package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"sync"
	"sync/atomic"
	"time"
)

// TelemetryPing represents a high-frequency GPS ping from a driver app
type TelemetryPing struct {
	DriverID  string    `json:"driver_id"`
	OrderID   string    `json:"order_id,omitempty"`
	Latitude  float64   `json:"latitude"`
	Longitude float64   `json:"longitude"`
	SpeedKMH  float64   `json:"speed_kmh"`
	Heading   float64   `json:"heading_deg"`
	FuelLevel float64   `json:"fuel_level_pct"`
	Timestamp time.Time `json:"timestamp"`
}

// GeofenceCheckResponse represents geofence status result
type GeofenceCheckResponse struct {
	DriverID        string  `json:"driver_id"`
	WithinGeofence  bool    `json:"within_geofence"`
	DistanceMeters  float64 `json:"distance_meters"`
	TargetLatitude  float64 `json:"target_latitude"`
	TargetLongitude float64 `json:"target_longitude"`
}

// IngestionStats holds global telemetry throughput metrics
type IngestionStats struct {
	TotalPingsProcessed uint64    `json:"total_pings_processed"`
	ActiveDrivers       int       `json:"active_drivers"`
	PingsPerSecond      float64   `json:"pings_per_second"`
	StartedAt           time.Time `json:"started_at"`
	Status              string    `json:"status"`
}

var (
	pingCounter     uint64
	activeDrivers   sync.Map
	serviceStartTime = time.Now()
)

// Calculate Haversine distance in meters between two lat/lng points
func haversineDistance(lat1, lon1, lat2, lon2 float64) float64 {
	const earthRadiusMeters = 6371000.0

	dLat := (lat2 - lat1) * (math.Pi / 180.0)
	dLon := (lon2 - lon1) * (math.Pi / 180.0)

	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*(math.Pi/180.0))*math.Cos(lat2*(math.Pi/180.0))*
			math.Sin(dLon/2)*math.Sin(dLon/2)

	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return earthRadiusMeters * c
}

// Handle Single Telemetry Ping
func handlePing(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var ping TelemetryPing
	if err := json.NewDecoder(r.Body).Decode(&ping); err != nil {
		http.Error(w, fmt.Sprintf("Invalid telemetry payload: %v", err), http.StatusBadRequest)
		return
	}

	if ping.DriverID == "" || ping.Latitude == 0 || ping.Longitude == 0 {
		http.Error(w, "driver_id, latitude, and longitude are required", http.StatusBadRequest)
		return
	}

	if ping.Timestamp.IsZero() {
		ping.Timestamp = time.Now()
	}

	// Update atomic stats & active driver cache
	atomic.AddUint64(&pingCounter, 1)
	activeDrivers.Store(ping.DriverID, ping)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":   true,
		"driver_id": ping.DriverID,
		"status":    "ingested",
		"timestamp": ping.Timestamp.Format(time.RFC3339),
	})
}

// Handle Geofence Check
func handleGeofence(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		DriverID  string  `json:"driver_id"`
		TargetLat float64 `json:"target_latitude"`
		TargetLng float64 `json:"target_longitude"`
		RadiusM   float64 `json:"radius_meters"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	val, ok := activeDrivers.Load(req.DriverID)
	if !ok {
		http.Error(w, "Driver telemetry not found", http.StatusNotFound)
		return
	}

	ping := val.(TelemetryPing)
	radius := req.RadiusM
	if radius == 0 {
		radius = 500.0 // Default 500 meters geofence
	}

	dist := haversineDistance(ping.Latitude, ping.Longitude, req.TargetLat, req.TargetLng)
	within := dist <= radius

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(GeofenceCheckResponse{
		DriverID:        req.DriverID,
		WithinGeofence:  within,
		DistanceMeters:  math.Round(dist*100) / 100,
		TargetLatitude:  req.TargetLat,
		TargetLongitude: req.TargetLng,
	})
}

// Handle Telemetry Health & Throughput Stats
func handleHealth(w http.ResponseWriter, r *http.Request) {
	driverCount := 0
	activeDrivers.Range(func(key, value interface{}) bool {
		driverCount++
		return true
	})

	uptimeSec := time.Since(serviceStartTime).Seconds()
	pingsPerSec := 0.0
	if uptimeSec > 0 {
		pingsPerSec = float64(atomic.LoadUint64(&pingCounter)) / uptimeSec
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(IngestionStats{
		TotalPingsProcessed: atomic.LoadUint64(&pingCounter),
		ActiveDrivers:       driverCount,
		PingsPerSecond:      math.Round(pingsPerSec*100) / 100,
		StartedAt:           serviceStartTime,
		Status:              "healthy",
	})
}

func main() {
	port := os.Getenv("TELEMETRY_PORT")
	if port == "" {
		port = "8085"
	}

	http.HandleFunc("/api/v1/telemetry/ping", handlePing)
	http.HandleFunc("/api/v1/telemetry/geofence", handleGeofence)
	http.HandleFunc("/api/v1/telemetry/health", handleHealth)

	log.Printf("⚡ Go High-Throughput Telemetry Service starting on port %s...", port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatalf("Fatal server error: %v", err)
	}
}
