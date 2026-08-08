package main

import (
	"testing"
	"time"
)

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
