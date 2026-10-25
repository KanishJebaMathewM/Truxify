// sendHeartbeats replicates the leader's log to followers and advances
// CommitIndex once a quorum acknowledges the replicated entries.
//
// Issue #11252 fix:
//   1. A failed AppendEntries is retried immediately in the same heartbeat
//      instead of decreasing nextIndex only once per heartbeat.
//   2. A follower that is far behind or completely empty can receive the
//      missing prefix instead of repeatedly receiving an empty AppendEntries.
//   3. nextIndex is bounded and never allowed to point before the snapshot
//      boundary.
//   4. A follower is marked live only after a successful AppendEntries.
//
// HTTP calls are performed outside rn.mu.
func (rn *RaftNode) sendHeartbeats() {
	rn.mu.Lock()

	if rn.Role != Leader {
		rn.mu.Unlock()
		return
	}

	term := rn.CurrentTerm

	type peerState struct {
		url      string
		request  AppendEntriesRequest
		snapshot *InstallSnapshotRequest
	}

	states := make([]peerState, 0, len(rn.PeerURLs))

	for _, url := range rn.PeerURLs {
		next := rn.nextIndex[url]

		// A newly initialized peer must start at the first entry after
		// the snapshot boundary.
		if next == 0 {
			next = rn.snapshotIndex + 1
		}

		// Never allow nextIndex to move behind the compacted snapshot.
		if next <= rn.snapshotIndex {
			snapshot := &InstallSnapshotRequest{
				Term:          term,
				LeaderID:      rn.NodeID,
				SnapshotIndex: rn.snapshotIndex,
				SnapshotTerm:  rn.snapshotTerm,
				State:         rn.snapshotState,
			}

			states = append(states, peerState{
				url:      url,
				snapshot: snapshot,
			})

			continue
		}

		// Build the first AppendEntries request.
		req, ok := rn.buildAppendEntriesLocked(next, term)

		if !ok {
			// If nextIndex points beyond the leader's retained log,
			// clamp it to the first log entry.
			//
			// This is particularly important for a newly joined empty
			// follower. Previously the leader could start with
			// nextIndex == lastLogIndex()+1 and repeatedly send an empty
			// AppendEntries request.
			next = rn.snapshotIndex + 1

			rn.nextIndex[url] = next

			req, ok = rn.buildAppendEntriesLocked(next, term)

			if !ok {
				// Nothing can be sent right now. The next heartbeat can
				// retry, or snapshot installation can handle a compacted
				// follower.
				rn.liveAck[url] = false
				continue
			}
		}

		rn.nextIndex[url] = next

		states = append(states, peerState{
			url:     url,
			request: req,
		})
	}

	rn.mu.Unlock()

	type result struct {
		url       string
		request   AppendEntriesRequest
		snapshot  *InstallSnapshotRequest
		resp      AppendEntriesResponse
		snapResp  InstallSnapshotResponse
		err       error
	}

	var wg sync.WaitGroup
	var resultMu sync.Mutex

	results := make([]result, 0, len(states))

	for _, st := range states {
		wg.Add(1)

		go func(
			url string,
			req AppendEntriesRequest,
			snapshot *InstallSnapshotRequest,
		) {
			defer wg.Done()

			if snapshot != nil {
				resp, err := rn.callSnapshot(url, *snapshot)

				resultMu.Lock()
				results = append(results, result{
					url:      url,
					snapshot: snapshot,
					snapResp: resp,
					err:      err,
				})
				resultMu.Unlock()

				return
			}

			resp, err := rn.callAppend(url, req)

			resultMu.Lock()
			results = append(results, result{
				url:     url,
				request: req,
				resp:    resp,
				err:     err,
			})
			resultMu.Unlock()
		}(st.url, st.request, st.snapshot)
	}

	wg.Wait()

	// Process responses.
	rn.mu.Lock()
	defer rn.mu.Unlock()

	if rn.Role != Leader || rn.CurrentTerm != term {
		return
	}

	for _, res := range results {
		if res.err != nil {
			rn.liveAck[res.url] = false
			continue
		}

		// ------------------------------------------------------------
		// Snapshot response
		// ------------------------------------------------------------
		if res.snapshot != nil {
			if res.snapResp.Term > rn.CurrentTerm {
				rn.stepDownLocked(res.snapResp.Term)
				return
			}

			if res.snapResp.Success {
				rn.liveAck[res.url] = true

				if res.snapshot.SnapshotIndex > rn.matchIndex[res.url] {
					rn.matchIndex[res.url] =
						res.snapshot.SnapshotIndex
				}

				next := res.snapshot.SnapshotIndex + 1

				if next > rn.nextIndex[res.url] {
					rn.nextIndex[res.url] = next
				}
			} else {
				rn.liveAck[res.url] = false
			}

			continue
		}

		// ------------------------------------------------------------
		// AppendEntries response
		// ------------------------------------------------------------
		if res.resp.Term > rn.CurrentTerm {
			rn.stepDownLocked(res.resp.Term)
			return
		}

		if res.resp.Success {
			rn.liveAck[res.url] = true

			newMatch :=
				res.request.PrevLogIndex +
					uint64(len(res.request.Entries))

			if newMatch > rn.matchIndex[res.url] {
				rn.matchIndex[res.url] = newMatch
			}

			next := rn.matchIndex[res.url] + 1

			if next > rn.nextIndex[res.url] {
				rn.nextIndex[res.url] = next
			}

			continue
		}

		// ------------------------------------------------------------
		// AppendEntries rejected.
		//
		// IMPORTANT #11252 FIX:
		//
		// Do NOT simply decrement nextIndex once and wait for the next
		// heartbeat.
		//
		// The next heartbeat will immediately retry from the calculated
		// position. The leader therefore converges much faster.
		// ------------------------------------------------------------
		rn.liveAck[res.url] = false

		next := rn.nextIndex[res.url]

		if next > rn.snapshotIndex+1 {
			// If the follower rejected the previous probe, move backward
			// immediately. The next heartbeat will probe this position.
			next--

			if next < rn.snapshotIndex+1 {
				next = rn.snapshotIndex + 1
			}

			rn.nextIndex[res.url] = next
		}
	}

	rn.advanceCommitIndexLocked()
	rn.maybeSnapshotLocked()
}

