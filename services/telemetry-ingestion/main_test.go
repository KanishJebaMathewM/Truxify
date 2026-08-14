package main

import (
	"fmt"
	"runtime"
	"sync"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func resetActiveDrivers() {
	activeDrivers.Range(func(key, value interface{}) bool {
		activeDrivers.Delete(key)
		return true
	})
	atomic.StoreUint64(&activeDriverCount, 0)
}

func resetPingRateLimit() {
	pingRateLimit.Range(func(key, value interface{}) bool {
		pingRateLimit.Delete(key)
		return true
	})
}

func resetGeofenceRateLimit() {
	geofenceRateLimit.Range(func(key, value interface{}) bool {
		geofenceRateLimit.Delete(key)
		return true
	})
	geofenceOrderMu.Lock()
	geofenceOrder.Init()
	geofenceOrderMu.Unlock()
	atomic.StoreUint64(&geofenceRateTracked, 0)
}

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

// TestAllowPingConcurrentSameDriver verifies that concurrent requests for the
// same driver share one rate window and can never collectively bypass the
// configured per-second cap.
func TestAllowPingConcurrentSameDriver(t *testing.T) {
	oldMax := maxPingsPerSec
	maxPingsPerSec = 5
	defer func() { maxPingsPerSec = oldMax }()

	resetPingRateLimit()
	defer resetPingRateLimit()

	driverID := "conc-ping-driver"
	const goroutines = 200
	var wg sync.WaitGroup
	var allowed int64
	start := make(chan struct{})

	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			if allowPing(driverID) {
				atomic.AddInt64(&allowed, 1)
			}
		}()
	}
	close(start)
	wg.Wait()

	if got := atomic.LoadInt64(&allowed); got > int64(maxPingsPerSec) {
		t.Fatalf("rate limit bypassed under concurrency: allowed %d > max %d", got, maxPingsPerSec)
	}
}

// TestAllowGeofenceConcurrentSameDriver is the geofence analogue of
// TestAllowPingConcurrentSameDriver.
func TestAllowGeofenceConcurrentSameDriver(t *testing.T) {
	oldMax := maxGeofencePerSec
	maxGeofencePerSec = 5
	defer func() { maxGeofencePerSec = oldMax }()

	resetGeofenceRateLimit()
	defer resetGeofenceRateLimit()

	driverID := "conc-geofence-driver"
	const goroutines = 200
	var wg sync.WaitGroup
	var allowed int64
	start := make(chan struct{})

	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			if allowGeofence(driverID) {
				atomic.AddInt64(&allowed, 1)
			}
		}()
	}
	close(start)
	wg.Wait()

	if got := atomic.LoadInt64(&allowed); got > int64(maxGeofencePerSec) {
		t.Fatalf("geofence rate limit bypassed under concurrency: allowed %d > max %d", got, maxGeofencePerSec)
	}
}

// TestRateWindowNotResetByEvictionDuringInFlightRequest verifies the core
// TOCTOU fix: a rate-limit entry held by an in-flight request is never
// evicted, so the eviction cannot hand the driver a fresh window. The entry is
// made stale-by-TTL (so a sweep would normally evict it) while still carrying a
// full, recent window; the sweep must defer, and after the request finishes the
// next request must still observe the exhausted window.
func TestRateWindowNotResetByEvictionDuringInFlightRequest(t *testing.T) {
	resetPingRateLimit()
	defer resetPingRateLimit()

	oldTTL := driverTTL
	driverTTL = 100 * time.Millisecond
	defer func() { driverTTL = oldTTL }()

	driverID := "window-driver"
	e, _ := acquireRateEntry(&pingRateLimit, driverID, nil)
	stamp := time.Now().Add(-150 * time.Millisecond)
	e.mu.Lock()
	e.stamps = make([]time.Time, maxPingsPerSec)
	for i := range e.stamps {
		e.stamps[i] = stamp
	}
	e.mu.Unlock()

	// Stale by TTL, so a sweep wants to evict it, but an in-flight request
	// holds the entry: the sweep must defer.
	retireStalePingEntry(driverID, e, time.Now())
	if cur, ok := pingRateLimit.Load(driverID); !ok || cur.(*rateEntry) != e {
		t.Fatal("in-use rate entry was evicted while a request held it")
	}

	// The in-flight request completes; the same entry with the same exhausted
	// window must still be the live one the next request observes.
	e.endUse()
	cur, ok := pingRateLimit.Load(driverID)
	if !ok || cur.(*rateEntry) != e {
		t.Fatal("rate entry was evicted, resetting the driver's window")
	}
	e.mu.Lock()
	full := len(e.stamps) == maxPingsPerSec
	e.mu.Unlock()
	if !full {
		t.Fatal("rate window was truncated by eviction")
	}
}

