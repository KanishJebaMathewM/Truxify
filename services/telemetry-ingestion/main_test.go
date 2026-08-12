package main

import (
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

// TestHandlePingRejectsOversizedBody verifies the service returns 413 for a
// body larger than the 1 MiB cap instead of buffering it into memory.
func TestHandlePingRejectsOversizedBody(t *testing.T) {
	bypassAuth = true
	defer func() { bypassAuth = false }()

	big := strings.Repeat("a", maxRequestBodyBytes+1)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/telemetry/ping", strings.NewReader(big))
	req.Header.Set("X-Driver-ID", "driver-test")
	w := httptest.NewRecorder()

	handlePing(w, req)

	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413 for oversized body, got %d", w.Code)
	}
}

// TestHandlePingAcceptsBodyWithinLimit verifies a body at the cap boundary is
// still processed normally (reaching validation, not rejected as too large).
func TestHandlePingAcceptsBodyWithinLimit(t *testing.T) {
	bypassAuth = true
	defer func() { bypassAuth = false }()

	// The decoder errors on malformed JSON, but not with a MaxBytesError: the
	// response must be 400 (payload validation), not 413.
	req := httptest.NewRequest(http.MethodPost, "/api/v1/telemetry/ping", strings.NewReader("{not-json"))
	req.Header.Set("X-Driver-ID", "driver-test")
	w := httptest.NewRecorder()

	handlePing(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for malformed in-limit body, got %d", w.Code)
	}
}
