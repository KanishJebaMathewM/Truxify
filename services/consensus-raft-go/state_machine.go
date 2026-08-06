package main

import (
	"encoding/json"
	"io"
	"sync"

	"github.com/hashicorp/raft"
)

type TelemetryFSM struct {
	mu            sync.Mutex
	TelemetryData map[string]string
}

func NewTelemetryFSM() *TelemetryFSM {
	return &TelemetryFSM{
		TelemetryData: make(map[string]string),
	}
}

type Command struct {
	Op    string `json:"op"`
	Key   string `json:"key"`
	Value string `json:"value"`
}

func (f *TelemetryFSM) Apply(log *raft.Log) interface{} {
	f.mu.Lock()
	defer f.mu.Unlock()

	var cmd Command
	if err := json.Unmarshal(log.Data, &cmd); err != nil {
		return err
	}

	switch cmd.Op {
	case "set":
		f.TelemetryData[cmd.Key] = cmd.Value
		return nil
	default:
		return nil
	}
}

func (f *TelemetryFSM) Snapshot() (raft.FSMSnapshot, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	clone := make(map[string]string)
	for k, v := range f.TelemetryData {
		clone[k] = v
	}
	return &TelemetrySnapshot{data: clone}, nil
}

func (f *TelemetryFSM) Restore(rc io.ReadCloser) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	return json.NewDecoder(rc).Decode(&f.TelemetryData)
}

type TelemetrySnapshot struct {
	data map[string]string
}

func (s *TelemetrySnapshot) Persist(sink raft.SnapshotSink) error {
	err := func() error {
		b, err := json.Marshal(s.data)
		if err != nil {
			return err
		}
		if _, err := sink.Write(b); err != nil {
			return err
		}
		return sink.Close()
	}()

	if err != nil {
		sink.Cancel()
	}
	return err
}

func (s *TelemetrySnapshot) Release() {}
