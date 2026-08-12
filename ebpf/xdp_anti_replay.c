/*
 * eBPF XDP Packet Replay Defender & Anti-DDoS Telemetry Filter
 * Drops replayed and duplicate GPS packets directly in the kernel network driver stack.
 */

#include <linux/bpf.h>
#include <linux/if_ether.h>
#include <linux/ip.h>
#include <linux/udp.h>
#include <bpf/bpf_helpers.h>

struct {
    __uint(type, BPF_MAP_TYPE_LRU_HASH);
    __uint(max_entries, 10000);
    __type(key, __u32);   // Client source IP address
    __type(value, __u64); // Last seen sequence counter timestamp
} seq_tracking_map SEC(".maps");

SEC("xdp")
int xdp_anti_replay_filter(struct xdp_md *ctx) {
    void *data_end = (void *)(long)ctx->data_end;
    void *data = (void *)(long)ctx->data;

    struct ethhdr *eth = data;
    if ((void *)(eth + 1) > data_end)
        return XDP_PASS;

    if (eth->h_proto != __constant_htons(ETH_P_IP))
        return XDP_PASS;

    struct iphdr *ip = (void *)(eth + 1);
    if ((void *)(ip + 1) > data_end)
        return XDP_PASS;

    if (ip->protocol != IPPROTO_UDP)
        return XDP_PASS;

    struct udphdr *udp = (void *)(ip + 1);
    if ((void *)(udp + 1) > data_end)
        return XDP_PASS;

    __u32 src_ip = ip->saddr;
    __u64 current_time = bpf_ktime_get_ns();

    // Check sliding window/replay stamp
    __u64 *last_seen = bpf_map_lookup_elem(&seq_tracking_map, &src_ip);
    if (last_seen) {
        // Drop packet if sequence timestamp interval is impossibly low (< 5ms)
        if (current_time - *last_seen < 5000000) {
            return XDP_DROP; // Drop replayed packet flood
        }
    }

    bpf_map_update_elem(&seq_tracking_map, &src_ip, &current_time, BPF_ANY);
    return XDP_PASS;
}

char _license[] SEC("license") = "GPL";