// TestGeofenceWindowNotResetByEvictionDuringInFlightRequest verifies the same
// TOCTOU fix for the geofence limiter: overflow eviction cannot remove the
// oldest entry while a request holds it, and the exhausted window survives.
func TestGeofenceWindowNotResetByEvictionDuringInFlightRequest(t *testing.T) {
	resetGeofenceRateLimit()
	defer resetGeofenceRateLimit()

	oldMaxTracked, oldMaxPerSec := maxRateTracked, maxGeofencePerSec
	maxRateTracked = 4
	maxGeofencePerSec = 10
	defer func() { maxRateTracked, maxGeofencePerSec = oldMaxTracked, oldMaxPerSec }()

	// The target is the oldest entry so overflow eviction reaches it first.
	target := "geo-window"
	e := acquireGeofenceEntry(target)
	e.mu.Lock()
	e.stamps = make([]time.Time, maxGeofencePerSec)
	for i := range e.stamps {
		e.stamps[i] = time.Now()
	}
	e.mu.Unlock()

	// Push the map over the cap while the target is held by an in-flight
	// request; each new entry triggers a bounded overflow eviction that must
	// defer the in-use target.
	for i := 0; i < maxRateTracked; i++ {
		acquireGeofenceEntry(fmt.Sprintf("fill-%d", i)).endUse()
	}

	if cur, ok := geofenceRateLimit.Load(target); !ok || cur.(*rateEntry) != e {
		t.Fatal("in-use geofence entry was evicted while a request held it")
	}

	e.endUse()

	// The exhausted window must still be the live one.
	cur, ok := geofenceRateLimit.Load(target)
	if !ok || cur.(*rateEntry) != e {
		t.Fatal("geofence entry was evicted, resetting the driver's window")
	}
	e.mu.Lock()
	full := len(e.stamps) == maxGeofencePerSec
	e.mu.Unlock()
	if !full {
		t.Fatal("geofence rate window was truncated by eviction")
	}
}

// TestRateEntryRetirementDeferredWhileInUse verifies the refcount guard in
// isolation: tryRetireRateEntry never retires an entry that is in use, and
// does retire it once the last user releases it.
func TestRateEntryRetirementDeferredWhileInUse(t *testing.T) {
	resetGeofenceRateLimit()
	defer resetGeofenceRateLimit()

	e := acquireGeofenceEntry("g-driver")
	if tryRetireRateEntry(&geofenceRateLimit, e, &geofenceRateTracked) {
		t.Fatal("in-use entry was retired")
	}
	e.endUse()
	if !tryRetireRateEntry(&geofenceRateLimit, e, &geofenceRateTracked) {
		t.Fatal("idle entry was not retired")
	}
	if got := atomic.LoadUint64(&geofenceRateTracked); got != 0 {
		t.Fatalf("tracked counter not decremented after retire: got %d", got)
	}
}

// TestStorePingConcurrentSameDriverInsertsOnce verifies that concurrent first
// pings for the same driver claim exactly one capacity slot.
func TestStorePingConcurrentSameDriverInsertsOnce(t *testing.T) {
	resetActiveDrivers()
	defer resetActiveDrivers()

	const goroutines = 100
	var wg sync.WaitGroup
	start := make(chan struct{})

	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			storePing("same-driver", TelemetryPing{DriverID: "same-driver", Timestamp: time.Now()})
		}()
	}
	close(start)
	wg.Wait()

	if got := atomic.LoadUint64(&activeDriverCount); got != 1 {
		t.Fatalf("expected exactly one capacity slot for the same driver, got %d", got)
	}
	mapSize := 0
	activeDrivers.Range(func(key, value interface{}) bool {
		mapSize++
		return true
	})
	if mapSize != 1 {
		t.Fatalf("expected one active-driver entry, got %d", mapSize)
	}
}

