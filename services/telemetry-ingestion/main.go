package main

import (
	"container/list"
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
	activeDriverCount   uint64
	geofenceRateLimit   sync.Map
	geofenceRateTracked uint64
	// geofenceOrder tracks live geofence rate-limit entries in insertion order
	// so the oldest entry can be evicted when the map exceeds maxRateTracked,
	// without scanning the whole map per insert. Every live entry has exactly
	// one element in the queue; the element is removed when the entry is
	// retired, so the queue stays as bounded as the map itself.
	geofenceOrder     list.List
	geofenceOrderMu   sync.Mutex
	pingRateLimit     sync.Map
	serviceStartTime  = time.Now()
	jwtSecret         []byte
	bypassAuth        bool
	driverTTL         = 5 * time.Minute
	maxActiveDrivers  = 100000
	maxPingsPerSec    = 10
	maxGeofencePerSec = 10
	maxRateTracked    = 100000
)

const (
	// onPathEvictLimit bounds the geofence eviction work done on the request
	// path when a new entry pushes the tracker over the cap, so a single ping
	// never pays for draining the whole overflow.
	onPathEvictLimit = 64
	// sweepEvictLimit bounds the geofence eviction work done per background
	// sweep. It only matters when the queue is full of in-flight entries; the
	// sweep loop otherwise exits as soon as the tracker is back under the cap.
	sweepEvictLimit = 1 << 20
)

// driverEntry is a cached ping plus its last-seen time so stale drivers can be evicted.
type driverEntry struct {
	ping     TelemetryPing
	lastSeen time.Time
}

// rateEntry holds a sliding window of request timestamps for one driver.
//
// inUse counts the in-flight requests currently holding the entry. Eviction
// never removes an entry with inUse > 0, so an eviction can never reset a
// driver's rate window while a request is still using the entry. Once
// retired, the entry is removed from its map and any late acquirer sees the
// retired flag and retries against a fresh entry instead of writing into
// orphaned state whose stamps would be lost.
type rateEntry struct {
	mu       sync.Mutex
	stamps   []time.Time
	driverID string
	inUse    int
	retired  bool
	// orderElem is the entry's position in geofenceOrder while it is live;
	// it is only accessed under geofenceOrderMu.
	orderElem *list.Element
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

	// Coincident points are exactly zero apart; return early so the trig
	// below is never fed a degenerate zero-angle central argument.
	if lat1 == lat2 && lon1 == lon2 {
		return 0
	}

	dLat := (lat2 - lat1) * (math.Pi / 180.0)
	dLon := (lon2 - lon1) * (math.Pi / 180.0)

	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*(math.Pi/180.0))*math.Cos(lat2*(math.Pi/180.0))*
			math.Sin(dLon/2)*math.Sin(dLon/2)

	// Floating-point rounding (and slightly out-of-range inputs) can push `a`
	// outside [0,1], making math.Sqrt(1-a) NaN and every comparison false.
	// Clamp so the computation is numerically safe for all valid inputs.
	if a < 0 {
		a = 0
	}
	if a > 1 {
		a = 1
	}

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

// acquireRateEntry returns the live rate entry for driverID in m, marking it
// in use so eviction defers until the caller releases it with endUse. created
// reports whether the returned entry was freshly inserted into m; when it was,
// onCreated is invoked once (e.g. for order-queue bookkeeping) before the
// entry is used.
func acquireRateEntry(m *sync.Map, driverID string, onCreated func(*rateEntry)) (*rateEntry, bool) {
	for {
		v, loaded := m.LoadOrStore(driverID, &rateEntry{driverID: driverID})
		e := v.(*rateEntry)
		if !loaded && onCreated != nil {
			onCreated(e)
		}
		e.mu.Lock()
		if e.retired {
			// The entry was evicted between LoadOrStore and the lock; a fresh
			// one must be created so the caller never writes into orphaned
			// state that would be dropped on eviction.
			e.mu.Unlock()
			continue
		}
		e.inUse++
		e.mu.Unlock()
		return e, !loaded
	}
}

