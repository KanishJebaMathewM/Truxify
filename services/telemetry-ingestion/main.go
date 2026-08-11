package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
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
	DriverID       string `json:"driver_id"`
	WithinGeofence bool   `json:"within_geofence"`
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
	pingCounter         uint64
	activeDrivers       sync.Map
	geofenceRateLimit   sync.Map
	geofenceRateTracked uint64
	// geofenceOrder tracks geofence rate-limit entries in insertion order so
	// the oldest entry can be evicted when the map exceeds maxRateTracked,
	// without scanning the whole map per insert.
	geofenceOrder   []*rateEntry
	geofenceOrderMu sync.Mutex
	pingRateLimit   sync.Map
	serviceStartTime = time.Now()
	jwtSecret        []byte
	bypassAuth       bool
	driverTTL        = 5 * time.Minute
	maxActiveDrivers = 100000
	maxPingsPerSec   = 10
	maxGeofencePerSec = 10
	maxRateTracked    = 100000
)

// driverEntry is a cached ping plus its last-seen time so stale drivers can be evicted.
type driverEntry struct {
	ping     TelemetryPing
	lastSeen time.Time
}

// rateEntry holds a sliding window of request timestamps for one driver.
type rateEntry struct {
	mu       sync.Mutex
	stamps   []time.Time
	driverID string
}

// jwtClaims holds the subset of JWT claims the telemetry service needs.
type jwtClaims struct {
	Sub  string `json:"sub"`
	Role string `json:"role"`
	Exp  int64  `json:"exp"`
}

// operatorRoles are roles allowed to query a driver's location. Drivers may
// only ever query their own location; there are no operator roles in the
// current profiles schema, but the allowlist keeps the check future-proof.
var operatorRoles = map[string]bool{
	"admin":      true,
	"operator":   true,
	"dispatcher": true,
}

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

// envInt reads an integer from the environment with a default fallback.
func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

// envDuration reads a duration from the environment with a default fallback.
func envDuration(key string, def time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return def
}

// parseDriverToken verifies an HS256 JWT with JWT_SECRET and returns its claims.
func parseDriverToken(token string) (jwtClaims, error) {
	var claims jwtClaims

	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return claims, fmt.Errorf("malformed token")
	}

	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return claims, fmt.Errorf("malformed token")
	}

	mac := hmac.New(sha256.New, jwtSecret)
	mac.Write([]byte(parts[0] + "." + parts[1]))
	if !hmac.Equal(sig, mac.Sum(nil)) {
		return claims, fmt.Errorf("invalid token signature")
	}

	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return claims, fmt.Errorf("malformed token")
	}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return claims, fmt.Errorf("malformed token")
	}

	// Reject expired tokens. JWT `exp` is a NumericDate (seconds since the
	// epoch); a token without an expiry is left to the signature check.
	if claims.Exp != 0 && time.Now().Unix() >= claims.Exp {
		return claims, fmt.Errorf("token expired")
	}

	return claims, nil
}

// authenticate extracts and verifies the caller's bearer JWT, returning the
// decoded claims. In BYPASS_AUTH local development the subject is taken from
// the X-Driver-ID header.
func authenticate(w http.ResponseWriter, r *http.Request) (jwtClaims, bool) {
	var claims jwtClaims

	if bypassAuth {
		claims.Sub = r.Header.Get("X-Driver-ID")
		claims.Role = r.Header.Get("X-Driver-Role")
		if claims.Sub == "" {
			http.Error(w, "driver subject required", http.StatusUnauthorized)
			return claims, false
		}
		if claims.Role == "" {
			claims.Role = "driver"
		}
		return claims, true
	}

	if len(jwtSecret) == 0 {
		http.Error(w, "authentication is not configured", http.StatusServiceUnavailable)
		return claims, false
	}

	auth := r.Header.Get("Authorization")
	if !strings.HasPrefix(auth, "Bearer ") {
		http.Error(w, "authentication required", http.StatusUnauthorized)
		return claims, false
	}

	var err error
	claims, err = parseDriverToken(strings.TrimPrefix(auth, "Bearer "))
	if err != nil {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return claims, false
	}

	if claims.Sub == "" {
		http.Error(w, "invalid token: missing subject", http.StatusUnauthorized)
		return claims, false
	}

	return claims, true
}