// TestStorePingConcurrentNewDriversNeverExceedsCap fires a large burst of
// distinct new drivers while a monitor observes the counter, asserting the
// maxActiveDrivers cap is never exceeded at any instant.
func TestStorePingConcurrentNewDriversNeverExceedsCap(t *testing.T) {
	resetActiveDrivers()
	defer resetActiveDrivers()

	oldMax := maxActiveDrivers
	maxActiveDrivers = 32
	defer func() { maxActiveDrivers = oldMax }()

	const goroutines = 500
	var wg sync.WaitGroup
	var accepted, rejected int64
	var stopMon atomic.Bool
	var monErr atomic.Value
	start := make(chan struct{})

	// Capture the cap: the monitor outlives the worker burst and must not read
	// the package variable after the deferred restore writes it.
	capLimit := maxActiveDrivers
	go func() {
		for !stopMon.Load() {
			if got := atomic.LoadUint64(&activeDriverCount); got > uint64(capLimit) {
				monErr.Store(fmt.Errorf("active driver count %d exceeded cap %d", got, capLimit))
				return
			}
			runtime.Gosched()
		}
	}()

	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			<-start
			ping := TelemetryPing{DriverID: fmt.Sprintf("cap-driver-%d", n), Timestamp: time.Now()}
			if storePing(ping.DriverID, ping) {
				atomic.AddInt64(&accepted, 1)
			} else {
				atomic.AddInt64(&rejected, 1)
			}
		}(i)
	}
	close(start)
	wg.Wait()
	stopMon.Store(true)

	if err, _ := monErr.Load().(error); err != nil {
		t.Fatal(err)
	}
	if got := atomic.LoadUint64(&activeDriverCount); got > uint64(maxActiveDrivers) {
		t.Fatalf("cap exceeded at end: %d > %d", got, maxActiveDrivers)
	}
	if int(atomic.LoadInt64(&accepted)+atomic.LoadInt64(&rejected)) != goroutines {
		t.Fatal("lost storePing responses")
	}
	if got := atomic.LoadInt64(&accepted); got > int64(maxActiveDrivers) {
		t.Fatalf("accepted more drivers than the cap: %d > %d", got, maxActiveDrivers)
	}
	// The counter must exactly match the number of entries in the map.
	mapSize := 0
	activeDrivers.Range(func(key, value interface{}) bool {
		mapSize++
		return true
	})
	if mapSize != int(atomic.LoadUint64(&activeDriverCount)) {
		t.Fatalf("counter %d != map size %d", atomic.LoadUint64(&activeDriverCount), mapSize)
	}
}

// TestStorePingRefreshDoesNotConsumeCapacity verifies that refreshing an
// existing driver at full capacity never consumes (or leaks) a capacity slot.
func TestStorePingRefreshDoesNotConsumeCapacity(t *testing.T) {
	resetActiveDrivers()
	defer resetActiveDrivers()

	oldMax := maxActiveDrivers
	maxActiveDrivers = 4
	defer func() { maxActiveDrivers = oldMax }()

	if !storePing("refresh-driver", TelemetryPing{DriverID: "refresh-driver"}) {
		t.Fatal("initial insert rejected")
	}
	for i := 0; i < maxActiveDrivers-1; i++ {
		id := fmt.Sprintf("fill-%d", i)
		if !storePing(id, TelemetryPing{DriverID: id}) {
			t.Fatalf("fill %s rejected", id)
		}
	}
	if got := atomic.LoadUint64(&activeDriverCount); got != uint64(maxActiveDrivers) {
		t.Fatalf("expected map at capacity, got counter %d", got)
	}

	const goroutines = 100
	var wg sync.WaitGroup
	var failed int64
	start := make(chan struct{})

	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			<-start
			if !storePing("refresh-driver", TelemetryPing{DriverID: "refresh-driver", SpeedKMH: float64(n)}) {
				atomic.AddInt64(&failed, 1)
			}
		}(i)
	}
	close(start)
	wg.Wait()

	if failed != 0 {
		t.Fatalf("%d refresh requests rejected at full capacity", failed)
	}
	if got := atomic.LoadUint64(&activeDriverCount); got > uint64(maxActiveDrivers) {
		t.Fatalf("capacity consumed by refreshes: %d > %d", got, maxActiveDrivers)
	}
	mapSize := 0
	activeDrivers.Range(func(key, value interface{}) bool {
		mapSize++
		return true
	})
	if mapSize != int(atomic.LoadUint64(&activeDriverCount)) {
		t.Fatalf("counter %d != map size %d", atomic.LoadUint64(&activeDriverCount), mapSize)
	}
}