// endUse releases an entry previously acquired with acquireRateEntry.
func (e *rateEntry) endUse() {
	e.mu.Lock()
	e.inUse--
	e.mu.Unlock()
}

// tryRetireRateEntry removes e from m if it is not in use and not already
// retired, decrementing tracked when non-nil. It reports whether the entry was
// retired. The caller is responsible for removing e from geofenceOrder.
func tryRetireRateEntry(m *sync.Map, e *rateEntry, tracked *uint64) bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.retired || e.inUse > 0 {
		return false
	}
	// Only retire the exact entry still mapped to the driver; a newer entry
	// would have its own slot and must not be disturbed.
	if cur, ok := m.Load(e.driverID); !ok || cur.(*rateEntry) != e {
		return false
	}
	e.retired = true
	m.Delete(e.driverID)
	if tracked != nil {
		atomic.AddUint64(tracked, ^uint64(0))
	}
	return true
}

// acquireGeofenceEntry acquires the geofence rate entry for driverID and
// performs the insertion-order bookkeeping for new entries, enforcing the hard
// maxRateTracked bound with a bounded eviction pass.
func acquireGeofenceEntry(driverID string) *rateEntry {
	e, created := acquireRateEntry(&geofenceRateLimit, driverID, func(entry *rateEntry) {
		atomic.AddUint64(&geofenceRateTracked, 1)
		geofenceOrderMu.Lock()
		entry.orderElem = geofenceOrder.PushBack(entry)
		geofenceOrderMu.Unlock()
	})
	if created && atomic.LoadUint64(&geofenceRateTracked) > uint64(maxRateTracked) {
		evictGeofenceOverflow(onPathEvictLimit)
	}
	return e
}

// allowGeofence enforces a per-driver sliding-window rate limit.
func allowGeofence(driverID string) bool {
	e := acquireGeofenceEntry(driverID)
	defer e.endUse()

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

	return true
}

// evictGeofenceOverflow retires the oldest geofence rate entries (in insertion
// order) until the tracker is under maxRateTracked or limit candidates have
// been examined. Entries still in use are moved to the back of the queue
// instead of being evicted, so the request that owns them keeps its rate
// window.
func evictGeofenceOverflow(limit int) {
	for attempts := 0; attempts < limit; attempts++ {
		if atomic.LoadUint64(&geofenceRateTracked) <= uint64(maxRateTracked) {
			return
		}

		geofenceOrderMu.Lock()
		front := geofenceOrder.Front()
		if front == nil {
			geofenceOrderMu.Unlock()
			return
		}
		e := front.Value.(*rateEntry)
		geofenceOrder.Remove(front)
		e.orderElem = nil
		geofenceOrderMu.Unlock()

		e.mu.Lock()
		if e.retired {
			// Already cleaned up by a pruner; drop it.
			e.mu.Unlock()
			continue
		}
		if e.inUse > 0 {
			// In flight; keep the entry and try again on a later pass.
			e.mu.Unlock()
			geofenceOrderMu.Lock()
			e.orderElem = geofenceOrder.PushBack(e)
			geofenceOrderMu.Unlock()
			continue
		}
		e.retired = true
		geofenceRateLimit.Delete(e.driverID)
		atomic.AddUint64(&geofenceRateTracked, ^uint64(0))
		e.mu.Unlock()
	}
}

