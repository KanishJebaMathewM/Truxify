
package telemetry

import (
	"errors"
	"math"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

var (
	ErrStaleObservation    = errors.New("stale observation")
	ErrConflictingPayload  = errors.New("conflicting payload")
	ErrCapacityExceeded    = errors.New("telemetry capacity exceeded")
	ErrInvalidObservation  = errors.New("invalid driver observation")
)

type DriverObservation struct {
	DriverID   string    `json:"driver_id"`
	Lat        float64   `json:"lat"`
	Lng        float64   `json:"lng"`
	ObservedAt time.Time `json:"observed_at"`
	ReceivedAt time.Time `json:"received_at"`
}

type storedObservation struct {
	observation DriverObservation
	expiresAt   time.Time
}

type TelemetryStore struct {
	mu           sync.Mutex
	observations map[string]storedObservation

	maxCapacity int
	ttl         time.Duration

	successCount atomic.Uint64
}

func NewTelemetryStore(maxCapacity int, ttl time.Duration) *TelemetryStore {
	if maxCapacity <= 0 {
		panic("maxCapacity must be greater than zero")
	}

	if ttl <= 0 {
		panic("TTL must be greater than zero")
	}

	return &TelemetryStore{
		observations: make(map[string]storedObservation),
		maxCapacity:  maxCapacity,
		ttl:          ttl,
	}
}

// Validate incoming driver observations.
func validateObservation(obs DriverObservation) error {
	if strings.TrimSpace(obs.DriverID) == "" {
		return ErrInvalidObservation
	}

	if math.IsNaN(obs.Lat) || math.IsInf(obs.Lat, 0) ||
		math.IsNaN(obs.Lng) || math.IsInf(obs.Lng, 0) {
		return ErrInvalidObservation
	}

	if obs.Lat < -90 || obs.Lat > 90 {
		return ErrInvalidObservation
	}

	if obs.Lng < -180 || obs.Lng > 180 {
		return ErrInvalidObservation
	}

	if obs.ObservedAt.IsZero() {
		return ErrInvalidObservation
	}

	return nil
}

// Remove expired observations.
func (s *TelemetryStore) removeExpired(now time.Time) {
	for driverID, entry := range s.observations {
		if !now.Before(entry.expiresAt) {
			delete(s.observations, driverID)
		}
	}
}

// Store a driver location ping.
func (s *TelemetryStore) StorePing(
	obs DriverObservation,
) (bool, error) {

	if err := validateObservation(obs); err != nil {
		return false, err
	}

	now := time.Now().UTC()

	obs.DriverID = strings.TrimSpace(obs.DriverID)

	s.mu.Lock()
	defer s.mu.Unlock()

	// Remove expired records before checking capacity.
	s.removeExpired(now)

	existing, exists := s.observations[obs.DriverID]

	// Reject older observations.
	if exists && obs.ObservedAt.Before(
		existing.observation.ObservedAt,
	) {
		return false, ErrStaleObservation
	}

	// Handle equal timestamps.
	if exists && obs.ObservedAt.Equal(
		existing.observation.ObservedAt,
	) {
		if obs.Lat != existing.observation.Lat ||
			obs.Lng != existing.observation.Lng {
			return false, ErrConflictingPayload
		}

		// Exact duplicate: refresh TTL only.
		existing.expiresAt = now.Add(s.ttl)
		s.observations[obs.DriverID] = existing

		return true, nil
	}

	// Check capacity only for new drivers.
	if !exists && len(s.observations) >= s.maxCapacity {
		return false, ErrCapacityExceeded
	}

	// Set server-side receive time.
	obs.ReceivedAt = now

	s.observations[obs.DriverID] = storedObservation{
		observation: obs,
		expiresAt:   now.Add(s.ttl),
	}

	s.successCount.Add(1)

	return true, nil
}

// Retrieve a driver's latest observation.
func (s *TelemetryStore) GetPing(
	driverID string,
) (DriverObservation, bool) {

	driverID = strings.TrimSpace(driverID)

	if driverID == "" {
		return DriverObservation{}, false
	}

	now := time.Now().UTC()

	s.mu.Lock()
	defer s.mu.Unlock()

	entry, exists := s.observations[driverID]

	if !exists {
		return DriverObservation{}, false
	}

	if !now.Before(entry.expiresAt) {
		delete(s.observations, driverID)
		return DriverObservation{}, false
	}

	return entry.observation, true
}

// Return the number of active observations.
func (s *TelemetryStore) Count() int {
	now := time.Now().UTC()

	s.mu.Lock()
	defer s.mu.Unlock()

	s.removeExpired(now)

	return len(s.observations)
}

// Return the number of successfully stored new observations.
func (s *TelemetryStore) SuccessCount() uint64 {
	return s.successCount.Load()
}