// TestConcurrentSweepAndIngestion hammers ingestion while a background sweeper
// runs concurrently, asserting the counters never drift from map sizes.
func TestConcurrentSweepAndIngestion(t *testing.T) {
	resetActiveDrivers()
	resetPingRateLimit()
	resetGeofenceRateLimit()
	defer resetActiveDrivers()
	defer resetPingRateLimit()
	defer resetGeofenceRateLimit()

	oldTTL, oldMax := driverTTL, maxActiveDrivers
	driverTTL = 20 * time.Millisecond
	maxActiveDrivers = 64
	defer func() { driverTTL, maxActiveDrivers = oldTTL, oldMax }()

	stop := make(chan struct{})
	var workersWg, sweepWg sync.WaitGroup

	sweepWg.Add(1)
	go func() {
		defer sweepWg.Done()
		for {
			select {
			case <-stop:
				return
			default:
				sweepDrivers()
				runtime.Gosched()
			}
		}
	}()

	const workers = 8
	for w := 0; w < workers; w++ {
		workersWg.Add(1)
		go func(worker int) {
			defer workersWg.Done()
			for i := 0; i < 2000; i++ {
				id := fmt.Sprintf("sweep-driver-%d-%d", worker, i%32)
				ping := TelemetryPing{DriverID: id, Latitude: 1, Longitude: 1, Timestamp: time.Now()}
				storePing(id, ping)
				allowPing(id)
				allowGeofence(id)
			}
		}(w)
	}

	workersWg.Wait()
	close(stop)
	sweepWg.Wait()

	if got := atomic.LoadUint64(&activeDriverCount); got > uint64(maxActiveDrivers) {
		t.Fatalf("active driver cap exceeded: %d > %d", got, maxActiveDrivers)
	}
	activeMapSize := 0
	activeDrivers.Range(func(key, value interface{}) bool {
		activeMapSize++
		return true
	})
	if activeMapSize != int(atomic.LoadUint64(&activeDriverCount)) {
		t.Fatalf("active driver counter %d != map size %d", atomic.LoadUint64(&activeDriverCount), activeMapSize)
	}
	geoMapSize := 0
	geofenceRateLimit.Range(func(key, value interface{}) bool {
		geoMapSize++
		return true
	})
	if geoMapSize != int(atomic.LoadUint64(&geofenceRateTracked)) {
		t.Fatalf("geofence tracker %d != map size %d", atomic.LoadUint64(&geofenceRateTracked), geoMapSize)
	}
}

// TestPruneGeofenceRateEntriesRemovesExpired verifies expired geofence rate
// entries are cleaned up and fresh ones retained.
func TestPruneGeofenceRateEntriesRemovesExpired(t *testing.T) {
	resetGeofenceRateLimit()
	defer resetGeofenceRateLimit()

	fresh := acquireGeofenceEntry("geo-fresh")
	fresh.mu.Lock()
	fresh.stamps = []time.Time{time.Now()}
	fresh.mu.Unlock()
	fresh.endUse()

	acquireGeofenceEntry("geo-stale").endUse()

	if got := atomic.LoadUint64(&geofenceRateTracked); got != 2 {
		t.Fatalf("expected tracked=2 before prune, got %d", got)
	}

	pruneGeofenceRateEntries()

	if _, ok := geofenceRateLimit.Load("geo-fresh"); !ok {
		t.Fatal("fresh geofence entry was pruned")
	}
	if _, ok := geofenceRateLimit.Load("geo-stale"); ok {
		t.Fatal("expired geofence entry was not pruned")
	}
	if got := atomic.LoadUint64(&geofenceRateTracked); got != 1 {
		t.Fatalf("expected tracked=1 after prune, got %d", got)
	}
}