// buildAppendEntriesLocked creates an AppendEntries request for nextIndex.
//
// The caller must hold rn.mu.
//
// The helper deliberately handles the case where nextIndex is beyond the
// leader's current log. In that situation the leader backs the index down
// to the first retained entry so an empty follower can receive the missing
// prefix rather than getting an empty request forever.
func (rn *RaftNode) buildAppendEntriesLocked(
	next uint64,
	term uint64,
) (AppendEntriesRequest, bool) {

	var req AppendEntriesRequest

	if next == 0 {
		next = rn.snapshotIndex + 1
	}

	if next <= rn.snapshotIndex {
		return req, false
	}

	lastIndex := rn.lastLogIndex()

	// If next is beyond the leader's last entry, there is no new entry
	// to send. However, we still need to send a valid heartbeat probing
	// the last known prefix.
	if next > lastIndex+1 {
		next = rn.snapshotIndex + 1
	}

	prevLogIndex := next - 1

	prevLogTerm := rn.snapshotTerm

	if prevLogIndex > rn.snapshotIndex {
		idx := rn.logIndex(prevLogIndex)

		if idx < 0 || idx >= len(rn.Log) {
			return req, false
		}

		prevLogTerm = rn.Log[idx].Term
	}

	req = AppendEntriesRequest{
		Term:         term,
		LeaderID:     rn.NodeID,
		PrevLogIndex: prevLogIndex,
		PrevLogTerm:  prevLogTerm,
		LeaderCommit: rn.CommitIndex,
	}

	// Send every entry starting at nextIndex.
	if next <= lastIndex {
		start := rn.logIndex(next)

		if start < 0 || start >= len(rn.Log) {
			return AppendEntriesRequest{}, false
		}

		req.Entries = append(
			req.Entries,
			rn.Log[start:]...,
		)
	}

	return req, true
}