// pruneGeofenceRateEntries removes empty geofence rate entries whose sliding
// window has expired, keeping the in-memory map bounded. Only idle entries are
// retired: an entry an in-flight request is holding is left alone so the
// driver's window is never reset mid-request.
func pruneGeofenceRateEntries() {
	cutoff := time.Now().Add(-time.Second)
	geofenceRateLimit.Range(func(key, value interface{}) bool {
		e := value.(*rateEntry)
		e.mu.Lock()
		if e.retired || e.inUse > 0 {
			e.mu.Unlock()
			return true
		}
		kept := e.stamps[:0]
		for _, t := range e.stamps {
			if t.After(cutoff) {
				kept = append(kept, t)
			}
		}
		e.stamps = kept
		if len(e.stamps) == 0 {
			// Delete under the entry lock: a concurrent allowGeofence that
			// re-locks the entry between the emptiness check and the removal
			// would otherwise lose its timestamps when the entry is deleted,
			// resetting that driver's 1-second window and allowing bursts
			// above the cap.
			e.retired = true
			geofenceRateLimit.Delete(key)
			atomic.AddUint64(&geofenceRateTracked, ^uint64(0))
			e.mu.Unlock()

			geofenceOrderMu.Lock()
			if e.orderElem != nil {
				geofenceOrder.Remove(e.orderElem)
				e.orderElem = nil
			}
			geofenceOrderMu.Unlock()
			return true
		}
		e.mu.Unlock()
		return true
	})
}

// allowPing enforces a per-driver sliding-window rate limit.
func allowPing(driverID string) bool {
	e, _ := acquireRateEntry(&pingRateLimit, driverID, nil)
	defer e.endUse()

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
	return int(atomic.LoadUint64(&activeDriverCount))
}

// reserveActiveDriver atomically reserves a slot under maxActiveDrivers. It
// reports whether the reservation succeeded, so concurrent requests cannot
// pass a check-then-act and collectively exceed the cap.
func reserveActiveDriver() bool {
	for {
		cur := atomic.LoadUint64(&activeDriverCount)
		if cur >= uint64(maxActiveDrivers) {
			return false
		}
		if atomic.CompareAndSwapUint64(&activeDriverCount, cur, cur+1) {
			return true
		}
	}
}

// releaseActiveDriver releases a slot previously reserved by
// reserveActiveDriver.
func releaseActiveDriver() {
	for {
		cur := atomic.LoadUint64(&activeDriverCount)
		if cur == 0 {
			return
		}
		if atomic.CompareAndSwapUint64(&activeDriverCount, cur, cur-1) {
			return
		}
	}
}

// expireActiveDriver removes a stale driver entry from the cache, releasing
// its capacity slot only when the exact entry is still present.
func expireActiveDriver(key interface{}, e driverEntry) {
	if activeDrivers.CompareAndDelete(key, e) {
		releaseActiveDriver()
	}
}

// storePing caches a ping for a driver, enforcing the maxActiveDrivers cap via
// atomic admission. The map is never scanned on this path; refreshes of
// existing drivers are done in place with compare-and-swap.
func storePing(driverID string, ping TelemetryPing) bool {
	now := time.Now()
	entry := driverEntry{ping: ping, lastSeen: now}

	for {
		if prev, ok := activeDrivers.Load(driverID); ok {
			// Refresh the existing entry in place; no capacity slot is needed
			// because the map does not grow. If a concurrent sweep removed the
			// entry, the CAS fails and we fall through to the admission path.
			if activeDrivers.CompareAndSwap(driverID, prev, entry) {
				return true
			}
			continue
		}

		// New driver: atomically reserve a slot before inserting so the
		// configured cap can never be exceeded by concurrent requests.
		if !reserveActiveDriver() {
			return false
		}
		if _, loaded := activeDrivers.LoadOrStore(driverID, entry); loaded {
			// Another goroutine inserted this driver concurrently; release the
			// slot we reserved and refresh the existing entry instead.
			releaseActiveDriver()
			continue
		}
		return true
	}
}

