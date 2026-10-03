package main

import (
	"fmt"
	"testing"
	"time"
)

// BenchmarkStorePingConcurrency measures the throughput of atomic driver 
// insertions under high contention.
func BenchmarkStorePingConcurrency(b *testing.B) {
	activeDrivers = sync.Map{}
	atomic.StoreUint64(&activeDriverCount, 0)
	maxActiveDrivers = 1000000 // High cap for benchmark

	b.RunParallel(func(pb *testing.PB) {
		i := 0
		for pb.Next() {
			driverID := fmt.Sprintf("bench-driver-%d", i%1000) // 1000 unique drivers
			ping := TelemetryPing{DriverID: driverID, Timestamp: time.Now()}
			storePing(driverID, ping)
			i++
		}
	})
}

// BenchmarkAllowGeofence measures the rate limiter throughput.
func BenchmarkAllowGeofence(b *testing.B) {
	geofenceRateLimit = sync.Map{}
	geofenceRateTracked = 0
	geofenceOrder.Init()

	b.RunParallel(func(pb *testing.PB) {
		i := 0
		for pb.Next() {
			driverID := fmt.Sprintf("bench-geo-%d", i%500)
			allowGeofence(driverID)
			i++
		}
	})
}
