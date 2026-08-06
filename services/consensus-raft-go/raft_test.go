package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestRaftNodeBootstrap(t *testing.T) {
	dir, err := os.MkdirTemp("", "raft-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(dir)

	node, err := SetupRaftNode("test-node-1", "127.0.0.1:17001", filepath.Join(dir, "node1"))
	if err != nil {
		t.Fatalf("SetupRaftNode failed: %v", err)
	}

	time.Sleep(200 * time.Millisecond)

	err = node.ApplyTelemetry("truck-test-1", "{\"lat\":19.07, \"lng\":72.87}")
	if err != nil {
		t.Logf("ApplyTelemetry info/warning: %v", err)
	}
}
