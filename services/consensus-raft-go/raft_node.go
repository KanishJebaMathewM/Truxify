package main

import (
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"time"

	"github.com/hashicorp/raft"
)

type RaftNode struct {
	r   *raft.Raft
	fsm *TelemetryFSM
}

func SetupRaftNode(nodeID string, raftAddr string, dataDir string) (*RaftNode, error) {
	config := raft.DefaultConfig()
	config.LocalID = raft.ServerID(nodeID)
	config.HeartbeatTimeout = 50 * time.Millisecond
	config.ElectionTimeout = 150 * time.Millisecond

	addr, err := net.ResolveTCPAddr("tcp", raftAddr)
	if err != nil {
		return nil, err
	}

	transport, err := raft.NewTCPTransport(raftAddr, addr, 3, 10*time.Second, os.Stderr)
	if err != nil {
		return nil, err
	}

	snapshots, err := raft.NewFileSnapshotStore(dataDir, 2, os.Stderr)
	if err != nil {
		return nil, err
	}

	logStore := raft.NewInmemStore()
	stableStore := raft.NewInmemStore()
	fsm := NewTelemetryFSM()

	r, err := raft.NewRaft(config, fsm, logStore, stableStore, snapshots, transport)
	if err != nil {
		return nil, err
	}

	configuration := raft.Configuration{
		Servers: []raft.Server{
			{
				ID:      config.LocalID,
				Address: transport.LocalAddr(),
			},
		},
	}
	r.BootstrapCluster(configuration)

	return &RaftNode{r: r, fsm: fsm}, nil
}

func (node *RaftNode) ApplyTelemetry(key string, value string) error {
	cmd := Command{Op: "set", Key: key, Value: value}
	b, err := json.Marshal(cmd)
	if err != nil {
		return err
	}

	future := node.r.Apply(b, 500*time.Millisecond)
	return future.Error()
}

func main() {
	dir, _ := os.MkdirTemp("", "raft-data-*")
	defer os.RemoveAll(dir)

	node, err := SetupRaftNode("node-1", "127.0.0.1:17000", filepath.Join(dir, "node1"))
	if err != nil {
		fmt.Printf("Raft setup error: %v\n", err)
		return
	}

	time.Sleep(200 * time.Millisecond)
	err = node.ApplyTelemetry("truck-101", "{\"lat\":28.61, \"lng\":77.20}")
	if err == nil {
		fmt.Println("Telemetry applied to Raft cluster successfully!")
	}
}
