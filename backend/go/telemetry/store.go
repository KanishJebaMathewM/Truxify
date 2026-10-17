// backend/go/telemetry/store.go (Conceptual fix excerpt)

type DriverObservation struct {
    DriverID     string    `json:"driver_id"`
    Lat          float64   `json:"lat"`
    Lng          float64   `json:"lng"`
    ObservedAt   time.Time `json:"observed_at"`
    ReceivedAt   time.Time `json:"received_at"`
}

func (s *TelemetryStore) StorePing(obs DriverObservation) (bool, error) {
    s.mu.Lock()
    defer s.mu.Unlock()

    existing, exists := s.observations[obs.DriverID]

    // Reject stale observations if we already have a newer timestamp
    if exists && obs.ObservedAt.Before(existing.ObservedAt) {
        return false, ErrStaleObservation
    }

    // Handle equal-timestamp conflicting payloads vs exact duplicates
    if exists && obs.ObservedAt.Equal(existing.ObservedAt) {
        if obs.Lat == existing.Lat && obs.Lng == existing.Lng {
            // Exact duplicate: refresh TTL only
            s.refreshTTL(obs.DriverID)
            return true, nil
        }
        return false, ErrConflictingPayload
    }

    // Admission & capacity checks before persisting
    if !s.admitCapacity() {
        return false, ErrCapacityExceeded
    }

    s.observations[obs.DriverID] = obs
    s.metrics.IncrementSuccess()
    return true, nil
}
