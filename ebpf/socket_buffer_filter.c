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
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 1024);
    __type(key, __u64);
    __type(value, __u32);
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
    __u32 *count = bpf_map_lookup_elem(&rate_limit_map, &rate_key);
    if (count) {
        if (*count >= 1000) // Max 1000 entries per window per connection
            return 0;
        (*count)++;
    } else {
        __u32 one = 1;
        bpf_map_update_elem(&rate_limit_map, &rate_key, &one, BPF_ANY);
    }

    // Calculate payload length
    __u32 payload_len = skb->len - (ETH_HLEN + sizeof(ip) + (tcp.doff * 4));
    if (payload_len > 0) {
        struct telemetry_event *evt = bpf_ringbuf_reserve(&telemetry_ringbuf, sizeof(struct telemetry_event), 0);
        if (evt) {
            evt->src_ip = ip.saddr;
            evt->src_port = tcp.source;
            evt->payload_len = payload_len;
            bpf_ringbuf_submit(evt, 0);
        }
    }

    return skb->len; // Pass frame to socket buffer
}

char _license[] SEC("license") = "GPL";