// TestSweepDriversRemovesInactiveDrivers verifies driver inactivity cleanup
// keeps the active-driver accounting consistent.
func TestSweepDriversRemovesInactiveDrivers(t *testing.T) {
	resetActiveDrivers()
	defer resetActiveDrivers()

	oldTTL := driverTTL
	driverTTL = 30 * time.Millisecond
	defer func() { driverTTL = oldTTL }()

	if !storePing("inactive", TelemetryPing{DriverID: "inactive", Timestamp: time.Now()}) {
		t.Fatal("inactive driver insert rejected")
	}
	if !storePing("active", TelemetryPing{DriverID: "active", Timestamp: time.Now()}) {
		t.Fatal("active driver insert rejected")
	}
	if got := atomic.LoadUint64(&activeDriverCount); got != 2 {
		t.Fatalf("expected counter=2, got %d", got)
	}

	// Age the inactive driver past the TTL without disturbing its slot.
	if v, ok := activeDrivers.Load("inactive"); ok {
		e := v.(driverEntry)
		e.lastSeen = e.lastSeen.Add(-driverTTL - time.Second)
		activeDrivers.CompareAndSwap("inactive", v.(driverEntry), e)
	}

	sweepDrivers()

	if _, ok := activeDrivers.Load("inactive"); ok {
		t.Fatal("inactive driver was not swept")
	}
	if _, ok := activeDrivers.Load("active"); !ok {
		t.Fatal("active driver was swept")
	}
	if got := atomic.LoadUint64(&activeDriverCount); got != 1 {
		t.Fatalf("expected counter=1 after sweep, got %d", got)
	}
}

// TestHighConcurrencyIngestion stresses the full request path (rate limiting
// plus active-driver admission) and verifies the cap is respected and the
// accounting stays consistent.
func TestHighConcurrencyIngestion(t *testing.T) {
	resetActiveDrivers()
	resetPingRateLimit()
	defer resetActiveDrivers()
	defer resetPingRateLimit()

	oldMaxPings, oldMaxActive := maxPingsPerSec, maxActiveDrivers
	maxPingsPerSec = 8
	maxActiveDrivers = 256
	defer func() { maxPingsPerSec, maxActiveDrivers = oldMaxPings, oldMaxActive }()

	const workers = 32
	const perWorker = 500
	var wg sync.WaitGroup
	var rateLimited int64
	start := make(chan struct{})

	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func(worker int) {
			defer wg.Done()
			<-start
			id := fmt.Sprintf("hi-driver-%d", worker%16)
			for i := 0; i < perWorker; i++ {
				ping := TelemetryPing{DriverID: id, Timestamp: time.Now()}
				if !allowPing(id) {
					atomic.AddInt64(&rateLimited, 1)
					continue
				}
				if !storePing(id, ping) {
					t.Errorf("storePing rejected under capacity")
				}
			}
		}(w)
	}
	close(start)
	wg.Wait()

	if got := atomic.LoadUint64(&activeDriverCount); got > uint64(maxActiveDrivers) {
		t.Fatalf("active driver cap exceeded: %d > %d", got, maxActiveDrivers)
	}
	if rateLimited == 0 {
		t.Fatal("expected some pings to be rate limited under high concurrency")
	}
	mapSize := 0
	activeDrivers.Range(func(key, value interface{}) bool {
		mapSize++
		return true
	})
	if mapSize != int(atomic.LoadUint64(&activeDriverCount)) {
		t.Fatalf("counter %d != map size %d", atomic.LoadUint64(&activeDriverCount), mapSize)
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

// TestHaversineDistanceCoincidentZero verifies identical coordinates return
// exactly zero distance instead of a NaN/epsilon-polluted aggregate sample.
func TestHaversineDistanceCoincidentZero(t *testing.T) {
	d := haversineDistance(19.076, 72.8777, 19.076, 72.8777)
	if d != 0 {
		t.Fatalf("expected zero distance for coincident points, got %v", d)
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