// authorizeGeofence checks that the caller may query the given driver's location.
func authorizeGeofence(claims jwtClaims, driverID string) bool {
	if claims.Role == "driver" {
		return claims.Sub == driverID
	}
	return operatorRoles[claims.Role]
}

// authenticateDriver extracts and verifies the caller's bearer JWT, requiring
// the driver role. On success it returns the authenticated subject (driver id).
func authenticateDriver(w http.ResponseWriter, r *http.Request) (string, bool) {
	if bypassAuth {
		callerID := r.Header.Get("X-Driver-ID")
		if callerID == "" {
			http.Error(w, "driver subject required", http.StatusUnauthorized)
			return "", false
		}
		return callerID, true
	}

	if len(jwtSecret) == 0 {
		http.Error(w, "authentication is not configured", http.StatusServiceUnavailable)
		return "", false
	}

	auth := r.Header.Get("Authorization")
	if !strings.HasPrefix(auth, "Bearer ") {
		http.Error(w, "authentication required", http.StatusUnauthorized)
		return "", false
	}

	claims, err := parseDriverToken(strings.TrimPrefix(auth, "Bearer "))
	if err != nil {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return "", false
	}

	if claims.Sub == "" {
		http.Error(w, "invalid token: missing subject", http.StatusUnauthorized)
		return "", false
	}

	if claims.Role != "driver" {
		http.Error(w, "forbidden: driver role required", http.StatusForbidden)
		return "", false
	}

	if claims.Sub == "" {
		http.Error(w, "invalid token: subject required", http.StatusUnauthorized)
		return "", false
	}

	return claims.Sub, true
}

// validatePing checks that a ping payload is plausible before it is accepted.
func validatePing(ping *TelemetryPing) error {
	if ping.DriverID == "" {
		return fmt.Errorf("driver_id is required")
	}
	if math.IsNaN(ping.Latitude) || math.IsNaN(ping.Longitude) ||
		ping.Latitude < -90 || ping.Latitude > 90 ||
		ping.Longitude < -180 || ping.Longitude > 180 {
		return fmt.Errorf("latitude or longitude out of plausible bounds")
	}
	if ping.SpeedKMH < 0 {
		return fmt.Errorf("speed_kmh cannot be negative")
	}
	if ping.Heading < 0 || ping.Heading > 360 {
		return fmt.Errorf("heading_deg must be between 0 and 360")
	}
	if ping.FuelLevel < 0 || ping.FuelLevel > 100 {
		return fmt.Errorf("fuel_level_pct must be between 0 and 100")
	}
	if ping.Timestamp.IsZero() {
		ping.Timestamp = time.Now()
	}
	if ping.Timestamp.After(time.Now().Add(time.Minute)) {
		return fmt.Errorf("timestamp too far in the future")
	}
	return nil
}

// allowGeofence enforces a per-driver sliding-window rate limit.
func allowGeofence(driverID string) bool {
	v, loaded := geofenceRateLimit.LoadOrStore(driverID, &rateEntry{driverID: driverID})
	if !loaded {
		atomic.AddUint64(&geofenceRateTracked, 1)
		geofenceOrderMu.Lock()
		geofenceOrder = append(geofenceOrder, v.(*rateEntry))
		geofenceOrderMu.Unlock()
	}
	e := v.(*rateEntry)

	e.mu.Lock()

	cutoff := time.Now().Add(-time.Second)
	kept := e.stamps[:0]
	for _, t := range e.stamps {
		if t.After(cutoff) {
			kept = append(kept, t)
		}
	}
	e.stamps = kept

	if len(e.stamps) >= maxGeofencePerSec {
		e.mu.Unlock()
		return false
	}

	e.stamps = append(e.stamps, time.Now())
	e.mu.Unlock()

	// Enforce the hard bound: once the map exceeds maxRateTracked, evict the
	// oldest tracked entries regardless of whether they still have timestamps.
	// This runs only when a new entry pushes the tracker over the cap and
	// evicts at most the overflow amount, keeping memory bounded without
	// scanning the whole map on every insert.
	if !loaded && atomic.LoadUint64(&geofenceRateTracked) > uint64(maxRateTracked) {
		evictGeofenceOverflow()
	}

	return true
}

