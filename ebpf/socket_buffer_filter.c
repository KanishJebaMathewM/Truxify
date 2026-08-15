/*
 * eBPF Socket Filter for Zero-Copy TCP Telemetry Ring Buffering
 * SO_ATTACH_BPF socket program filtering TCP telemetry packets in kernel space.
 */

#include <linux/bpf.h>
#include <linux/if_ether.h>
#include <linux/ip.h>
#include <linux/tcp.h>
#include <bpf/bpf_helpers.h>

struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 256 * 1024); // 256 KB Ring Buffer
} telemetry_ringbuf SEC(".maps");

// Rate-limit map: key = connection tuple hash, value = entries in current window
#define RATE_LIMIT_WINDOW_NS 1000000000ULL // 1 second in nanoseconds
#define RATE_LIMIT_MAX_PER_WINDOW 1000     // Max 1000 entries per window per connection

struct rate_limit_entry {
    // bpf_spin_lock guards the read-modify-write on the shared value so
    // concurrent CPUs cannot both read the same count and lose increments.
    struct bpf_spin_lock lock;
    __u64 last_time_ns;
    __u32 packet_count;
};

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 1024);
    __type(key, __u64);
    __type(value, struct rate_limit_entry);
} rate_limit_map SEC(".maps");

// Trusted telemetry port (configurable via bpftool map update)
struct {
    __uint(type, BPF_MAP_TYPE_ARRAY);
    __uint(max_entries, 1);
    __type(key, __u32);
    __type(value, __u16);
} trusted_port_map SEC(".maps");

struct telemetry_event {
    __u32 src_ip;
    __u16 src_port;
    __u32 payload_len;
};

SEC("socket")
int socket_telemetry_filter(struct __sk_buff *skb) {
    // Read IP header
    struct iphdr ip;
    if (bpf_skb_load_bytes(skb, ETH_HLEN, &ip, sizeof(ip)) < 0)
        return 0; // Drop invalid packet

    if (ip.protocol != IPPROTO_TCP)
        return 0;

    struct tcphdr tcp;
    if (bpf_skb_load_bytes(skb, ETH_HLEN + sizeof(ip), &tcp, sizeof(tcp)) < 0)
        return 0;

    // Get trusted port from config map (default 0 = disabled, meaning all ports filtered)
    __u32 port_key = 0;
    __u16 *trusted_port = bpf_map_lookup_elem(&trusted_port_map, &port_key);
    if (trusted_port && *trusted_port != 0) {
        // Only allow traffic TO or FROM the trusted telemetry port
        if (tcp.source != *trusted_port && tcp.dest != *trusted_port)
            return 0;
    }

    // Rate limiting: hash connection tuple (src_ip ^ dst_ip ^ dst_port)
    __u64 rate_key = (__u64)ip.saddr ^ ((__u64)ip.daddr << 32) ^ tcp.dest;
    __u64 now = bpf_ktime_get_ns();
    struct rate_limit_entry *entry = bpf_map_lookup_elem(&rate_limit_map, &rate_key);
    if (entry) {
        bpf_spin_lock(&entry->lock);
        if (now - entry->last_time_ns < RATE_LIMIT_WINDOW_NS) {
            if (entry->packet_count >= RATE_LIMIT_MAX_PER_WINDOW) {
                bpf_spin_unlock(&entry->lock);
                return 0; // Max 1000 entries per window per connection
            }
            entry->packet_count++;
        } else {
            // Window elapsed: reset the per-window counter (lifetime cap -> windowed).
            entry->last_time_ns = now;
            entry->packet_count = 1;
        }
        bpf_spin_unlock(&entry->lock);
    } else {
        struct rate_limit_entry new_entry = {
            .lock = {},
            .last_time_ns = now,
            .packet_count = 1
        };
        bpf_map_update_elem(&rate_limit_map, &rate_key, &new_entry, BPF_ANY);
    }

    // Guard against short/truncated packets: subtracting the L2/L3/L4 header
    // sizes from an undersized skb->len wraps the __u32 and would emit a bogus
    // near-UINT_MAX payload_len in the ring buffer event.
    if (skb->len < ETH_HLEN + sizeof(ip) + (tcp.doff * 4))
        return 0;

    // Calculate payload length
    __u32 payload_len = skb->len - (ETH_HLEN + sizeof(ip) + (tcp.doff * 4));
    if (payload_len > 0) {
        struct telemetry_event *evt = bpf_ringbuf_reserve(&telemetry_ringbuf, sizeof(struct telemetry_event), 0);
        if (evt) {
            // Zero the whole record (including the implicit padding hole between
            // src_port and payload_len) so no uninitialized kernel memory is
            // published to userspace readers of the ring buffer.
            __builtin_memset(evt, 0, sizeof(*evt));
            evt->src_ip = ip.saddr;
            evt->src_port = bpf_ntohs(tcp.source);
            evt->payload_len = payload_len;
            bpf_ringbuf_submit(evt, 0);
        }
    }

    return skb->len; // Pass frame to socket buffer
}

char _license[] SEC("license") = "GPL";
