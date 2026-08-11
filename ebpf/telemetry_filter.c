/*
 * Truxify eBPF XDP Kernel Packet Filter
 * Rate-limits high-frequency telemetry UDP/WebSocket packets in XDP driver layer
 */

#include <linux/bpf.h>
#include <linux/if_ether.h>
#include <linux/ip.h>
#include <linux/udp.h>
#include <linux/in.h>
#include <bpf/bpf_helpers.h>

#define MAX_TRACKERS 10000
#define RATE_LIMIT_WINDOW_NS 1000000000ULL // 1 second in nanoseconds
#define MAX_PACKETS_PER_SEC 10             // Max 10 telemetry pings per sec per IP

struct rate_limit_entry {
    __u64 last_time_ns;
    __u32 packet_count;
};

// BPF Map: Per-IP Telemetry Rate Limiting
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, MAX_TRACKERS);
    __type(key, __u32); // IPv4 Address
    __type(value, struct rate_limit_entry);
} telemetry_rate_map SEC(".maps");

SEC("xdp")
int xdp_telemetry_filter(struct xdp_md *ctx) {
    void *data = (void *)(long)ctx->data;
    void *data_end = (void *)(long)ctx->data_end;

    struct ethhdr *eth = data;
    if ((void *)(eth + 1) > data_end)
        return XDP_PASS;

    if (eth->h_proto != __constant_htons(ETH_P_IP))
        return XDP_PASS;

    struct iphdr *ip = (void *)(eth + 1);
    if ((void *)(ip + 1) > data_end)
        return XDP_PASS;

    // Filter UDP / telemetry traffic
    if (ip->protocol == IPPROTO_UDP) {
        struct udphdr *udp = (void *)(ip + 1);
        if ((void *)(udp + 1) > data_end)
            return XDP_PASS;

        __u32 src_ip = ip->saddr;
        __u64 now = bpf_ktime_get_ns();

        struct rate_limit_entry *entry = bpf_map_lookup_elem(&telemetry_rate_map, &src_ip);
        if (entry) {
            if (now - entry->last_time_ns < RATE_LIMIT_WINDOW_NS) {
                if (entry->packet_count >= MAX_PACKETS_PER_SEC) {
                    // Rate limit exceeded: Drop packet at XDP layer
                    return XDP_DROP;
                }
                entry->packet_count++;
            } else {
                // Reset window
                entry->last_time_ns = now;
                entry->packet_count = 1;
            }
        } else {
            struct rate_limit_entry new_entry = {
                .last_time_ns = now,
                .packet_count = 1
            };
            bpf_map_update_elem(&telemetry_rate_map, &src_ip, &new_entry, BPF_ANY);
        }
    }

    return XDP_PASS;
}

char _license[] SEC("license") = "GPL";