// retireStalePingEntry removes a ping rate entry once the driver goes quiet for
// a full driverTTL, unless it is currently in use by an in-flight request.
func retireStalePingEntry(key interface{}, e *rateEntry, now time.Time) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.retired || e.inUse > 0 {
		return
	}
	// Stamps are appended in order and pruned oldest-first, so the last stamp
	// is the driver's most recent activity. Entries are aged out once they go
	// quiet for a full driverTTL, not only when empty.
	stale := len(e.stamps) == 0 || now.Sub(e.stamps[len(e.stamps)-1]) > driverTTL
	if !stale {
		return
	}
	// Delete under the entry lock: a concurrent allowPing that re-locks the
	// entry between the staleness check and the removal would otherwise lose
	// its timestamps when the entry is deleted, resetting that driver's
	// 1-second window and allowing bursts above the cap.
	e.retired = true
	pingRateLimit.Delete(key)
}

// sweepDrivers removes drivers whose last ping is older than the TTL and drops
// stale rate-limit entries. It runs from a background goroutine, never from the
// request path.
func sweepDrivers() {
	now := time.Now()

	activeDrivers.Range(func(key, value interface{}) bool {
		e := value.(driverEntry)
		if now.Sub(e.lastSeen) > driverTTL {
			expireActiveDriver(key, e)
		}
		return true
	})

	pingRateLimit.Range(func(key, value interface{}) bool {
		retireStalePingEntry(key, value.(*rateEntry), now)
		return true
	})

	pruneGeofenceRateEntries()
	evictGeofenceOverflow(sweepEvictLimit)
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

// geofenceRequest is the payload of the /geofence check endpoint. RadiusM is a
// pointer so an absent radius_meters is distinguishable from an explicit 0.
type geofenceRequest struct {
	DriverID  string   `json:"driver_id"`
	TargetLat float64  `json:"target_latitude"`
	TargetLng float64  `json:"target_longitude"`
	RadiusM   *float64 `json:"radius_meters"`
}

// maxGeofenceRadiusMeters bounds how large a geofence radius may be so an
// absurd value cannot be fed into the comparison.
const maxGeofenceRadiusMeters = 500_000.0

// defaultGeofenceRadiusMeters is used when radius_meters is absent.
const defaultGeofenceRadiusMeters = 500.0

// validateGeofenceInput validates radius and target coordinates before they
// are used. An absent radius defaults to 500 m; an explicit 0 is a valid
// exact-position check; negatives/oversized radii and out-of-range targets are
// rejected with an error.
func validateGeofenceInput(req *geofenceRequest) (float64, error) {
	radius := defaultGeofenceRadiusMeters
	if req.RadiusM != nil {
		if *req.RadiusM < 0 {
			return 0, fmt.Errorf("radius_meters cannot be negative")
		}
		if *req.RadiusM > maxGeofenceRadiusMeters {
			return 0, fmt.Errorf("radius_meters exceeds the maximum allowed geofence")
		}
		radius = *req.RadiusM
	}

	if math.IsNaN(req.TargetLat) || math.IsNaN(req.TargetLng) ||
		req.TargetLat < -90 || req.TargetLat > 90 ||
		req.TargetLng < -180 || req.TargetLng > 180 {
		return 0, fmt.Errorf("target latitude or longitude out of plausible bounds")
	}

	return radius, nil
}

func handleGeofence(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	claims, ok := authenticate(w, r)
	if !ok {
		return
	}

	var req geofenceRequest

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	radius, err := validateGeofenceInput(&req)
	if err != nil {
		http.Error(w, "Invalid request body: "+err.Error(), http.StatusBadRequest)
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
		expireActiveDriver(req.DriverID, entry)
		http.Error(w, "Driver telemetry not found", http.StatusNotFound)
		return
	}

	ping := entry.ping

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
	uptimeSec := time.Since(serviceStartTime).Seconds()
	pingsPerSec := 0.0
	if uptimeSec > 0 {
		pingsPerSec = float64(atomic.LoadUint64(&pingCounter)) / uptimeSec
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(IngestionStats{
		TotalPingsProcessed: atomic.LoadUint64(&pingCounter),
		ActiveDrivers:       int(atomic.LoadUint64(&activeDriverCount)),
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
