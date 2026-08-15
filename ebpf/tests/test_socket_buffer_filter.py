"""
Regression tests for the socket telemetry filter (ebpf/socket_buffer_filter.c).

These tests lock in the fix from issue #14714: the previous implementation
hard-coded a flat 20-byte IP header and a flat ETH_HLEN L2 header, so it
misparsed the TCP header offset for packets carrying IP options or VLAN tags
(producing wrong rate-limit buckets and payload lengths).

The corrected filter must:

  * derive the L2 header length from the Ethernet EtherType and handle VLAN
    tagging (ETH_P_8021Q / ETH_P_8021AD) instead of assuming a flat ETH_HLEN,
  * derive the IP header length from ip.ihl * 4 (after bounds-checking it)
    instead of assuming sizeof(struct iphdr),
  * compute the L4 offset from those real values before indexing into the
    packet.
"""

import os

import pytest

SOURCE_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "socket_buffer_filter.c")
)

CONFLICT_MARKERS = ("<<<<<<<", "=======", ">>>>>>>")


def _source():
    with open(SOURCE_PATH, "r", encoding="utf-8") as fh:
        return fh.read()


def test_no_merge_conflict_markers():
    source = _source()
    for marker in CONFLICT_MARKERS:
        assert marker not in source


def test_handles_vlan_tagging():
    source = _source()
    # The L2 offset must be derived from the EtherType, not assumed flat.
    assert "ETH_P_8021Q" in source
    assert "ETH_P_8021AD" in source
    # A variable L2 header length must be computed and used.
    assert "l2_header_len" in source
    # The old flat assumption must be gone.
    assert "ETH_HLEN + sizeof(ip)" not in source


def test_uses_ip_header_length_not_fixed_20():
    source = _source()
    # The real IP header length must be honored and bounds-checked.
    assert "ip.ihl" in source
    assert "ip_header_len" in source
    # L4 offset must be derived from the real L2 + IP header lengths.
    assert "l4_offset" in source
    assert "l2_header_len + ip_header_len" in source


def test_payload_len_uses_real_offsets():
    source = _source()
    # payload_len must be computed from the real L4 offset, not ETH_HLEN + 20.
    assert "skb->len - (l4_offset" in source
    assert "l4_offset + (tcp.doff * 4)" in source


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
