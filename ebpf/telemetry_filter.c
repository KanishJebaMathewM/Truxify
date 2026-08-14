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
    // bpf_spin_lock requires the lock field to be exactly this type; it is
    // only permitted inside BPF_MAP_TYPE_HASH / BPF_MAP_TYPE_ARRAY (not LRU).
    struct bpf_spin_lock lock;
    __u64 last_time_ns;
    __u32 packet_count;
};

// BPF Map: Per-IP Telemetry Rate Limiting.
// BPF_MAP_TYPE_HASH supports bpf_spin_lock (LRU_HASH does not), so the verifier
// accepts the program. A periodic userspace sweep (loader.py) deletes entries
// that are idle past the window so the map stays healthy in normal operation.
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

    // Filter UDP and TCP/WebSocket telemetry traffic
    if (ip->protocol == IPPROTO_UDP || ip->protocol == IPPROTO_TCP) {
        __u32 src_ip = ip->saddr;
        __u64 now = bpf_ktime_get_ns();

        struct rate_limit_entry *entry = bpf_map_lookup_elem(&telemetry_rate_map, &src_ip);
        if (entry) {
            // Guard the read-modify-write on the shared map value so
            // concurrent packets on different CPUs cannot both pass the
            // >= MAX_PACKETS_PER_SEC check.
            bpf_spin_lock(&entry->lock);
            if (now - entry->last_time_ns < RATE_LIMIT_WINDOW_NS) {
                if (entry->packet_count >= MAX_PACKETS_PER_SEC) {
                    // Rate limit exceeded: Drop packet at XDP layer
                    bpf_spin_unlock(&entry->lock);
                    return XDP_DROP;
                }
                entry->packet_count++;
            } else {
                // Reset window
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
            // Fail closed: if the map is saturated and this source cannot be
            // tracked, drop rather than silently leaving it unlimited.
            if (bpf_map_update_elem(&telemetry_rate_map, &src_ip, &new_entry, BPF_ANY) != 0) {
                return XDP_DROP;
            }
        }
    }

    return XDP_PASS;
}

char _license[] SEC("license") = "GPL";
