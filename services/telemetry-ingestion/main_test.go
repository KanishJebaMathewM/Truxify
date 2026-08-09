package main

import (
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
