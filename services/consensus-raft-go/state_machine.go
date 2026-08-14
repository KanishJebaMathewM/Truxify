package main

// orderTransitions defines the per-order lifecycle state machine: the commands
// that may follow each recorded command. The lifecycle is a strict chain
// (CREATED -> DISPATCHED -> IN_TRANSIT -> DELIVERED -> COMPLETED) with
// CANCELLED branching off the active states; CANCELLED and COMPLETED are
// terminal.
var orderTransitions = map[string]map[string]bool{
	"CREATED":    {"DISPATCHED": true, "CANCELLED": true},
	"DISPATCHED": {"IN_TRANSIT": true, "CANCELLED": true},
	"IN_TRANSIT": {"DELIVERED": true, "CANCELLED": true},
	"DELIVERED":  {"COMPLETED": true},
	"COMPLETED":  {},
	"CANCELLED":  {},
}

// canTransition reports whether `to` may follow `from` in an order's lifecycle.
// from == "" means the order has no recorded state yet. Commands outside the
// standard ordering (custom RAFT_ALLOWED_COMMANDS entries) are allowed to move
// forward only when the previous state is not terminal and `to` is not CREATED.
func canTransition(from, to string) bool {
	if from == "" {
		return to == "CREATED"
	}
	if _, known := orderTransitions[from]; !known {
		return to != "CREATED"
	}
	return orderTransitions[from][to]
}

// orderStatesLocked replays the log up to limit and returns the last recorded
// command for each order (the per-order state machine).
func (rn *RaftNode) orderStatesLocked(limit uint64) map[string]string {
	if limit > uint64(len(rn.Log)) {
		limit = uint64(len(rn.Log))
	}
	states := make(map[string]string)
	for i := 0; i < int(limit); i++ {
		states[rn.Log[i].OrderID] = rn.Log[i].Command
	}
	return states
}

// findEntryLocked returns the index (1-based) of the first entry in the log up
// to limit matching the order id and command, or 0 when there is none.
func (rn *RaftNode) findEntryLocked(orderID, command string, limit uint64) uint64 {
	if limit > uint64(len(rn.Log)) {
		limit = uint64(len(rn.Log))
	}
	for i := 0; i < int(limit); i++ {
		if rn.Log[i].OrderID == orderID && rn.Log[i].Command == command {
			return rn.Log[i].Index
		}
	}
	return 0
}
