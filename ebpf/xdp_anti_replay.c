/*
 * eBPF XDP Packet Replay Defender & Anti-DDoS Telemetry Filter
 * Drops replayed and duplicate GPS packets directly in the kernel network driver stack.
 * Replay state is keyed per-flow (src IP + src port) with a sliding window of payload
 * sequence numbers, so legitimate in-window bursts from one IP are never blanket-dropped.
 */

#include <linux/bpf.h>
#include <linux/if_ether.h>
#include <linux/ip.h>
#include <linux/udp.h>
#include <bpf/bpf_helpers.h>

#define REPLAY_WINDOW_SIZE 64

struct anti_replay_entry {
    __u32 last_seq; // Highest payload sequence number seen for this flow
    __u64 window;   // Bitmap of recently seen sequence numbers below last_seq
};

struct {
    __uint(type, BPF_MAP_TYPE_LRU_HASH);
    __uint(max_entries, 10000);
    __type(key, __u64); // Flow key: src_ip (upper 32 bits) | src_port (lower 16 bits)
    __type(value, struct anti_replay_entry);
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

    // Per-flow key keeps the full (src_ip, src_port) tuple in a 64-bit key so that
    // distinct flows behind one NAT or from one GPS device never collide.
    __u64 flow_key = ((__u64)ip->saddr << 16) | udp->source;

    // Sequence number is the first 4 bytes of the UDP payload (network order).
    __u32 *seq_ptr = (void *)(udp + 1);
    if ((void *)(seq_ptr + 1) > data_end)
        return XDP_PASS; // Truncated frame: nothing to evaluate

    __u32 seq = __builtin_bswap32(*seq_ptr);

    struct anti_replay_entry *entry = bpf_map_lookup_elem(&seq_tracking_map, &flow_key);
    if (!entry) {
        struct anti_replay_entry new_entry = {
            .last_seq = seq,
            .window = 1,
        };
        bpf_map_update_elem(&seq_tracking_map, &flow_key, &new_entry, BPF_ANY);
        return XDP_PASS;
    }

    if (seq <= entry->last_seq) {
        __u32 diff = entry->last_seq - seq;
        if (diff >= REPLAY_WINDOW_SIZE)
            return XDP_DROP; // Stale: outside the replay window
        if (entry->window & (1ULL << diff))
            return XDP_DROP; // Duplicate: sequence already seen
        entry->window |= (1ULL << diff); // Out-of-order but in-window: accept
    } else {
        __u64 shift = (__u64)(seq - entry->last_seq);
        if (shift >= REPLAY_WINDOW_SIZE)
            entry->window = 0;
        else
            entry->window <<= shift;
        entry->window |= 1ULL;
        entry->last_seq = seq;
    }

    return XDP_PASS;
}

char _license[] SEC("license") = "GPL";
