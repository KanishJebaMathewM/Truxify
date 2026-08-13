package main

import (
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestSweepDrivers(t *testing.T) {
	now := time.Now()

	// Populate active drivers (one fresh, one stale)
	activeDrivers.Store("driver-fresh", driverEntry{lastSeen: now})
	activeDrivers.Store("driver-stale", driverEntry{lastSeen: now.Add(-driverTTL - time.Minute)})

	// Populate ping rate limits (one fresh, one stale)
	entryFresh := &rateEntry{stamps: []time.Time{now}}
	pingRateLimit.Store("driver-fresh", entryFresh)

	entryStale := &rateEntry{stamps: []time.Time{now.Add(-driverTTL - time.Minute)}}
	pingRateLimit.Store("driver-stale", entryStale)

	// Execute sweep
	sweepDrivers()

	// Assert activeDrivers eviction
	if _, ok := activeDrivers.Load("driver-fresh"); !ok {
		t.Errorf("expected driver-fresh to remain in activeDrivers")
	}
	if _, ok := activeDrivers.Load("driver-stale"); ok {
		t.Errorf("expected driver-stale to be evicted from activeDrivers")
	}

	// Assert pingRateLimit eviction
	if _, ok := pingRateLimit.Load("driver-fresh"); !ok {
		t.Errorf("expected driver-fresh to remain in pingRateLimit")
	}
	if _, ok := pingRateLimit.Load("driver-stale"); ok {
		t.Errorf("expected driver-stale to be evicted from pingRateLimit")
	}

	// activeDrivers and pingRateLimit are package-level sync.Maps shared by
	// every test in this file, so clean up what this one stored.
	activeDrivers.Delete("driver-fresh")
	activeDrivers.Delete("driver-stale")
	pingRateLimit.Delete("driver-fresh")
	pingRateLimit.Delete("driver-stale")
}

func TestSweepDriversEvictsStaleRetainsFresh(t *testing.T) {
	now := time.Now()
	staleAge := driverTTL + time.Minute

	activeDrivers.Store("stale-driver", driverEntry{lastSeen: now.Add(-staleAge)})
	activeDrivers.Store("fresh-driver", driverEntry{lastSeen: now})

	pingRateLimit.Store("stale-ping", &rateEntry{stamps: []time.Time{now.Add(-staleAge)}})
	pingRateLimit.Store("fresh-ping", &rateEntry{stamps: []time.Time{now}})

	sweepDrivers()

	if _, ok := activeDrivers.Load("stale-driver"); ok {
		t.Error("expected stale active driver to be evicted")
	}
	if _, ok := activeDrivers.Load("fresh-driver"); !ok {
		t.Error("expected fresh active driver to be retained")
	}
	if _, ok := pingRateLimit.Load("stale-ping"); ok {
		t.Error("expected stale rate-limit entry to be evicted")
	}
	if _, ok := pingRateLimit.Load("fresh-ping"); !ok {
		t.Error("expected fresh rate-limit entry to be retained")
	}

	activeDrivers.Delete("stale-driver")
	activeDrivers.Delete("fresh-driver")
	pingRateLimit.Delete("stale-ping")
	pingRateLimit.Delete("fresh-ping")
}

func TestSweepDriversPrunesStaleGeofenceEntries(t *testing.T) {
	now := time.Now()

	staleEntry := &rateEntry{driverID: "geo-stale", stamps: []time.Time{now.Add(-2 * time.Second)}}
	freshEntry := &rateEntry{driverID: "geo-fresh", stamps: []time.Time{now}}
	geofenceRateLimit.Store("geo-stale", staleEntry)
	geofenceRateLimit.Store("geo-fresh", freshEntry)
	atomic.AddUint64(&geofenceRateTracked, 2)

	before := atomic.LoadUint64(&geofenceRateTracked)

	sweepDrivers()

	if _, ok := geofenceRateLimit.Load("geo-stale"); ok {
		t.Error("expected stale geofence rate-limit entry (all stamps older than 1s) to be pruned")
	}
	if _, ok := geofenceRateLimit.Load("geo-fresh"); !ok {
		t.Error("expected fresh geofence rate-limit entry to be retained")
	}
	if after := atomic.LoadUint64(&geofenceRateTracked); after != before-1 {
		t.Errorf("expected geofenceRateTracked to decrement by 1 (from %d), got %d", before, after)
	}

	geofenceRateLimit.Delete("geo-stale")
	geofenceRateLimit.Delete("geo-fresh")
	atomic.AddUint64(&geofenceRateTracked, ^uint64(0))
}

// TestHaversineDistanceAntipodalFinite verifies antipodal points (including the
// poles, where rounding can push `a` past 1.0) always return a finite,
// positive distance.
func TestHaversineDistanceAntipodalFinite(t *testing.T) {
	d := haversineDistance(90, 0, -90, 180)
	if math.IsNaN(d) || math.IsInf(d, 0) {
		t.Fatalf("expected finite antipodal distance, got %v", d)
	}
	if d <= 0 {
		t.Fatalf("expected positive antipodal distance, got %v", d)
	}

	d2 := haversineDistance(0, 0, 0, 180)
	if math.IsNaN(d2) || math.IsInf(d2, 0) || d2 <= 0 {
		t.Fatalf("expected finite positive equator antipodal distance, got %v", d2)
	}
}

// TestGeofenceRadiusZeroIsExactCheck verifies an explicit radius_meters: 0 is
// kept (exact-position check) instead of being coerced to the default.
func TestGeofenceRadiusZeroIsExactCheck(t *testing.T) {
	zero := 0.0
	req := &geofenceRequest{DriverID: "d1", TargetLat: 19.0, TargetLng: 72.8, RadiusM: &zero}
	radius, err := validateGeofenceInput(req)
	if err != nil {
		t.Fatalf("unexpected error for radius 0: %v", err)
	}
	if radius != 0 {
		t.Fatalf("expected radius 0 for explicit zero, got %v", radius)
	}
}

// TestGeofenceRadiusAbsentDefaultsTo500 verifies an absent radius_meters
// defaults to the 500 m geofence.
func TestGeofenceRadiusAbsentDefaultsTo500(t *testing.T) {
	req := &geofenceRequest{DriverID: "d1", TargetLat: 19.0, TargetLng: 72.8}
	radius, err := validateGeofenceInput(req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if radius != defaultGeofenceRadiusMeters {
		t.Fatalf("expected default radius %v, got %v", defaultGeofenceRadiusMeters, radius)
	}
}

// TestGeofenceNegativeRadiusRejected verifies a negative radius_meters is
// rejected with 400 (was silently making every check false).
func TestGeofenceNegativeRadiusRejected(t *testing.T) {
	neg := -1.0
	req := &geofenceRequest{DriverID: "d1", TargetLat: 19.0, TargetLng: 72.8, RadiusM: &neg}
	if _, err := validateGeofenceInput(req); err == nil {
		t.Fatal("expected error for negative radius")
	}
}

// TestGeofenceOversizedRadiusRejected verifies a radius beyond the sane bound
// is rejected.
func TestGeofenceOversizedRadiusRejected(t *testing.T) {
	big := 1_000_000.0
	req := &geofenceRequest{DriverID: "d1", TargetLat: 19.0, TargetLng: 72.8, RadiusM: &big}
	if _, err := validateGeofenceInput(req); err == nil {
		t.Fatal("expected error for oversized radius")
	}
}

// TestGeofenceOutOfRangeTargetRejected verifies out-of-range/NaN target
// coordinates are rejected before the haversine computation.
func TestGeofenceOutOfRangeTargetRejected(t *testing.T) {
	for _, tc := range []struct {
		lat, lng float64
	}{
		{91, 0},
		{-91, 0},
		{0, 181},
		{0, -181},
		{math.NaN(), 0},
		{0, math.NaN()},
	} {
		req := &geofenceRequest{DriverID: "d1", TargetLat: tc.lat, TargetLng: tc.lng}
		if _, err := validateGeofenceInput(req); err == nil {
			t.Fatalf("expected error for out-of-range target (%v, %v)", tc.lat, tc.lng)
		}
	}
}

// TestGeofenceValidInputAccepted verifies a well-formed request passes input
// validation and yields a positive radius.
func TestGeofenceValidInputAccepted(t *testing.T) {
	req := &geofenceRequest{DriverID: "d1", TargetLat: 19.0, TargetLng: 72.8}
	radius, err := validateGeofenceInput(req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if radius <= 0 {
		t.Fatalf("expected positive radius, got %v", radius)
	}
}

// TestGeofenceHTTPRejectsNegativeRadius posts a negative radius and asserts a
// clean 400.
func TestGeofenceHTTPRejectsNegativeRadius(t *testing.T) {
	bypassAuth = true
	defer func() { bypassAuth = false }()

	activeDrivers.Store("d1", driverEntry{
		ping:     TelemetryPing{DriverID: "d1", Latitude: 19.0, Longitude: 72.8},
		lastSeen: time.Now(),
	})
	defer activeDrivers.Delete("d1")

	body := `{"driver_id":"d1","target_latitude":19.0,"target_longitude":72.8,"radius_meters":-1}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/telemetry/geofence", strings.NewReader(body))
	req.Header.Set("X-Driver-ID", "d1")
	w := httptest.NewRecorder()

	handleGeofence(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for negative radius, got %d", w.Code)
	}
}

// TestGeofenceHTTPRejectsOutOfRangeTarget posts out-of-range coordinates and
// asserts a clean 400.
func TestGeofenceHTTPRejectsOutOfRangeTarget(t *testing.T) {
	bypassAuth = true
	defer func() { bypassAuth = false }()

	activeDrivers.Store("d2", driverEntry{
		ping:     TelemetryPing{DriverID: "d2", Latitude: 19.0, Longitude: 72.8},
		lastSeen: time.Now(),
	})
	defer activeDrivers.Delete("d2")

	body := `{"driver_id":"d2","target_latitude":200.0,"target_longitude":72.8}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/telemetry/geofence", strings.NewReader(body))
	req.Header.Set("X-Driver-ID", "d2")
	w := httptest.NewRecorder()

	handleGeofence(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for out-of-range target, got %d", w.Code)
	}
}
