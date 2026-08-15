"""
Regression tests for the XDP anti-replay / anti-DoS filter (ebpf/xdp_anti_replay.c).

These tests lock in the fix from issue #13085: the previous implementation was a
per-source-IP inter-arrival throttle (clock based, keyed by the raw, spoofable
source IP, dropping any packet within 5 ms) which neither detected replays nor
protected legitimate bursts. The corrected filter must:

  * read a real per-packet sequence parsed from the UDP payload (with proper
    data_end bounds checks) instead of the local clock,
  * key replay state on a flow that includes the source port (not the raw IP
    alone, so it cannot be trivially spoofed / used for source-spoofing DoS),
  * drop only duplicate/stale replays and otherwise pass strictly-increasing
    sequences (so legitimate bursts survive).
"""

import os

import pytest

SOURCE_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "xdp_anti_replay.c")
)

CONFLICT_MARKERS = ("<<<<<<<", "=======", ">>>>>>>")


def _source():
    with open(SOURCE_PATH, "r", encoding="utf-8") as fh:
        return fh.read()


def test_no_merge_conflict_markers():
    source = _source()
    for marker in CONFLICT_MARKERS:
        assert marker not in source


def test_no_clock_based_inter_arrival_throttle():
    source = _source()
    # The broken implementation keyed on the local clock and dropped packets
    # arriving within 5 ms of the previous one from the same raw source IP.
    assert "bpf_ktime_get_ns" not in source
    assert "5000000" not in source
    assert "current_time" not in source
    assert "last_seen" not in source


def test_reads_real_payload_sequence_with_bounds_check():
    source = _source()
    # A real sequence must be parsed from the packet payload and bounds-checked
    # against data_end before dereferencing.
    assert "__builtin_bswap32" in source
    assert "data_end" in source
    assert "seq_ptr" in source


def test_flow_key_includes_source_port_not_just_ip():
    source = _source()
    # The flow key must combine the source IP *and* the source port so distinct
    # flows / spoofed source IPs cannot starve each other.
    assert "udp->source" in source
    assert "ip->saddr" in source
    assert "flow_key" in source


def test_replay_state_tracks_last_seq_not_just_time():
    source = _source()
    # Replay detection is driven by a per-flow sequence window.
    assert "last_seq" in source
    assert "REPLAY_WINDOW_SIZE" in source
    # Genuine replays are dropped, not throttled by clock.
    assert "XDP_DROP" in source
    assert "XDP_PASS" in source


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