// evictGeofenceOverflow removes the oldest geofence rate-limit entries (in
// insertion order) until the tracker is back under maxRateTracked.
func evictGeofenceOverflow() {
	for atomic.LoadUint64(&geofenceRateTracked) > uint64(maxRateTracked) {
		geofenceOrderMu.Lock()
		if len(geofenceOrder) == 0 {
			geofenceOrderMu.Unlock()
			return
		}
		e := geofenceOrder[0]
		geofenceOrder = geofenceOrder[1:]
		geofenceOrderMu.Unlock()

		// Only evict the entry if it is still the exact entry that was queued;
		// the same driver may have re-created an entry since it was ordered.
		if cur, ok := geofenceRateLimit.Load(e.driverID); ok && cur.(*rateEntry) == e {
			geofenceRateLimit.Delete(e.driverID)
			atomic.AddUint64(&geofenceRateTracked, ^uint64(0))
		}
	}
}

// pruneGeofenceRateEntries removes empty rate entries once the tracker grows
// beyond its cap, keeping the in-memory map bounded.
func pruneGeofenceRateEntries() {
	cutoff := time.Now().Add(-time.Second)
	geofenceRateLimit.Range(func(key, value interface{}) bool {
		e := value.(*rateEntry)
		e.mu.Lock()
		kept := e.stamps[:0]
		for _, t := range e.stamps {
			if t.After(cutoff) {
				kept = append(kept, t)
			}
		}
		e.stamps = kept
		// Delete under the entry lock: a concurrent allowGeofence that
		// re-locks the entry between the emptiness check and the removal
		// would otherwise lose its timestamps when the entry is deleted,
		// resetting that driver's 1-second window and allowing bursts
		// above the cap.
		if len(e.stamps) == 0 {
			geofenceRateLimit.Delete(key)
			atomic.AddUint64(&geofenceRateTracked, ^uint64(0))
		}
		e.mu.Unlock()
		return true
	})
}

// allowPing enforces a per-driver sliding-window rate limit.
func allowPing(driverID string) bool {
	v, _ := pingRateLimit.LoadOrStore(driverID, &rateEntry{})
	e := v.(*rateEntry)

	e.mu.Lock()
	defer e.mu.Unlock()

	cutoff := time.Now().Add(-time.Second)
	kept := e.stamps[:0]
	for _, t := range e.stamps {
		if t.After(cutoff) {
			kept = append(kept, t)
		}
	}
	e.stamps = kept

	if len(e.stamps) >= maxPingsPerSec {
		return false
	}

	e.stamps = append(e.stamps, time.Now())
	return true
}

// countActiveDrivers returns the current number of cached drivers.
func countActiveDrivers() int {
	count := 0
	activeDrivers.Range(func(key, value interface{}) bool {
		count++
		return true
	})
	return count
}

// storePing caches a ping for a driver, enforcing the max-map-size cap.
func storePing(driverID string, ping TelemetryPing) bool {
	now := time.Now()

	if _, ok := activeDrivers.Load(driverID); ok {
		activeDrivers.Store(driverID, driverEntry{ping: ping, lastSeen: now})
		return true
	}

	if countActiveDrivers() >= maxActiveDrivers {
		sweepDrivers()
		if countActiveDrivers() >= maxActiveDrivers {
			return false
		}
	}

	activeDrivers.Store(driverID, driverEntry{ping: ping, lastSeen: now})
	return true
}

// sweepDrivers removes drivers whose last ping is older than the TTL and drops
// stale rate-limit entries.
func sweepDrivers() {
	now := time.Now()

	activeDrivers.Range(func(key, value interface{}) bool {
		if now.Sub(value.(driverEntry).lastSeen) > driverTTL {
			activeDrivers.Delete(key)
		}
		return true
	})

	pingRateLimit.Range(func(key, value interface{}) bool {
		e := value.(*rateEntry)
		e.mu.Lock()
		// Stamps are appended in order and pruned oldest-first, so the last
		// stamp is the driver's most recent activity. Entries are aged out
		// once they go quiet for a full driverTTL, not only when empty.
		stale := len(e.stamps) == 0 || now.Sub(e.stamps[len(e.stamps)-1]) > driverTTL
		// Delete under the entry lock: a concurrent allowPing that re-locks
		// the entry between the emptiness check and the removal would
		// otherwise lose its timestamps when the entry is deleted, resetting
		// that driver's 1-second window and allowing bursts above the cap.
		if stale {
			pingRateLimit.Delete(key)
		}
		e.mu.Unlock()
		return true
	})
}

// Handle Single Telemetry Ping
func handlePing(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	callerID, ok := authenticateDriver(w, r)
	if !ok {
		return
	}

	var ping TelemetryPing
	if err := json.NewDecoder(r.Body).Decode(&ping); err != nil {
		http.Error(w, fmt.Sprintf("Invalid telemetry payload: %v", err), http.StatusBadRequest)
		return
	}

	if err := validatePing(&ping); err != nil {
		http.Error(w, fmt.Sprintf("Invalid telemetry payload: %v", err), http.StatusBadRequest)
		return
	}

	if callerID != ping.DriverID {
		http.Error(w, "driver_id does not match authenticated caller", http.StatusForbidden)
		return
	}

	if !allowPing(ping.DriverID) {
		http.Error(w, "Too many telemetry requests", http.StatusTooManyRequests)
		return
	}

	// Update atomic stats & active driver cache
	atomic.AddUint64(&pingCounter, 1)
	if !storePing(ping.DriverID, ping) {
		http.Error(w, "Active driver capacity reached", http.StatusServiceUnavailable)
		return
	}

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

	claims, ok := authenticate(w, r)
	if !ok {
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

	if !authorizeGeofence(claims, req.DriverID) {
		http.Error(w, "forbidden: cannot query another driver's location", http.StatusForbidden)
		return
	}

	if !allowGeofence(req.DriverID) {
		http.Error(w, "Too many telemetry requests", http.StatusTooManyRequests)
		return
	}

	val, ok := activeDrivers.Load(req.DriverID)
	if !ok {
		http.Error(w, "Driver telemetry not found", http.StatusNotFound)
		return
	}

	entry := val.(driverEntry)
	if time.Since(entry.lastSeen) > driverTTL {
		activeDrivers.Delete(req.DriverID)
		http.Error(w, "Driver telemetry not found", http.StatusNotFound)
		return
	}

	ping := entry.ping
	radius := req.RadiusM
	if radius == 0 {
		radius = 500.0 // Default 500 meters geofence
	}

	dist := haversineDistance(ping.Latitude, ping.Longitude, req.TargetLat, req.TargetLng)
	within := dist <= radius

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(GeofenceCheckResponse{
		DriverID:       req.DriverID,
		WithinGeofence: within,
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

	jwtSecret = []byte(os.Getenv("JWT_SECRET"))
	bypassAuth = os.Getenv("BYPASS_AUTH") == "true" && os.Getenv("NODE_ENV") != "production"
	driverTTL = envDuration("TELEMETRY_DRIVER_TTL", 5*time.Minute)
	maxActiveDrivers = envInt("TELEMETRY_MAX_ACTIVE_DRIVERS", 100000)
	maxPingsPerSec = envInt("TELEMETRY_MAX_PINGS_PER_SEC", 10)
	maxGeofencePerSec = envInt("TELEMETRY_GEOFENCE_MAX_PER_SEC", 10)
	maxRateTracked = envInt("TELEMETRY_GEOFENCE_MAX_TRACKED", 100000)
	if driverTTL <= 0 {
		driverTTL = time.Second
	}

	// Periodically evict stale drivers so the in-memory map stays bounded.
	go func() {
		ticker := time.NewTicker(driverTTL / 2)
		defer ticker.Stop()
		for range ticker.C {
			sweepDrivers()
		}
	}()

	http.HandleFunc("/api/v1/telemetry/ping", handlePing)
	http.HandleFunc("/api/v1/telemetry/geofence", handleGeofence)
	http.HandleFunc("/api/v1/telemetry/health", handleHealth)

	log.Printf("⚡ Go High-Throughput Telemetry Service starting on port %s...", port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatalf("Fatal server error: %v", err)
	}
}
